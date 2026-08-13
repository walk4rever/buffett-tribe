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
import { getTribeMember, getTribeMembers } from "@/lib/tribe";

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

/** Total 13F-reportable value of the master's latest holdings, in USD. */
function totalAumUsd(holdings: Awaited<ReturnType<typeof queryHoldings>>): bigint {
  return holdings.reduce((sum, h) => sum + (h.valueUsd ?? BigInt(0)), BigInt(0));
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
  materials: Awaited<ReturnType<typeof fetchMaterialCounts>>;
}): string {
  const aum = totalAumUsd(params.holdings);
  const aumLabel = formatAum(aum);

  const matLines = params.materials.length
    ? params.materials.map((m) => `  ${m.type}: ${m.count}篇 (${m.range})`).join("\n")
    : "  无内部资料库收录（暂无信件、访谈等一手资料），请勿在 timeline 或 intro 中编造资料库相关内容。";

  return `你是一位资深的价值投资研究分析师。请基于以下数据，为投资大师 ${params.masterNameZh}（${params.masterName}）生成结构化的投资档案。

## 输入数据

### 基金规模（${params.latestLabel}，真实计算值，请直接引用，不要自行估算或改写）
最新一期 13F 可报告持仓总市值：${aumLabel}
持仓数量：${params.holdings.length}只

### 资料库
${matLines}

## 输出要求

请严格输出以下 JSON 格式，不要包含 markdown 代码块标记，只输出纯 JSON。所有中文文本句尾使用中文句号（。）。

{
  "bio": "投资人个人经历与投资理念，150-250字：教育/职业背景、职业转折、投资理念与方法论、代表性投资/维权事件等确凿可信的事实。",
  "fundOverview": "基金公司基本情况，80-150字：成立时间与背景（如可考）、组织形式、当前 13F 可报告资产规模（用上方提供的真实数值，不要自行估算）等基本信息。"
}

重要约束：
1. 只写你有把握的事实。如果某人公开资料很少，bio 就写得简短，宁可只有一两句话，也不要为了凑够字数编造，更不要使用"未知年份""不详""无可信公开数据"这类占位句式反复堆砌——没有实质内容的条目直接不写。
2. fundOverview 不要涉及具体持仓集中度、行业分布、个股仓位、季度调仓变化等内容——这些属于持仓洞察模块，由另一个流程单独生成，这里只写基金本身的背景与规模信息。
3. 输出必须是纯 JSON，不要包含 \`\`\`json 包裹。`;
}

function formatAum(usd: bigint): string {
  const n = Number(usd);
  if (!Number.isFinite(n) || n <= 0) return "数据暂缺";
  if (n >= 1e8) return `约${(n / 1e8).toFixed(1)}亿美元`;
  if (n >= 1e4) return `约${(n / 1e4).toFixed(1)}万美元`;
  return `$${n.toLocaleString()}`;
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
  const required = ["bio", "fundOverview"];
  const missing = required.filter((k) => !(k in obj));
  if (missing.length) throw new Error(`Missing fields: ${missing.join(", ")}`);
  if (typeof obj.bio !== "string") throw new Error("bio must be a string");
  if (typeof obj.fundOverview !== "string") throw new Error("fundOverview must be a string");
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

  const tribeIds = all ? (await getTribeMembers()).map((m) => m.id) : [masterId!];

  for (const tribeId of tribeIds) {
    console.log(`\n─── ${tribeId} ───`);

    const entity = await getMasterEntity(tribeId);
    if (!entity) {
      console.log(`  SKIP: no entity with tribeId="${tribeId}"`);
      continue;
    }

    const member = await getTribeMember(tribeId);
    if (!member) {
      console.log(`  SKIP: no Filer/tribe member for tribeId="${tribeId}"`);
      continue;
    }

    const { label: latestLabel, rows: holdings } = await fetchLatestHoldings(entity.id);
    // The Source table only ever holds Buffett's shareholder/partnership letters
    // (no owner column) — only pull it in for the core members it actually
    // describes, or the LLM attributes Buffett's letter archive to whoever
    // else we're profiling.
    const materials = member.category === "core" ? await fetchMaterialCounts() : [];

    console.log(`  Holdings: ${holdings.length} (${latestLabel})`);
    console.log(`  Material types: ${materials.length}`);

    // Prompt with the person's real name (member.name/nameZh), not
    // entity.canonicalName (the 13F filer's legal/firm name, e.g. "Dalal
    // Street, LLC") — asking an LLM to profile an obscure fund-registration
    // name instead of the actual, often well-documented, person produces
    // "no public data available" filler for everything, even when the
    // person themself is extensively documented (e.g. Mohnish Pabrai).
    const prompt = buildPrompt({
      masterName: member.name,
      masterNameZh: member.nameZh,
      tribeId,
      latestLabel,
      holdings,
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
        bio?: unknown;
        fundOverview?: unknown;
      };
      console.log(`  ✓ Profile saved (v${(await db.masterProfile.findUnique({ where: { entityId: entity.id }, select: { version: true } }))?.version ?? 0})`);
      console.log(`    bio: ${String(profile.bio).length} chars`);
      console.log(`    fundOverview: ${String(profile.fundOverview).length} chars`);
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
