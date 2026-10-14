/**
 * backfill-derived-metrics.ts
 *
 * 把 derived-metrics.ts 里声明的派生科目补进 Financial 表。
 *
 * 只补缺失项，不覆盖任何已有值；写入行带 `mappingRule = "derived:<公式>"` 且
 * `confidence < 1`，所以任何一格都能自证是算出来的还是抄来的。
 *
 * 默认 dry-run。写库要显式加 --execute。
 *
 * Usage:
 *   npx tsx scripts/backfill-derived-metrics.ts                          # golden 100 家，dry-run
 *   npx tsx scripts/backfill-derived-metrics.ts --execute                # 真的写
 *   npx tsx scripts/backfill-derived-metrics.ts --ticker AAPL
 *   npx tsx scripts/backfill-derived-metrics.ts --all --execute          # 全库（放量阶段才用）
 *
 * 回滚：DELETE FROM "Financial" WHERE "mappingRule" LIKE 'derived:%';
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { PrismaClient } from "@prisma/client";
import * as fs from "node:fs";
import * as path from "node:path";
import { DERIVED_RULES, deriveForPeriod, derivedMappingRule, type FactRow } from "./lib/derived-metrics";

const db = new PrismaClient();
const SUITE_PATH = path.join(process.cwd(), "scripts", "lib", "morningstar-benchmark-suite.json");

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface Target {
  ticker: string;
  or: Array<Record<string, string>>;
}

function targetsForTicker(ticker: string): Target {
  const bare = ticker.replace(".HK", "").replace("-", ".");
  return {
    ticker,
    or: [
      { ticker },
      { ticker: `${ticker}.SS` },
      { ticker: `${ticker}.SZ` },
      { code: bare },
      { ticker: bare },
      { ticker: `${bare}.HK` },
    ],
  };
}

async function main() {
  const execute = process.argv.includes("--execute");
  const tickerArg = argValue("--ticker");
  const isAll = process.argv.includes("--all");

  const suite = JSON.parse(fs.readFileSync(SUITE_PATH, "utf8")) as Array<{ ticker: string }>;
  const targets: Target[] = tickerArg
    ? [targetsForTicker(tickerArg)]
    : isAll
      ? []
      : suite.map((c) => targetsForTicker(c.ticker));

  console.log(
    `派生科目回填 | 规则 ${DERIVED_RULES.map((r) => `${r.key}=${r.formula.join(" ")}`).join(", ")} | ` +
      `范围 ${tickerArg ? tickerArg : isAll ? "全库" : `golden ${suite.length} 家`} | 模式 ${execute ? "写入" : "DRY-RUN"}`,
  );

  let entitiesScanned = 0;
  let periodsScanned = 0;
  let wouldWrite = 0;
  let written = 0;
  let alreadyPresent = 0;
  let skippedMissingInput = 0;
  let skippedUnitMismatch = 0;
  const samples: string[] = [];

  const entityWhere = isAll
    ? { type: "company" }
    : {
        OR: [
          { ticker: { in: targets.flatMap((t) => t.or.filter((c) => "ticker" in c).map((c) => c.ticker)) } },
          { code: { in: targets.flatMap((t) => t.or.filter((c) => "code" in c).map((c) => c.code)) } },
        ],
      };

  const entities = await db.entity.findMany({
    where: entityWhere,
    select: { id: true, ticker: true, canonicalName: true, reportingCurrency: true },
  });

  // 一次取全，再在内存里分组 —— 逐家查库在这个库的延迟下要多花十几分钟。
  const allFinancials = await db.financial.findMany({
    where: { entityId: { in: entities.map((e) => e.id) }, periodType: "FY" },
    select: { entityId: true, periodEnd: true, lineItem: true, value: true, unit: true, sourceId: true },
  });

  const factsByEntity = new Map<string, typeof allFinancials>();
  for (const f of allFinancials) {
    if (!factsByEntity.has(f.entityId)) factsByEntity.set(f.entityId, []);
    factsByEntity.get(f.entityId)!.push(f);
  }

  for (const entity of entities) {
    entitiesScanned++;
    const byPeriod = new Map<string, FactRow[]>();
    const periodEndByKey = new Map<string, Date>();
    for (const f of factsByEntity.get(entity.id) ?? []) {
      if (f.value == null) continue;
      const key = f.periodEnd.toISOString();
      if (!byPeriod.has(key)) {
        byPeriod.set(key, []);
        periodEndByKey.set(key, f.periodEnd);
      }
      byPeriod.get(key)!.push({ lineItem: f.lineItem, value: Number(f.value.toString()), unit: f.unit, sourceId: f.sourceId });
    }
    if (!byPeriod.size) continue;

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
        const label = `${entity.ticker ?? entity.canonicalName} FY${periodEndByKey.get(key)!.toISOString().slice(0, 10)} ${d.key} = ${d.value} ${d.unit ?? ""} (${d.inputs.map((i) => `${i.lineItem}=${i.value}`).join(", ")})`;
        if (samples.length < 8) samples.push(label);
        wouldWrite++;

        if (!execute) continue;
        await db.financial.create({
          data: {
            entityId: entity.id,
            sourceId: d.sourceId,
            periodEnd: periodEndByKey.get(key)!,
            periodType: "FY",
            lineItem: d.key,
            value: d.value,
            unit: d.unit,
            mappingRule: derivedMappingRule(d.rule),
            confidence: d.rule.confidence,
          },
        });
        written++;
      }
    }
  }

  console.log(`\n扫描 entity ${entitiesScanned} 个，FY 期间 ${periodsScanned} 个`);
  console.log(`  可派生（缺失且输入齐全）: ${wouldWrite}`);
  console.log(`  已有该科目、跳过: ${alreadyPresent}`);
  console.log(`  输入不全、跳过: ${skippedMissingInput}`);
  console.log(`  单位不一致、跳过: ${skippedUnitMismatch}`);
  if (samples.length) {
    console.log("\n样例（最多 8 条）:");
    for (const s of samples) console.log(`  - ${s}`);
  }
  console.log(`\n${execute ? `✅ 已写入 ${written} 行` : "ℹ️  DRY-RUN，未写库。加 --execute 落库。"}`);
  await db.$disconnect();
}

if (process.argv[1]?.includes("backfill-derived-metrics.ts")) {
  main().catch(async (err) => {
    console.error(err);
    await db.$disconnect();
    process.exit(1);
  });
}
