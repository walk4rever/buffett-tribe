/**
 * backfill-derived-metrics.ts
 *
 * 把 derived-metrics.ts 里声明的派生科目补进 Financial 表。
 *
 * 核心原则：
 * 1. 只补缺失项，不覆盖任何已有值；
 * 2. 写入行带 `mappingRule = "derived:<公式>|batch:<batchId>|"` 且 `confidence < 1`，
 *    任何一格都能自证是算出来的还是抄来的，并严格可追溯到写入批次；
 * 3. 严格安全：默认 DRY-RUN；若传入 `--execute`，必须强制指定 `--batch-id <id>`，否则拒绝执行；
 * 4. 严格参数防御：未知命令行参数直接报错中断，杜绝参数拼写错误静默跑错范围；
 * 5. 稳定并发：支持 `--concurrency <5>`（默认 5，带重试保护），逐实体精准索引范围查询，杜绝大范围 in-clause 导致的超时断开。
 *
 * Usage:
 *   # 1. 预览全量 P1/P2 派生需求 (Dry-Run)
 *   npx tsx scripts/backfill-derived-metrics.ts --phase 1,2 --market us --dry-run
 *
 *   # 2. 单标的受控写入
 *   npx tsx scripts/backfill-derived-metrics.ts --ticker AAPL --execute --batch-id "bf-test-aapl"
 *
 *   # 3. 分市场受控落库
 *   npx tsx scripts/backfill-derived-metrics.ts --phase 1,2 --market us --execute --batch-id "bf-p1p2-20261015-us"
 *
 * 回滚：
 *   npx tsx scripts/rollback-batch-financials.ts --batch-id "bf-p1p2-20261015-us" --execute
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { PrismaClient, Prisma } from "@prisma/client";
import * as fs from "node:fs";
import * as path from "node:path";
import { DERIVED_RULES, deriveForPeriod, derivedMappingRule, type FactRow } from "./lib/derived-metrics";
import { upsertFinancialRows } from "./lib/upsert-financial-rows";
import { buildStrictBatchTag } from "./rollback-batch-financials";

export const ALLOWED_FLAGS = new Set([
  "--phase",
  "--market",
  "--ticker",
  "--all",
  "--limit",
  "--offset",
  "--concurrency",
  "--from-year",
  "--batch-id",
  "--dry-run",
  "--execute",
  "--metric-suite",
  "--help",
  "-h",
]);

const SUITE_PATH = path.join(process.cwd(), "scripts", "lib", "morningstar-benchmark-suite.json");
const METRIC_SUITE_PATH = path.join(process.cwd(), "scripts", "lib", "metric-validation-suite.json");

export interface BackfillArgs {
  phases?: number[];
  market?: "us" | "cn" | "hk";
  ticker?: string;
  isAll?: boolean;
  limit?: number;
  offset?: number;
  concurrency: number;
  fromYear: number;
  batchId?: string;
  execute: boolean;
  isDryRun: boolean;
  useMetricSuite: boolean;
}

export function parseBackfillArgs(args: string[]): BackfillArgs {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("-")) {
      if (!ALLOWED_FLAGS.has(arg)) {
        throw new Error(
          `[backfill] 未知命令行参数: ${arg}。允许的参数包括: ${Array.from(ALLOWED_FLAGS).join(", ")}`,
        );
      }
    }
  }

  function getArgVal(flag: string): string | undefined {
    const idx = args.indexOf(flag);
    return idx >= 0 && idx + 1 < args.length && !args[idx + 1].startsWith("-")
      ? args[idx + 1]
      : undefined;
  }

  const execute = args.includes("--execute");
  const isDryRun = args.includes("--dry-run") || !execute;
  const isAll = args.includes("--all");
  const useMetricSuite = args.includes("--metric-suite");
  const ticker = getArgVal("--ticker");
  const marketRaw = getArgVal("--market")?.toLowerCase();
  const phaseRaw = getArgVal("--phase");
  const limitRaw = getArgVal("--limit");
  const offsetRaw = getArgVal("--offset");
  const concurrencyRaw = getArgVal("--concurrency");
  const fromYearRaw = getArgVal("--from-year");
  const batchId = getArgVal("--batch-id")?.trim();

  let market: "us" | "cn" | "hk" | undefined;
  if (marketRaw) {
    if (marketRaw !== "us" && marketRaw !== "cn" && marketRaw !== "hk") {
      throw new Error(`[backfill] 非法 market 参数: "${marketRaw}"。只支持 us | cn | hk`);
    }
    market = marketRaw;
  }

  let phases: number[] | undefined;
  if (phaseRaw) {
    phases = phaseRaw
      .split(",")
      .map((p) => Number.parseInt(p.trim(), 10))
      .filter((p) => !Number.isNaN(p));
    if (!phases.length) {
      throw new Error(`[backfill] 非法 phase 参数: "${phaseRaw}"。示例: --phase 1,2 或 --phase 1`);
    }
  }

  let limit: number | undefined;
  if (limitRaw) {
    limit = Number.parseInt(limitRaw, 10);
    if (Number.isNaN(limit) || limit <= 0) {
      throw new Error(`[backfill] 非法 limit 参数: "${limitRaw}"`);
    }
  }

  let offset: number | undefined;
  if (offsetRaw) {
    offset = Number.parseInt(offsetRaw, 10);
    if (Number.isNaN(offset) || offset < 0) {
      throw new Error(`[backfill] 非法 offset 参数: "${offsetRaw}"`);
    }
  }

  let concurrency = 5;
  if (concurrencyRaw) {
    concurrency = Number.parseInt(concurrencyRaw, 10);
    if (Number.isNaN(concurrency) || concurrency <= 0 || concurrency > 20) {
      throw new Error(`[backfill] 非法 concurrency 参数: "${concurrencyRaw}"，必须介于 1 到 20 之间`);
    }
  }

  let fromYear = 2020;
  if (fromYearRaw) {
    fromYear = Number.parseInt(fromYearRaw, 10);
    if (Number.isNaN(fromYear) || fromYear < 1990 || fromYear > 2030) {
      throw new Error(`[backfill] 非法 from-year 参数: "${fromYearRaw}"`);
    }
  }

  // 安全红线：执行物理写入时，必须强制指定 batchId
  if (execute) {
    if (!batchId || batchId === "") {
      throw new Error(
        `[backfill] 写入安全红线触发：带 --execute 写入时必须强制指定 --batch-id <id>，以便将来精准溯源与回滚！`,
      );
    }
    if (!/^[a-zA-Z0-9_\-]+$/.test(batchId)) {
      throw new Error(`[backfill] 批次号格式不合法: "${batchId}"。只允许英文字母、数字、下划线和连字符。`);
    }
  }

  return {
    phases,
    market,
    ticker,
    isAll,
    limit,
    offset,
    concurrency,
    fromYear,
    batchId,
    execute,
    isDryRun,
    useMetricSuite,
  };
}

export function buildBackfillWhereClause(args: BackfillArgs): Prisma.EntityWhereInput {
  const where: Prisma.EntityWhereInput = { type: "company" };

  if (args.ticker) {
    const bare = args.ticker.replace(".HK", "").replace("-", ".");
    where.OR = [
      { ticker: args.ticker },
      { ticker: `${args.ticker}.SS` },
      { ticker: `${args.ticker}.SZ` },
      { code: bare },
      { ticker: bare },
      { ticker: `${bare}.HK` },
    ];
  } else if (args.useMetricSuite) {
    const suite = JSON.parse(
      fs.readFileSync(METRIC_SUITE_PATH, "utf8"),
    ) as { companies: Array<{ ticker: string }> };
    where.OR = suite.companies.flatMap(({ ticker }) => {
      const bare = ticker.replace(/\.(SS|SZ)$/, "");
      return [
        { ticker },
        { code: bare },
        { ticker: bare },
      ];
    });
  } else if (args.phases && args.phases.length > 0) {
    where.onboardPhase = { in: args.phases };
  } else if (!args.isAll) {
    // 默认回落到 100 家 Morningstar 评测集
    if (fs.existsSync(SUITE_PATH)) {
      const suite = JSON.parse(fs.readFileSync(SUITE_PATH, "utf8")) as Array<{ ticker: string }>;
      const orClauses: Array<{ ticker?: string; code?: string }> = [];
      for (const c of suite) {
        const bare = c.ticker.replace(".HK", "").replace("-", ".");
        orClauses.push({ ticker: c.ticker });
        orClauses.push({ ticker: `${c.ticker}.SS` });
        orClauses.push({ ticker: `${c.ticker}.SZ` });
        orClauses.push({ code: bare });
        orClauses.push({ ticker: bare });
        orClauses.push({ ticker: `${bare}.HK` });
      }
      where.OR = orClauses;
    }
  }

  if (args.market) {
    where.market = args.market;
  }

  return where;
}

export interface DerivedBackfillStats {
  entitiesScanned: number;
  periodsScanned: number;
  wouldWrite: number;
  written: number;
  alreadyPresent: number;
  skippedMissingInput: number;
  skippedUnitMismatch: number;
  samples: string[];
}

export async function runDerivedBackfill(
  args: BackfillArgs,
  db: PrismaClient = new PrismaClient(),
): Promise<DerivedBackfillStats> {
  const whereClause = buildBackfillWhereClause(args);

  const entities = await db.entity.findMany({
    where: whereClause,
    select: { id: true, ticker: true, canonicalName: true, market: true, reportingCurrency: true },
    orderBy: [{ priority: "desc" }, { ticker: "asc" }],
    skip: args.offset ?? 0,
    take: args.limit,
  });

  const scopeLabel = args.ticker
    ? `指定标的 [${args.ticker}]`
    : args.useMetricSuite
      ? `99 项指标验证集${args.market ? ` 市场 [${args.market.toUpperCase()}]` : ""}`
    : args.phases
      ? `Phase [${args.phases.join(",")}]${args.market ? ` 市场 [${args.market.toUpperCase()}]` : ""}`
      : args.isAll
        ? `全库所有公司${args.market ? ` 市场 [${args.market.toUpperCase()}]` : ""}`
        : `Morningstar 100 家样本`;

  console.log(`\n======================================================`);
  console.log(`🚀 派生科目受控回填 | 范围: ${scopeLabel} (共 ${entities.length} 家)`);
  console.log(`规则集: ${DERIVED_RULES.map((r) => `${r.key}=${r.formula.join(" ")}`).join(", ")}`);
  console.log(`并发度: ${args.concurrency} | 起始财年: >= ${args.fromYear}`);
  console.log(
    `运行模式: ${args.execute ? `⚠️ 真实落库 (批次号: [${args.batchId}])` : "ℹ️ DRY-RUN 预览 (未写库)"}`,
  );
  console.log(`======================================================\n`);

  let entitiesScanned = 0;
  let periodsScanned = 0;
  let wouldWrite = 0;
  let written = 0;
  let alreadyPresent = 0;
  let skippedMissingInput = 0;
  let skippedUnitMismatch = 0;
  const samples: string[] = [];

  const startDate = new Date(Date.UTC(args.fromYear, 0, 1));
  const startTime = Date.now();

  // 按并发分批处理
  for (let i = 0; i < entities.length; i += args.concurrency) {
    const chunk = entities.slice(i, i + args.concurrency);
    const chunkRowsToUpsert: Prisma.FinancialCreateManyInput[] = [];

    await Promise.all(
      chunk.map(async (entity) => {
        let retries = 2;
        let facts: Array<{
          periodEnd: Date;
          lineItem: string;
          value: Prisma.Decimal | null;
          unit: string | null;
          sourceId: string;
        }> = [];

        while (retries >= 0) {
          try {
            facts = await db.financial.findMany({
              where: {
                entityId: entity.id,
                periodType: "FY",
                periodEnd: { gte: startDate },
              },
              select: { periodEnd: true, lineItem: true, value: true, unit: true, sourceId: true },
            });
            break;
          } catch (err) {
            retries--;
            if (retries < 0) {
              console.warn(`[backfill] 实体 ${entity.ticker} 查询财报失败，跳过: ${err instanceof Error ? err.message : err}`);
              return;
            }
            await new Promise((r) => setTimeout(r, 1000));
          }
        }

        entitiesScanned++;
        const byPeriod = new Map<string, FactRow[]>();
        const periodEndByKey = new Map<string, Date>();

        for (const f of facts) {
          if (f.value == null) continue;
          const key = f.periodEnd.toISOString();
          if (!byPeriod.has(key)) {
            byPeriod.set(key, []);
            periodEndByKey.set(key, f.periodEnd);
          }
          byPeriod.get(key)!.push({
            lineItem: f.lineItem,
            value: Number(f.value.toString()),
            unit: f.unit,
            sourceId: f.sourceId,
          });
        }
        if (!byPeriod.size) return;

        for (const [key, rows] of byPeriod) {
          periodsScanned++;
          const { derived, skipped } = deriveForPeriod(rows);
          for (const s of skipped) {
            if (s.reason.startsWith("已有")) alreadyPresent++;
            else if (s.reason.includes("单位不一致")) skippedUnitMismatch++;
            else skippedMissingInput++;
          }
          if (!derived.length) continue;

          for (const d of derived) {
            const periodDate = periodEndByKey.get(key)!;
            const label = `${entity.ticker ?? entity.canonicalName} FY${periodDate.toISOString().slice(0, 10)} ${d.key} = ${d.value} ${d.unit ?? ""} (${d.inputs.map((inp) => `${inp.lineItem}=${inp.value}`).join(", ")})`;
            if (samples.length < 8) samples.push(label);
            wouldWrite++;

            if (args.execute && args.batchId) {
              const taggedMappingRule = `${derivedMappingRule(d.rule)}${buildStrictBatchTag(args.batchId)}`;
              chunkRowsToUpsert.push({
                entityId: entity.id,
                sourceId: d.sourceId,
                periodEnd: periodDate,
                periodType: "FY",
                lineItem: d.key,
                value: d.value,
                unit: d.unit,
                mappingRule: taggedMappingRule,
                confidence: d.rule.confidence,
              });
            }
          }
        }
      }),
    );

    // 当前批次若有待写入行，立即执行短事务写入
    if (args.execute && chunkRowsToUpsert.length > 0) {
      const count = await upsertFinancialRows(db, chunkRowsToUpsert);
      written += count;
    }

    // 进度打印
    if ((i + args.concurrency >= entities.length) || (i > 0 && i % (args.concurrency * 10) === 0)) {
      const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
      const pct = Math.min(100, (((i + chunk.length) / entities.length) * 100)).toFixed(1);
      console.log(
        `[进度] 处理中: ${Math.min(entities.length, i + chunk.length)}/${entities.length} (${pct}%) | 耗时: ${elapsedSec}s | 发现可派生: ${wouldWrite} 行 | 已写入: ${written} 行`,
      );
    }
  }

  const totalCostSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n======================================================`);
  console.log(`🎉 派生科目统计汇报 (总耗时: ${totalCostSec}s):`);
  console.log(`  - 扫描 Entity 实体数: ${entitiesScanned}`);
  console.log(`  - 扫描 FY 期间数: ${periodsScanned}`);
  console.log(`  - 可派生写入行数 (输入齐全): ${wouldWrite}`);
  console.log(`  - 跳过数 (已有该科目): ${alreadyPresent}`);
  console.log(`  - 跳过数 (输入不全): ${skippedMissingInput}`);
  console.log(`  - 跳过数 (单位不一致): ${skippedUnitMismatch}`);

  if (samples.length) {
    console.log(`\n抽样样例 (最多 8 条):`);
    for (const s of samples) console.log(`  - ${s}`);
  }

  if (args.execute) {
    console.log(`\n✅ [EXECUTE 完成] 成功批量写入 ${written} 行数据，已打上批次标签 "${buildStrictBatchTag(args.batchId!)}"\n`);
  } else {
    console.log(`\nℹ️ [DRY-RUN 结束] 数据未做任何写入。若确认落库，请追加参数: --execute --batch-id "<batchId>"\n`);
  }

  return {
    entitiesScanned,
    periodsScanned,
    wouldWrite,
    written,
    alreadyPresent,
    skippedMissingInput,
    skippedUnitMismatch,
    samples,
  };
}

async function main() {
  const args = parseBackfillArgs(process.argv.slice(2));
  const db = new PrismaClient();
  try {
    await runDerivedBackfill(args, db);
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1]?.includes("backfill-derived-metrics.ts")) {
  main().catch(async (err) => {
    console.error(`\n❌ 回填执行失败:`, err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
