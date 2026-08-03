/**
 * generate-master-profile.ts
 *
 * Queries DB for a master's holdings, sector exposure, and material counts,
 * then calls an LLM to compose a structured investment profile.
 *
 * Usage:
 *   tsx scripts/generate-master-profile.ts --master buffett    [--dry-run]
 *   tsx scripts/generate-master-profile.ts --all                [--dry-run]
 */

import { Prisma, PrismaClient } from "@prisma/client";
import { TRIBE_MEMBERS } from "@/lib/tribe";

const db = new PrismaClient();

const AI_API_KEY = process.env.AI_API_KEY;
const AI_API_BASE_URL = process.env.AI_API_BASE_URL;
const AI_MODEL = process.env.AI_MODEL;
const PROMPT_VERSION = "master-profile-v1";

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

async function createGeneratedContentVersion(params: {
  tx: Prisma.TransactionClient;
  scopeType: string;
  scopeId: string;
  artifactType: string;
  payload: Prisma.InputJsonValue;
  source: string;
  promptVersion: string;
}) {
  const latest = await params.tx.generatedContentVersion.aggregate({
    where: {
      scopeType: params.scopeType,
      scopeId: params.scopeId,
      artifactType: params.artifactType,
    },
    _max: { versionSeq: true },
  });

  return params.tx.generatedContentVersion.create({
    data: {
      scopeType: params.scopeType,
      scopeId: params.scopeId,
      artifactType: params.artifactType,
      versionSeq: (latest._max.versionSeq ?? 0) + 1,
      payload: params.payload,
      source: params.source,
      promptVersion: params.promptVersion,
    },
  });
}

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

function getArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  return args.find((_, i) => args[i - 1] === flag);
}
function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

// ---------------------------------------------------------------------------
// DB queries
// ---------------------------------------------------------------------------

async function getMasterEntity(tribeId: string) {
  return db.entity.findFirst({
    where: { tribeId, type: "master" },
    select: { id: true, canonicalName: true, tribeId: true },
  });
}

/** Latest quarter's holdings with sector info for the master's entity (holder). */
async function fetchLatestHoldings(entityId: string) {
  const sources = await db.extSource.findMany({
    where: { filerEntityId: entityId, kind: "13f" },
    select: { periodYear: true, periodQuarter: true },
    orderBy: [{ periodYear: "desc" }, { periodQuarter: "desc" }],
    take: 1,
  });
  if (!sources.length) return { label: "暂无数据", rows: [] as Awaited<ReturnType<typeof queryHoldings>> };

  const latest = sources[0];
  const rows = await queryHoldings(entityId, latest.periodYear!, latest.periodQuarter!);
  return { label: `${latest.periodYear} Q${latest.periodQuarter}`, rows };
}

async function queryHoldings(entityId: string, year: number, quarter: number) {
  const rows = await db.holding.findMany({
    where: {
      holderEntityId: entityId,
      source: { is: { periodYear: year, periodQuarter: quarter, kind: "13f" } },
    },
    include: {
      security: {
        include: {
          company: {
            select: {
              canonicalName: true,
              ticker: true,
              sector: true,
            },
          },
        },
      },
    },
    orderBy: { percentOfPortfolio: "desc" },
  });

  return rows.map((r) => {
    const companyEntity = r.security.company;
    const meta = ((r.security.metadata && typeof r.security.metadata === "object" && !Array.isArray(r.security.metadata))
      ? r.security.metadata
      : {}) as { nameZh?: string; nameEnShort?: string };
    return {
      ticker: r.security.ticker ?? companyEntity?.ticker ?? null,
      name: meta.nameEnShort?.trim() || meta.nameZh?.trim() || companyEntity?.canonicalName || r.security.titleOfClass || "Unknown",
      pct: r.percentOfPortfolio ?? 0,
      sector: companyEntity?.sector ?? null,
      valueUsd: r.valueUsd,
      shares: r.shares,
    };
  });
}

/** Sector breakdown for the master's latest holdings. */
function sectorBreakdown(holdings: Awaited<ReturnType<typeof queryHoldings>>) {
  const bySector = new Map<string, number>();
  for (const h of holdings) {
    const sec = h.sector ?? "未知";
    bySector.set(sec, (bySector.get(sec) ?? 0) + h.pct);
  }
  return [...bySector.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([sector, pct]) => ({ sector, pct: Math.round(pct * 10) / 10 }));
}

/** Portfolio changes across available quarters (for trend analysis). */
async function fetchPortfolioTrend(entityId: string, maxQuarters = 8) {
  const sources = await db.extSource.findMany({
    where: { filerEntityId: entityId, kind: "13f" },
    select: { periodYear: true, periodQuarter: true },
    orderBy: [{ periodYear: "desc" }, { periodQuarter: "desc" }],
    take: maxQuarters,
  });

  const snapshots: Array<{
    label: string;
    count: number;
    top5Pct: number;
    top10Pct: number;
  }> = [];

  for (const src of sources) {
    const rows = await queryHoldings(entityId, src.periodYear!, src.periodQuarter!);
    const top5 = rows.slice(0, 5).reduce((s, r) => s + r.pct, 0);
    const top10 = rows.slice(0, 10).reduce((s, r) => s + r.pct, 0);
    snapshots.push({
      label: `${src.periodYear} Q${src.periodQuarter}`,
      count: rows.length,
      top5Pct: Math.round(top5 * 10) / 10,
      top10Pct: Math.round(top10 * 10) / 10,
    });
  }

  return snapshots;
}

/** Count source materials grouped by type. */
async function fetchMaterialCounts() {
  const rows = await db.source.findMany({
    select: { type: true, year: true },
  });
  const byType = new Map<string, { count: number; minYear: number; maxYear: number }>();
  for (const r of rows) {
    const prev = byType.get(r.type) ?? { count: 0, minYear: Infinity, maxYear: -Infinity };
    byType.set(r.type, {
      count: prev.count + 1,
      minYear: Math.min(prev.minYear, r.year),
      maxYear: Math.max(prev.maxYear, r.year),
    });
  }
  return [...byType.entries()].map(([type, stats]) => ({
    type,
    count: stats.count,
    range: stats.minYear === Infinity ? "—" : `${stats.minYear}-${stats.maxYear}`,
  }));
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildPrompt(params: {
  masterName: string;
  masterNameZh: string;
  tribeId: string;
  latestLabel: string;
  holdings: Awaited<ReturnType<typeof queryHoldings>>;
  sectors: ReturnType<typeof sectorBreakdown>;
  trend: Awaited<ReturnType<typeof fetchPortfolioTrend>>;
  materials: Awaited<ReturnType<typeof fetchMaterialCounts>>;
}): string {
  const top15 = params.holdings.slice(0, 15)
    .map((h, i) => `${i + 1}. ${h.ticker ?? h.name} — ${h.pct.toFixed(2)}% (${h.sector ?? "未知"})`)
    .join("\n");

  const sectorLines = params.sectors
    .map((s) => `  ${s.sector}: ${s.pct}%`)
    .join("\n");

  const trendLines = params.trend
    .map((t) => `  ${t.label}: ${t.count}只持仓, 前5集中度=${t.top5Pct}%, 前10=${t.top10Pct}%`)
    .join("\n");

  const matLines = params.materials.length
    ? params.materials.map((m) => `  ${m.type}: ${m.count}篇 (${m.range})`).join("\n")
    : "  无内部资料库收录（暂无信件、访谈等一手资料），请勿在 timeline 或 intro 中编造资料库相关内容。";

  return `你是一位资深的价值投资研究分析师。请基于以下数据，为投资大师 ${params.masterNameZh}（${params.masterName}）生成结构化的投资档案。

## 输入数据

### 最新持仓（${params.latestLabel}）
前15大持仓：
${top15}

### 行业分布
${sectorLines}

### 持仓趋势（近${params.trend.length}个季度）
${trendLines}

### 资料库
${matLines}

## 输出要求

请严格输出以下 JSON 格式，不要包含 markdown 代码块标记，只输出纯 JSON。所有中文文本句尾使用中文句号（。）。

{
  "intro": "150-200字的中文简介，概括投资理念、风格和成就。",
  "framework": [
    "投资原则1（15-25字）",
    "投资原则2",
    "投资原则3",
    "投资原则4"
  ],
  "tags": ["标签1", "标签2", "标签3", "标签4"],
  "timeline": [
    "年份：事件描述（20-40字）——仅限人生/职业里程碑，不要包含投资买入事件",
    "...",
    "...共5-7条..."
  ],
  "style": {
    "concentration": "组合集中度描述，如'前5大持仓占比约75%，集中度较高'",
    "holdingCount": "当前持仓数量，如'约25只'",
    "sectorFocus": ["重仓行业1", "重仓行业2", "重仓行业3"],
    "turnover": "换手特征描述，如'季度调整通常不超过组合的5%，典型买入并持有风格'",
    "avgHoldingPeriod": "典型持有周期描述，如'核心持仓通常持有5-10年以上'",
    "leverageUsage": "杠杆使用情况描述，如'不使用杠杆；保险浮存金提供低成本长期资金'或'不适用'"
  },
  "flagshipCases": [
    {
      "ticker": "股票代码",
      "nameZh": "公司中文名",
      "entryYear": 建仓年份数字,
      "thesis": "投资逻辑概述（30-50字）",
      "outcome": "结果简述（20-30字）",
      "stillHolding": true或false
    }
  ],
  "influences": ["思想来源1", "思想来源2", "思想来源3"],
  "quotes": ["代表性语录1（精炼，30字以内）", "代表性语录2"],
  "trackRecord": {
    "startYear": 开始管理年份数字,
    "cagr": "年化回报率描述，无确切数据则填null",
    "benchmarkComparison": "与基准对比描述，无确切数据则填null",
    "sourceNote": "数据来源说明，如'基于公开披露数据估算'或'非公开数据'"
  }
}

重要约束：
1. timeline 仅包含人生/职业里程碑（毕业、创立公司、出版著作、结识导师等），不要包含任何投资买入事件。投资事件请放入 flagshipCases。
2. flagshipCases 必须仅包含当前持仓中的公司（检查 ticker 是否在前15大持仓中出现），生成3-5个案例。
3. 如果某些字段没有足够数据支撑（如 trackRecord.cagr），写 "无可信公开数据" 而不是编造。
4. tags 必须反映该大师的真实投资风格特征，基于持仓集中度、行业偏好和换手特征。
5. 对于段永平的杠杆说明，应提及他的现金流充沛但明确反对杠杆的立场。
6. 输出必须是纯 JSON，不要包含 \`\`\`json 包裹。`;
}

// ---------------------------------------------------------------------------
// AI call
// ---------------------------------------------------------------------------

async function callAI(prompt: string): Promise<unknown> {
  if (!AI_API_KEY || !AI_API_BASE_URL || !AI_MODEL) {
    throw new Error("Missing AI_API_KEY / AI_API_BASE_URL / AI_MODEL env vars");
  }

  const res = await fetch(`${AI_API_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_API_KEY}`,
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        { role: "system", content: "You are a professional value investment analyst specializing in investor profiles. Output only valid JSON. Use Chinese for all text content." },
        { role: "user", content: prompt },
      ],
      temperature: 0.5,
      // CJK output is more token-dense than the English-heavy US filings this
      // limit was originally tuned against — 4000 truncated mid-JSON for
      // christopher-begg (see commit 1a055f2e for the same symptom/fix on
      // generate:value-analysis / generate:management-analysis).
      max_tokens: 7000,
      stream: false,
    }),
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`AI API error ${res.status}: ${errText}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = data.choices?.[0]?.message?.content?.trim() ?? "";

  // Strip markdown code block if present
  const jsonText = raw.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
  return JSON.parse(jsonText);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateProfile(raw: unknown): asserts raw is Record<string, unknown> {
  const obj = raw as Record<string, unknown>;
  const required = ["intro", "framework", "tags", "timeline", "style", "flagshipCases", "influences", "quotes"];
  const missing = required.filter((k) => !(k in obj));
  if (missing.length) throw new Error(`Missing fields: ${missing.join(", ")}`);
  if (!Array.isArray(obj.framework)) throw new Error("framework must be an array");
  if (!Array.isArray(obj.tags)) throw new Error("tags must be an array");
  if (!Array.isArray(obj.timeline)) throw new Error("timeline must be an array");
  if (!Array.isArray(obj.flagshipCases)) throw new Error("flagshipCases must be an array");
  if (!Array.isArray(obj.influences)) throw new Error("influences must be an array");
  if (!Array.isArray(obj.quotes)) throw new Error("quotes must be an array");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const masterId = getArg("--master");
  const all = hasFlag("--all");
  const dryRun = hasFlag("--dry-run");

  if (!masterId && !all) {
    console.error("Usage: tsx scripts/generate-master-profile.ts --master <buffett|lilu|duan> [--dry-run]");
    console.error("       tsx scripts/generate-master-profile.ts --all [--dry-run]");
    process.exit(1);
  }

  const tribeIds = all ? TRIBE_MEMBERS.map((m) => m.id) : [masterId!];

  for (const tribeId of tribeIds) {
    console.log(`\n─── ${tribeId} ───`);

    const entity = await getMasterEntity(tribeId);
    if (!entity) {
      console.log(`  SKIP: no entity with tribeId="${tribeId}"`);
      continue;
    }

    const masterNames: Record<string, string> = {
      buffett: "巴菲特",
      lilu: "李录",
      duan: "段永平",
    };

    const { label: latestLabel, rows: holdings } = await fetchLatestHoldings(entity.id);
    const sectors = sectorBreakdown(holdings);
    const trend = await fetchPortfolioTrend(entity.id);
    // The Source table only ever holds Buffett's shareholder/partnership letters
    // (no owner column) — only pull it in for the core members it actually
    // describes, or the LLM attributes Buffett's letter archive to whoever
    // else we're profiling.
    const materials = tribeId in masterNames ? await fetchMaterialCounts() : [];

    console.log(`  Holdings: ${holdings.length} (${latestLabel})`);
    console.log(`  Sectors: ${sectors.length}`);
    console.log(`  Trend snapshots: ${trend.length}`);
    console.log(`  Material types: ${materials.length}`);

    const prompt = buildPrompt({
      masterName: entity.canonicalName,
      masterNameZh: masterNames[tribeId] ?? entity.canonicalName,
      tribeId,
      latestLabel,
      holdings,
      sectors,
      trend,
      materials,
    });

    console.log(`  Prompt length: ${prompt.length} chars`);

    if (dryRun) {
      console.log("  DRY-RUN: prompt preview:");
      console.log("  " + prompt.slice(0, 500).replace(/\n/g, "\n  ") + "...\n");
      continue;
    }

    try {
      const result = await callAI(prompt);
      validateProfile(result);

      const source = AI_MODEL ?? "unknown";
      await db.$transaction(async (tx) => {
        await tx.masterProfile.upsert({
          where: { entityId: entity.id },
          create: {
            entityId: entity.id,
            profile: toJsonValue(result),
            source,
            version: 1,
            generatedAt: new Date(),
          },
          update: {
            profile: toJsonValue(result),
            source,
            version: { increment: 1 },
            generatedAt: new Date(),
          },
        });

        await createGeneratedContentVersion({
          tx,
          scopeType: "master",
          scopeId: entity.id,
          artifactType: "master_profile",
          payload: toJsonValue(result),
          source,
          promptVersion: PROMPT_VERSION,
        });
      });

      const profile = result as {
        intro?: unknown;
        framework?: unknown[];
        flagshipCases?: unknown[];
      };
      console.log(`  ✓ Profile saved (v${(await db.masterProfile.findUnique({ where: { entityId: entity.id }, select: { version: true } }))?.version ?? 0})`);
      console.log(`    intro: ${String(profile.intro).length} chars`);
      console.log(`    framework: ${Array.isArray(profile.framework) ? profile.framework.length : 0} items`);
      console.log(`    flagshipCases: ${Array.isArray(profile.flagshipCases) ? profile.flagshipCases.length : 0} cases`);
    } catch (err) {
      console.error(`  ✗ Failed:`, err instanceof Error ? err.message : String(err));
    }
  }

  await db.$disconnect();
}

main().catch(async (err) => {
  console.error("[generate-master-profile] fatal", err);
  await db.$disconnect();
  process.exit(1);
});
