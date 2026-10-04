#!/usr/bin/env tsx
/**
 * 13 类行业分类器（LLM 路由）—— 唯一入口。
 *
 * 用法：
 *   # 单公司（dry-run，结果打印 + 落盘，不写库）
 *   node --env-file=.env.local ./node_modules/.bin/tsx scripts/classify-sector.ts --company HD --dry-run
 *
 *   # 单公司（真写库）
 *   node --env-file=.env.local ./node_modules/.bin/tsx scripts/classify-sector.ts --company HD
 *
 *   # 全库回补（能力查询，不依赖 onboardPhase）
 *   node --env-file=.env.local ./node_modules/.bin/tsx scripts/classify-sector.ts --all --concurrency 4 --out tmp-sector-all.json
 *   node --env-file=.env.local ./node_modules/.bin/tsx scripts/classify-sector.ts --all --market us
 *
 * 参数：
 *   --company <ticker|name|cik>  可逗号分隔
 *   --all                        全库（候选集 = 有 overview 或 有财务数据 的 company）
 *   --market us|hk|cn            限定市场（配合 --all）
 *   --limit N                    限制条数（配合 --all，调试用）
 *   --dry-run                    不写库，结果落 --out
 *   --out <file>                 结果落盘路径（默认 tmp-sector-classify.json）
 *   --force                      忽略 inputsHash，强制重算
 *   --concurrency N              LLM 并发数（默认 4）
 *
 * 候选集口径（重要）：按「能力」查 —— `overview is not null or 有 Financial 行`，
 * 绝不按 `onboardPhase` 查。onboardPhase 是会漂移的存量标记（历史上 72 家
 * US 公司因此永远拿不到 overview），而能力是数据事实。这条口径让存量脏标记
 * 与本任务彻底无关，也让 overview 事后回补能自动触发重分类（inputsHash 变化）。
 */

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import prisma from "../src/lib/prisma";
import { callJsonLLM, findCompanies, getArg, hasFlag } from "./lib/company-generation";
import {
  SECTOR_MODEL_13_CONFIG,
  SECTOR_MODEL_13_TYPES,
  isSectorModelType13,
  type SectorModelType13,
} from "../src/lib/sector-classification";
import { shouldSkipSectorClassification } from "../src/lib/sector-classification-state";
import { computeSectorFingerprint, type FinancialRowInput, type SectorFingerprint } from "../src/lib/sector-fingerprint";
import {
  SECTOR_CLASSIFY_PROMPT_VERSION,
  buildSectorClassificationPrompt,
  parseSectorClassification,
  type SectorClassificationResult,
  type SectorEvidence,
} from "../src/lib/sector-classification-llm";

const FINGERPRINT_LINE_ITEMS = [
  "Revenue",
  "NetIncome",
  "GrossProfit",
  "TotalAssets",
  "TotalLiabilities",
  "ShareholdersEquity",
  "StockholdersEquity",
  "CapEx",
  "OperatingCashFlow",
];

interface CandidateRow {
  id: string;
  ticker: string | null;
  market: string | null;
  canonicalName: string;
  cik: string | null;
  sector: string | null;
  industry: string | null;
  namezh: string | null;
  exchange: string | null;
  overview: string | null;
  sectorModelType: string | null;
  sectorModelMetadata: unknown;
  prevsource: string | null;
}

interface FinancialRowDb {
  entityId: string;
  periodEnd: Date;
  periodType: string;
  revenue: number | null;
  netincome: number | null;
  grossprofit: number | null;
  totalassets: number | null;
  totalliabilities: number | null;
  shareholdersequity: number | null;
  stockholdersequity: number | null;
  capex: number | null;
  operatingcashflow: number | null;
}

/** FinancialRowDb 中的数值列（对应 9 个 lineItem） */
type NumericColumn =
  | "revenue"
  | "netincome"
  | "grossprofit"
  | "totalassets"
  | "totalliabilities"
  | "shareholdersequity"
  | "stockholdersequity"
  | "capex"
  | "operatingcashflow";

interface ClassificationRecord {
  id: string;
  ticker: string | null;
  market: string | null;
  name: string;
  nameZh: string | null;
  previousType: string | null;
  outcome: "classified" | "unknown" | "error";
  type: SectorModelType13 | null;
  confidence: number;
  reason: string;
  evidenceUsed: string[];
  needsReview: boolean;
  inputsHash: string;
  overview: string | null;
  fingerprint: SectorFingerprint;
  error?: string;
}

const CANDIDATE_SELECT = `
  e.id, e.ticker, e.market, e."canonicalName", e.cik, e.sector,
  e.metadata->>'industry' AS industry,
  e.metadata->>'nameZh' AS namezh,
  e.metadata->>'exchange' AS exchange,
  e."sectorModelType" AS "sectorModelType",
  e.metadata->'sectorModel' AS "sectorModelMetadata",
  e.metadata->'sectorModel'->>'source' AS prevsource,
  a.overview
`;

/** 能力口径：有概览（能读业务本质）或 有财务数据（能算指纹） */
const CAPABILITY_PREDICATE = `
  e.type = 'company'
  AND (a.overview IS NOT NULL OR EXISTS (SELECT 1 FROM "Financial" f WHERE f."entityId" = e.id))
`;

async function fetchCandidatesByIds(ids: string[]): Promise<CandidateRow[]> {
  const rows: CandidateRow[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const placeholders = chunk.map((_, index) => `$${index + 1}`).join(",");
    rows.push(
      ...(await prisma.$queryRawUnsafe<CandidateRow[]>(
        `SELECT ${CANDIDATE_SELECT}
         FROM "Entity" e
         LEFT JOIN "CompanyAnalysis" a ON a."entityId" = e.id
         WHERE ${CAPABILITY_PREDICATE} AND e.id IN (${placeholders})`,
        ...chunk,
      )),
    );
  }
  return rows;
}

async function fetchCandidatesByCapability(market: string | null, limit: number | null): Promise<CandidateRow[]> {
  const params: unknown[] = [];
  let sql = `SELECT ${CANDIDATE_SELECT}
             FROM "Entity" e
             LEFT JOIN "CompanyAnalysis" a ON a."entityId" = e.id
             WHERE ${CAPABILITY_PREDICATE}`;
  if (market) {
    params.push(market);
    sql += ` AND e.market = $${params.length}`;
  }
  sql += ` ORDER BY e.market ASC, e.ticker ASC NULLS LAST, e.id ASC`;
  if (limit) {
    params.push(limit);
    sql += ` LIMIT $${params.length}`;
  }
  return prisma.$queryRawUnsafe<CandidateRow[]>(sql, ...params);
}

/**
 * 按公司批量取财务数据 —— SQL 侧选期 + 透视。
 *
 * 为什么要这么写：Financial 是全库最大的表之一，直接按 entityId IN (...) 拉
 * 明细，2,000 家会回传约 20 万行（每行一个 lineItem），实测 2.6ms/行、要跑 8
 * 分钟；16,000 家的目标下就是一小时。真正需要的只是每家公司 3 期 × 9 个数。
 *
 * 选期规则与 computeSectorFingerprint 一致：最近两个 FY（算同比用）+ 最新一期
 * （没有 FY 时的兼底）。这里只做「选期与透视」，比率计算仍然只由
 * computeSectorFingerprint 负责，避免两处口径漂移。
 */
function buildFinancialQuery(entityIds: string[]): { sql: string; params: unknown[] } {
  const idPlaceholders = entityIds.map((_, index) => `$${index + 1}`).join(",");
  const itemPlaceholders = FINGERPRINT_LINE_ITEMS.map((_, index) => `$${entityIds.length + index + 1}`).join(",");

  const sql = `
    WITH periods AS MATERIALIZED (
      SELECT DISTINCT "entityId", "periodEnd", "periodType"
      FROM "Financial"
      WHERE "entityId" IN (${idPlaceholders}) AND "lineItem" IN (${itemPlaceholders})
    ),
    fy_ranked AS (
      SELECT "entityId", "periodEnd", "periodType",
             ROW_NUMBER() OVER (PARTITION BY "entityId" ORDER BY "periodEnd" DESC) AS rn
      FROM periods WHERE "periodType" = 'FY'
    ),
    latest_any AS (
      SELECT DISTINCT ON ("entityId") "entityId", "periodEnd", "periodType"
      FROM periods ORDER BY "entityId", "periodEnd" DESC
    ),
    picked AS (
      SELECT "entityId", "periodEnd", "periodType" FROM fy_ranked WHERE rn <= 2
      UNION
      SELECT "entityId", "periodEnd", "periodType" FROM latest_any
    )
    SELECT p."entityId", p."periodEnd", p."periodType",
      MAX(f.value) FILTER (WHERE f."lineItem" = 'Revenue')::float8 AS revenue,
      MAX(f.value) FILTER (WHERE f."lineItem" = 'NetIncome')::float8 AS netincome,
      MAX(f.value) FILTER (WHERE f."lineItem" = 'GrossProfit')::float8 AS grossprofit,
      MAX(f.value) FILTER (WHERE f."lineItem" = 'TotalAssets')::float8 AS totalassets,
      MAX(f.value) FILTER (WHERE f."lineItem" = 'TotalLiabilities')::float8 AS totalliabilities,
      MAX(f.value) FILTER (WHERE f."lineItem" = 'ShareholdersEquity')::float8 AS shareholdersequity,
      MAX(f.value) FILTER (WHERE f."lineItem" = 'StockholdersEquity')::float8 AS stockholdersequity,
      MAX(f.value) FILTER (WHERE f."lineItem" = 'CapEx')::float8 AS capex,
      MAX(f.value) FILTER (WHERE f."lineItem" = 'OperatingCashFlow')::float8 AS operatingcashflow
    FROM picked p
    JOIN "Financial" f
      ON f."entityId" = p."entityId" AND f."periodEnd" = p."periodEnd"
     AND f."periodType" = p."periodType"
     AND f."lineItem" IN (${itemPlaceholders})
    GROUP BY p."entityId", p."periodEnd", p."periodType"
  `;

  return { sql, params: [...entityIds, ...FINGERPRINT_LINE_ITEMS] };
}

async function fetchFinancialRows(entityIds: string[]): Promise<Map<string, FinancialRowInput[]>> {
  const byEntity = new Map<string, FinancialRowInput[]>();
  const { sql, params } = buildFinancialQuery(entityIds);
  const rows = await prisma.$queryRawUnsafe<FinancialRowDb[]>(sql, ...params);

  const columns: Array<[NumericColumn, string]> = [
    ["revenue", "Revenue"],
    ["netincome", "NetIncome"],
    ["grossprofit", "GrossProfit"],
    ["totalassets", "TotalAssets"],
    ["totalliabilities", "TotalLiabilities"],
    ["shareholdersequity", "ShareholdersEquity"],
    ["stockholdersequity", "StockholdersEquity"],
    ["capex", "CapEx"],
    ["operatingcashflow", "OperatingCashFlow"],
  ];

  for (const row of rows) {
    const list = byEntity.get(row.entityId) ?? [];
    for (const [column, lineItem] of columns) {
      const value = row[column];
      if (value == null) continue;
      list.push({ periodEnd: row.periodEnd, periodType: row.periodType, lineItem, value });
    }
    byEntity.set(row.entityId, list);
  }
  return byEntity;
}

function buildEvidence(row: CandidateRow, fingerprint: SectorFingerprint): SectorEvidence {
  return {
    ticker: row.ticker,
    market: row.market,
    name: row.canonicalName,
    nameZh: row.namezh,
    cik: row.cik,
    sectorRaw: row.sector,
    industry: row.industry,
    exchange: row.exchange,
    overview: row.overview,
    fingerprint,
  };
}

/**
 * 幂等键。变化即重算，不变即跳过：
 *   · 重复跑同一批不会抖动（分类稳定性的前提）
 *   · overview 事后回补会自动触发重分类（自愈）
 *   · prompt 版本升级即全库重算
 */
function computeInputsHash(evidence: SectorEvidence): string {
  const payload = JSON.stringify({
    promptVersion: SECTOR_CLASSIFY_PROMPT_VERSION,
    market: evidence.market,
    ticker: evidence.ticker,
    name: evidence.name,
    nameZh: evidence.nameZh,
    sectorRaw: evidence.sectorRaw,
    industry: evidence.industry,
    overview: evidence.overview,
    fingerprint: evidence.fingerprint,
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

async function classifyWithRetry(evidence: SectorEvidence, attempts = 2): Promise<SectorClassificationResult> {
  const { system, user } = buildSectorClassificationPrompt(evidence);
  let lastError: Error | null = null;
  let maxTokens = 24000;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const userPrompt =
      attempt === 0
        ? user
        : `${user}\n\n注意：上一次输出不合法（${lastError?.message ?? "未知错误"}）。请严格遵守输出格式，只输出一个合法的 JSON 对象，type 必须是 13 个 key 之一或 unknown。`;

    try {
      const raw = await callJsonLLM({
        systemPrompt: system,
        userPrompt,
        temperature: 0,
        // 该接口背后的模型会先输出 reasoning（多数案例 1–2k tokens，少数疑难案例
        // 能烧到 1.2 万以上）。上限给小时思考未结束就被截断（finish_reason=length），
        // callJsonLLM 会直接报错。检测到截断时重试一次，maxTokens *= 1.5。
        maxTokens,
      });
      return parseSectorClassification(raw);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // 如果是截断错误且还有重试次数，增加 token 预算后重试
      if (lastError.message.includes("finish_reason=length") && attempt < attempts - 1) {
        maxTokens = Math.floor(maxTokens * 1.5);
        console.log(`  ⚠️  Token 截断，增加预算至 ${maxTokens} 后重试...`);
        continue;
      }

      // 其他错误或无重试次数，继续原有逻辑
      if (attempt < attempts - 1) {
        continue;
      }
    }
  }
  throw lastError ?? new Error("分类失败");
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function writeClassification(record: ClassificationRecord): Promise<void> {
  if (record.outcome === "error") {
    throw new Error(`Refusing to persist failed classification for ${record.ticker ?? record.name}`);
  }
  if (
    (record.outcome === "classified" && !isSectorModelType13(record.type)) ||
    (record.outcome === "unknown" && record.type !== null)
  ) {
    throw new Error(`Inconsistent classification result for ${record.ticker ?? record.name}`);
  }

  const metadata = {
    type: record.type,
    label: record.type ? SECTOR_MODEL_13_CONFIG[record.type].label : null,
    outcome: record.outcome,
    confidence: record.confidence,
    reason: record.reason,
    evidenceUsed: record.evidenceUsed,
    needsReview: record.needsReview,
    source: "llm",
    model: process.env.AI_MODEL ?? null,
    promptVersion: SECTOR_CLASSIFY_PROMPT_VERSION,
    inputsHash: record.inputsHash,
    at: new Date().toISOString(),
  };

  // 用 jsonb_set 精准写一个 key，避免整块 metadata 读出再写回（metadata 很大）
  await prisma.$executeRawUnsafe(
    `UPDATE "Entity"
     SET "sectorModelType" = $2,
         metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{sectorModel}', $3::jsonb, true),
         "updatedAt" = NOW()
     WHERE id = $1`,
    record.id,
    record.type,
    JSON.stringify(metadata),
  );
}

async function main(): Promise<boolean> {
  const isDryRun = hasFlag("--dry-run");
  const force = hasFlag("--force");
  const market = getArg("--market") ?? null;
  const limit = getArg("--limit") ? Number(getArg("--limit")) : null;
  const concurrency = Number(getArg("--concurrency") ?? 4);
  const outFile = getArg("--out") ?? "tmp-sector-classify.json";
  const companyArg = getArg("--company");

  const startedAt = Date.now();

  // ── 1. 候选集 ──
  let candidates: CandidateRow[];
  if (companyArg) {
    const queries = companyArg.split(",").map((q) => q.trim()).filter(Boolean);
    const ids = new Set<string>();
    for (const query of queries) {
      const matched = await findCompanies(query);
      if (matched.length === 0) console.warn(`⚠️  未找到公司：${query}`);
      for (const company of matched) ids.add(company.id);
    }
    candidates = await fetchCandidatesByIds([...ids]);
    if (candidates.length < ids.size) {
      console.warn(`⚠️  ${ids.size - candidates.length} 家被能力口径排除（既无 overview 也无财务数据）`);
    }
  } else if (hasFlag("--all")) {
    candidates = await fetchCandidatesByCapability(market, limit);
  } else {
    console.error("用法：--company <ticker> 或 --all（详见文件头注释）");
    process.exit(1);
  }

  console.log(`候选集：${candidates.length} 家${market ? `（market=${market}）` : ""}${isDryRun ? "　[DRY-RUN]" : ""}`);

  // ── 2. 证据包（财务指纹一次性批量取，不做 N+1） ──
  const financials = await fetchFinancialRows(candidates.map((c) => c.id));
  const prepared = candidates.map((candidate) => {
    const fingerprint = computeSectorFingerprint(financials.get(candidate.id) ?? []);
    const evidence = buildEvidence(candidate, fingerprint);
    return { candidate, evidence, inputsHash: computeInputsHash(evidence) };
  });

  const skipped = prepared.filter(
    (item) =>
      shouldSkipSectorClassification(
        item.candidate.sectorModelType,
        item.candidate.sectorModelMetadata,
        item.inputsHash,
        force,
      ),
  );
  const pending = prepared.filter((item) => !skipped.includes(item));

  const humanLocked = prepared.filter(
    (item) =>
      item.candidate.prevsource === "human" &&
      shouldSkipSectorClassification(
        item.candidate.sectorModelType,
        item.candidate.sectorModelMetadata,
        item.inputsHash,
        force,
      ),
  );
  console.log(
    `待分类：${pending.length} 家　跳过（证据未变）：${skipped.length} 家${humanLocked.length > 0 ? `（其中人工锁定 ${humanLocked.length}）` : ""}`,
  );
  if (pending.length === 0) {
    console.log("无待分类项，退出。");
    return false;
  }

  // ── 3. LLM 分类 ──
  let done = 0;
  const records = await mapWithConcurrency(pending, concurrency, async (item): Promise<ClassificationRecord> => {
    const base: ClassificationRecord = {
      id: item.candidate.id,
      ticker: item.candidate.ticker,
      market: item.candidate.market,
      name: item.candidate.canonicalName,
      nameZh: item.candidate.namezh,
      previousType: item.candidate.sectorModelType,
      outcome: "unknown",
      type: null,
      confidence: 0,
      reason: "",
      evidenceUsed: [],
      needsReview: false,
      inputsHash: item.inputsHash,
      overview: item.evidence.overview,
      fingerprint: item.evidence.fingerprint,
    };

    try {
      const result = await classifyWithRetry(item.evidence);
      done++;
      if (done % 25 === 0 || done === pending.length) {
        console.log(`  进度 ${done}/${pending.length}`);
      }
      return { ...base, ...result };
    } catch (error) {
      done++;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ ${item.candidate.ticker ?? item.candidate.canonicalName}：${message}`);
      return { ...base, outcome: "error", error: message };
    }
  });

  // ── 4. 写库 ──
  const writable = records.filter((record) => record.outcome !== "error");
  if (!isDryRun) {
    await mapWithConcurrency(writable, 10, (record) => writeClassification(record));
  }

  // ── 5. 落盘 + 汇总 ──
  const distribution = new Map<string, number>();
  for (const record of records) {
    const key = record.outcome === "unknown" ? "unknown" : record.outcome === "error" ? "error" : record.type!;
    distribution.set(key, (distribution.get(key) ?? 0) + 1);
  }

  const reviewQueue = records.filter((record) => record.needsReview);
  const errors = records.filter((record) => record.outcome === "error");

  writeFileSync(
    outFile,
    JSON.stringify(
      {
        promptVersion: SECTOR_CLASSIFY_PROMPT_VERSION,
        generatedAt: new Date().toISOString(),
        dryRun: isDryRun,
        total: records.length,
        records,
      },
      null,
      2,
    ),
  );

  console.log("\n=======================================================");
  console.log("                  13 类分类结果分布                    ");
  console.log("=======================================================");
  for (const type of SECTOR_MODEL_13_TYPES) {
    const count = distribution.get(type) ?? 0;
    if (count === 0) continue;
    console.log(
      `${SECTOR_MODEL_13_CONFIG[type].label.padEnd(7)} (${type.padEnd(22)}): ${String(count).padStart(4)} 家 (${((count / records.length) * 100).toFixed(1)}%)`,
    );
  }
  console.log(`待定    (unknown               ): ${String(distribution.get("unknown") ?? 0).padStart(4)} 家`);
  if (errors.length > 0) console.log(`失败    (error                 ): ${String(errors.length).padStart(4)} 家`);
  console.log("=======================================================");
  console.log(`需人工复核（置信度 < 0.7）：${reviewQueue.length} 家`);
  for (const record of reviewQueue.slice(0, 10)) {
    console.log(`  · ${record.ticker ?? record.name} → ${record.type} (${record.confidence}) ${record.reason.slice(0, 40)}`);
  }
  if (reviewQueue.length > 10) console.log(`  … 其余 ${reviewQueue.length - 10} 家见 ${outFile}`);
  console.log(`${isDryRun ? "[DRY-RUN] 未写库" : `已写库 ${writable.length} 家`}；结果落盘：${outFile}`);
  console.log(`耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  return errors.length > 0;
}

main()
  .then((hasErrors) => prisma.$disconnect().then(() => process.exit(hasErrors ? 1 : 0)))
  .catch(async (error) => {
    console.error("❌ 分类失败：", error);
    await prisma.$disconnect();
    process.exit(1);
  });
