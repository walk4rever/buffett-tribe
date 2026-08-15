/**
 * generate-portfolio-insight.ts
 *
 * Generates AI-powered quarterly portfolio insights for each master.
 * Queries HoldingChangeSet + MasterProfile, builds a prompt, calls
 * DeepSeek (or configured model), and upserts to PortfolioInsight table.
 *
 * Usage:
 *   tsx scripts/generate-portfolio-insight.ts --master buffett    [--dry-run]
 *   tsx scripts/generate-portfolio-insight.ts --all                [--dry-run]
 */

import { Prisma, PrismaClient } from "@prisma/client";
import "dotenv/config";
import { computeShareDeltaPct } from "@/lib/holding-activity";
import { getTribeMember, getTribeMembers } from "@/lib/tribe";

const db = new PrismaClient();

const AI_API_KEY = process.env.AI_API_KEY;
const AI_API_BASE_URL = process.env.AI_API_BASE_URL;
const AI_MODEL = process.env.AI_MODEL;
const PROMPT_VERSION = "portfolio-insight-v1";

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

function parseQuarterToken(token: string): { year: number; quarter: number } {
  const match = token.match(/^(\d{4})Q([1-4])$/i);
  if (!match) throw new Error(`Invalid quarter token: "${token}". Use format like 2025Q4.`);
  return { year: Number(match[1]), quarter: Number(match[2]) };
}

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------

function formatPct(n: number): string {
  return `${n.toFixed(2)}%`;
}

type QuarterPoint = { year: number; quarter: number };

type PortfolioInsightItem = {
  kind: "summary" | "new" | "add" | "trim" | "exit";
  label: string;
  detail: string;
  ticker?: string;
  nameZh?: string;
  deltaPct?: number;
  shareDeltaPct?: number;
  percentOfPortfolio?: number;
  top5Pct?: number;
  holdingCount?: number;
  totalChanged?: number;
};

type PortfolioInsightStructured = {
  latest: QuarterPoint;
  base: QuarterPoint | null;
  summary: {
    holdingCount: number;
    top5Pct: number;
    totalChanged: number;
    newCount: number;
    addCount: number;
    trimCount: number;
    exitCount: number;
  };
  items: PortfolioInsightItem[];
};

type AIResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function getAvailableQuarters(tribeId: string) {
  const sources = await db.extSource.findMany({
    where: { filer: { is: { tribeId } }, kind: "13f" },
    select: { periodYear: true, periodQuarter: true },
    orderBy: [{ periodYear: "desc" }, { periodQuarter: "desc" }],
  });
  const seen = new Set<string>();
  const uniq: QuarterPoint[] = [];
  for (const s of sources) {
    if (s.periodYear == null || s.periodQuarter == null) continue;
    const key = `${s.periodYear}-${s.periodQuarter}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniq.push({ year: s.periodYear, quarter: s.periodQuarter });
    }
  }
  return uniq;
}

function findBaseQuarter(quarters: QuarterPoint[], latest: QuarterPoint) {
  const idx = quarters.findIndex((q) => q.year === latest.year && q.quarter === latest.quarter);
  return idx >= 0 ? quarters[idx + 1] ?? null : null;
}

async function getHoldingsByQuarter(tribeId: string, year: number, quarter: number) {
  const rows = await db.holding.findMany({
    where: {
      holder: { is: { tribeId } },
      source: { is: { periodYear: year, periodQuarter: quarter, kind: "13f" } },
    },
    include: {
      security: {
        include: {
          company: { select: { canonicalName: true, ticker: true, sector: true } },
        },
      },
    },
    orderBy: { percentOfPortfolio: "desc" },
  });
  return rows;
}

// GICS-ish sector taxonomy stored on Entity.sector (English) — translate the
// ones we have real data for; leave everything else unlabeled rather than
// let the LLM guess a sector from the company name alone (that guessing is
// exactly what mislabeled H&R Block as a "financial" name in 2026Q2).
const SECTOR_LABEL_ZH: Record<string, string> = {
  "Health Care": "医疗保健",
  "Financials": "金融",
  "Technology": "科技",
  "Industrials": "工业",
  "Consumer": "消费",
  "Materials": "材料",
  "Energy": "能源",
  "Consumer Staples": "必需消费",
  "Communication Services": "通信服务",
  "Consumer Discretionary": "可选消费",
  "Utilities": "公用事业",
};

function getSecurityNameParts(row: (Awaited<ReturnType<typeof getHoldingsByQuarter>>)[number]) {
  const meta = ((row.security.metadata && typeof row.security.metadata === "object" && !Array.isArray(row.security.metadata))
    ? row.security.metadata
    : {}) as { nameZh?: string; nameEnShort?: string };
  const ticker = row.security.ticker ?? row.security.company?.ticker ?? null;
  const nameZh = meta.nameZh?.trim() || meta.nameEnShort?.trim() || row.security.company?.canonicalName || row.security.titleOfClass || "";
  const sector = row.security.company?.sector ? SECTOR_LABEL_ZH[row.security.company.sector] ?? null : null;
  return { ticker, nameZh, sector };
}

function formatDisplayName(nameZh: string, ticker: string | null, sector?: string | null) {
  const label = ticker ? `${nameZh}（${ticker}）` : nameZh;
  return sector ? `${label}[${sector}]` : label;
}

async function buildChangeSet(tribeId: string, targetQuarter?: QuarterPoint) {
  const quarters = await getAvailableQuarters(tribeId);
  if (!quarters.length) throw new Error(`No holdings data for ${tribeId}`);

  const latest = targetQuarter
    ? quarters.find((q) => q.year === targetQuarter.year && q.quarter === targetQuarter.quarter)
    : quarters[0];
  if (!latest) {
    const label = `${targetQuarter!.year}Q${targetQuarter!.quarter}`;
    throw new Error(`Quarter ${label} not found for ${tribeId}`);
  }

  const base = findBaseQuarter(quarters, latest);
  const latestRows = await getHoldingsByQuarter(tribeId, latest.year, latest.quarter);
  const baseRows = base ? await getHoldingsByQuarter(tribeId, base.year, base.quarter) : [];

  const top = latestRows.slice(0, 10);
  const keyOf = (r: (typeof latestRows)[number]) => r.securityId;
  const baseById = new Map(baseRows.map((r) => [keyOf(r), r] as const));

  const adds: Array<{ ticker: string | null; nameZh: string; sector: string | null; nowPct: number; deltaPct: number; shareDeltaPct: number }> = [];
  const trims: Array<{ ticker: string | null; nameZh: string; sector: string | null; nowPct: number; deltaPct: number; shareDeltaPct: number }> = [];
  const newPositions: Array<{ ticker: string | null; nameZh: string; sector: string | null; nowPct: number }> = [];
  const exits: Array<{ ticker: string | null; nameZh: string; sector: string | null; prevPct: number }> = [];

  for (const row of latestRows) {
    const prev = baseById.get(keyOf(row));
    const nowPct = row.percentOfPortfolio ?? 0;
    const { ticker, nameZh, sector } = getSecurityNameParts(row);

    if (!prev) {
      newPositions.push({ ticker, nameZh, sector, nowPct });
      continue;
    }
    // percentOfPortfolio delta moves with price and with how fast *other*
    // positions grow, not with whether this position was actually traded
    // (e.g. flat share count but the position's own price fell, or another
    // position ballooned and diluted everyone else's weight). Classify
    // add/trim off the real share-count delta — the same signal the
    // holdings table already uses (computeShareDeltaPct) — and use
    // percentOfPortfolio purely for display magnitude.
    const shareDeltaPct = computeShareDeltaPct(prev.shares, row.shares);
    if (shareDeltaPct == null || Math.abs(shareDeltaPct) < 1) continue;
    const prevPct = prev.percentOfPortfolio ?? 0;
    const deltaPct = nowPct - prevPct;
    if (shareDeltaPct > 0) adds.push({ ticker, nameZh, sector, nowPct, deltaPct, shareDeltaPct });
    else trims.push({ ticker, nameZh, sector, nowPct, deltaPct, shareDeltaPct });
  }

  for (const row of baseRows) {
    if (!latestRows.find((r) => keyOf(r) === keyOf(row))) {
      const { ticker, nameZh, sector } = getSecurityNameParts(row);
      exits.push({
        ticker,
        nameZh,
        sector,
        prevPct: row.percentOfPortfolio ?? 0,
      });
    }
  }

  adds.sort((a, b) => b.deltaPct - a.deltaPct);
  trims.sort((a, b) => a.deltaPct - b.deltaPct);
  newPositions.sort((a, b) => b.nowPct - a.nowPct);
  exits.sort((a, b) => b.prevPct - a.prevPct);

  return { latest, base, top, adds: adds.slice(0, 7), trims: trims.slice(0, 7), newPositions: newPositions.slice(0, 7), exits: exits.slice(0, 7) };
}

function buildHoldingInsights(changeSet: Awaited<ReturnType<typeof buildChangeSet>>): PortfolioInsightItem[] {
  if (!changeSet.latest || !changeSet.top.length) return [];
  const totalChanged =
    changeSet.newPositions.length + changeSet.adds.length + changeSet.trims.length + changeSet.exits.length;
  const top5 = changeSet.top.slice(0, 5).reduce((sum, h) => sum + (h.percentOfPortfolio ?? 0), 0);

  const items: PortfolioInsightItem[] = [
    {
      kind: "summary",
      label: "组合概况",
      detail: `前五大持仓合计 ${top5.toFixed(2)}%，组合集中度${top5 >= 60 ? "较高" : "中等"}${totalChanged > 0 ? `，本季${totalChanged}笔变动` : ""}`,
      top5Pct: top5,
      holdingCount: changeSet.top.length,
      totalChanged,
    },
  ];

  for (const pos of changeSet.newPositions.slice(0, 4)) {
    const displayName = formatDisplayName(pos.nameZh, pos.ticker, pos.sector);
    items.push({
      kind: "new",
      label: "新进",
      detail: `${displayName} 仓位 ${pos.nowPct.toFixed(2)}%`,
      ticker: pos.ticker ?? undefined,
      nameZh: pos.nameZh,
      percentOfPortfolio: pos.nowPct,
    });
  }

  for (const item of changeSet.adds.slice(0, 4)) {
    const displayName = formatDisplayName(item.nameZh, item.ticker, item.sector);
    items.push({
      kind: "add",
      label: "增持",
      detail: `${displayName} 份额+${item.shareDeltaPct.toFixed(1)}%（占比+${item.deltaPct.toFixed(2)}pp → ${item.nowPct.toFixed(2)}%）`,
      ticker: item.ticker ?? undefined,
      nameZh: item.nameZh,
      deltaPct: item.deltaPct,
      shareDeltaPct: item.shareDeltaPct,
      percentOfPortfolio: item.nowPct,
    });
  }

  for (const item of changeSet.trims.slice(0, 4)) {
    const displayName = formatDisplayName(item.nameZh, item.ticker, item.sector);
    items.push({
      kind: "trim",
      label: "减持",
      detail: `${displayName} 份额${item.shareDeltaPct.toFixed(1)}%（占比${item.deltaPct.toFixed(2)}pp → ${item.nowPct.toFixed(2)}%）`,
      ticker: item.ticker ?? undefined,
      nameZh: item.nameZh,
      deltaPct: item.deltaPct,
      shareDeltaPct: item.shareDeltaPct,
      percentOfPortfolio: item.nowPct,
    });
  }

  for (const exit of changeSet.exits.slice(0, 4)) {
    const displayName = formatDisplayName(exit.nameZh, exit.ticker, exit.sector);
    items.push({
      kind: "exit",
      label: "清仓",
      detail: `${displayName} 上季仓位 ${exit.prevPct.toFixed(2)}%`,
      ticker: exit.ticker ?? undefined,
      nameZh: exit.nameZh,
      percentOfPortfolio: exit.prevPct,
    });
  }

  return items;
}

function buildStructuredInsight(
  changeSet: Awaited<ReturnType<typeof buildChangeSet>>,
): PortfolioInsightStructured | null {
  if (!changeSet.latest || !changeSet.top.length) return null;
  const items = buildHoldingInsights(changeSet);
  return {
    latest: changeSet.latest,
    base: changeSet.base,
    summary: {
      holdingCount: changeSet.top.length,
      top5Pct: changeSet.top.slice(0, 5).reduce((sum, h) => sum + (h.percentOfPortfolio ?? 0), 0),
      totalChanged:
        changeSet.newPositions.length +
        changeSet.adds.length +
        changeSet.trims.length +
        changeSet.exits.length,
      newCount: changeSet.newPositions.length,
      addCount: changeSet.adds.length,
      trimCount: changeSet.trims.length,
      exitCount: changeSet.exits.length,
    },
    items,
  };
}

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

function buildPrompt(
  masterName: string,
  quarter: string,
  changeSet: Awaited<ReturnType<typeof buildChangeSet>>,
): string {
  const topList = changeSet.top
    .slice(0, 5)
    .map((h, i) => {
      const { ticker, nameZh, sector } = getSecurityNameParts(h);
      return `${i + 1}. ${formatDisplayName(nameZh, ticker, sector)} (${formatPct(h.percentOfPortfolio ?? 0)})`;
    })
    .join("；");

  const newList =
    changeSet.newPositions.length > 0
      ? changeSet.newPositions.map((p) => `${formatDisplayName(p.nameZh, p.ticker, p.sector)} (${formatPct(p.nowPct)})`).join("、")
      : "无";
  const addList =
    changeSet.adds.length > 0
      ? changeSet.adds
          .map((a) => `${formatDisplayName(a.nameZh, a.ticker, a.sector)} 份额+${a.shareDeltaPct.toFixed(1)}%（占比+${a.deltaPct.toFixed(2)}pp → ${formatPct(a.nowPct)}）`)
          .join("、")
      : "无";
  const trimList =
    changeSet.trims.length > 0
      ? changeSet.trims
          .map((t) => `${formatDisplayName(t.nameZh, t.ticker, t.sector)} 份额${t.shareDeltaPct.toFixed(1)}%（占比${t.deltaPct.toFixed(2)}pp → ${formatPct(t.nowPct)}）`)
          .join("、")
      : "无";
  const exitList =
    changeSet.exits.length > 0
      ? changeSet.exits.map((e) => `${formatDisplayName(e.nameZh, e.ticker, e.sector)}（上季${formatPct(e.prevPct)}）`).join("、")
      : "无";

  return `作为一位资深价值投资分析师，请基于以下数据，为 **${masterName}** 基金撰写一份 ${quarter} 持仓洞察。用中文输出。300字以内。

**前五大持仓**：
${topList || "无数据"}

**本季新进**：
${newList}

**增持**（份额较上季增加 ≥1%，非仅占比上升）：
${addList}

**减持**（份额较上季减少 ≥1%，非仅占比下降）：
${trimList}

**清仓退出**：
${exitList}

---

请撰写 3-5 句连贯的持仓洞察，从以下角度分析：
1. **整体仓位方向**：该季度是进攻还是防御？仓位是集中还是分散？
2. **行业侧重变化**：科技、消费、金融、能源等行业的增减情况——只使用上面标的名称后方括号里给出的行业标签，没有标出行业的标的不要臆测或归类
3. **风格一致性**：这些操作是否符合其一贯的投资理念？有无值得注意的背离？

输出为纯中文文本段落，不要 markdown 标记，不要标题。语气冷静客观，有数据支撑。`;
}

// ---------------------------------------------------------------------------
// AI call
// ---------------------------------------------------------------------------

async function callAI(prompt: string): Promise<string> {
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
        {
          role: "system",
          content:
            "你是一位资深价值投资分析师，擅长分析13F持仓变化并撰写简洁有力的季度点评。输出为纯中文文本。",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.6,
      max_tokens: 16000,
      stream: false,
    }),
    signal: AbortSignal.timeout(90000),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`AI API error ${res.status}: ${errText}`);
  }

  const data = (await res.json()) as AIResponse;
  const text: string = data?.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) throw new Error("AI returned empty response");
  return text;
}

// ---------------------------------------------------------------------------
// Upsert
// ---------------------------------------------------------------------------

async function upsertInsight(
  masterId: string,
  year: number,
  quarter: number,
  structured: PortfolioInsightStructured | null,
  narrative: string,
  dryRun: boolean,
) {
  if (dryRun) {
    console.log(`\n[Dry-run] Would upsert for ${masterId} ${year}Q${quarter}:`);
    console.log(`  structured: ${structured ? `${structured.items.length} items` : "null"}`);
    console.log(`  narrative: ${narrative.slice(0, 120)}...`);
    console.log(`  len: ${narrative.length} chars`);
    return;
  }

  const source = AI_MODEL ?? "deepseek";
  await db.$transaction(async (tx) => {
    await tx.portfolioInsight.upsert({
      where: { masterId_year_quarter: { masterId, year, quarter } },
      update: {
        structured: structured ? toJsonValue(structured) : Prisma.JsonNull,
        narrative,
        source,
        generatedAt: new Date(),
        version: { increment: 1 },
      },
      create: {
        masterId,
        year,
        quarter,
        structured: structured ? toJsonValue(structured) : Prisma.JsonNull,
        narrative,
        source,
      },
    });

    await createGeneratedContentVersion({
      tx,
      scopeType: "portfolio",
      scopeId: `${masterId}:${year}Q${quarter}`,
      artifactType: "portfolio_insight",
      payload: toJsonValue({ structured, narrative }),
      source,
      promptVersion: PROMPT_VERSION,
    });
  });

  console.log(`  ✓ Upserted to DB (${narrative.length} chars)`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function generateFor(masterId: string, dryRun: boolean, targetQuarter?: QuarterPoint) {
  const name = (await getTribeMember(masterId))?.nameZh ?? masterId;

  console.log(`\n📋 ${name} (${masterId})`);

  // 1. Get quarterly change set
  let changeSet: Awaited<ReturnType<typeof buildChangeSet>>;
  try {
    changeSet = await buildChangeSet(masterId, targetQuarter);
  } catch (err: unknown) {
    console.log(`  ⚠️  Skipped: ${getErrorMessage(err)}`);
    return;
  }

  if (!changeSet.latest) {
    console.log("  ⚠️  No holdings data");
    return;
  }

  const quarter = `${changeSet.latest.year}Q${changeSet.latest.quarter}`;
  console.log(`  Quarter: ${quarter} | Top ${changeSet.top.length} holdings`);

  const structured = buildStructuredInsight(changeSet);

  // 2. Build prompt and call AI
  const prompt = buildPrompt(name, quarter, changeSet);
  console.log(`  Prompt: ${prompt.length} chars`);

  if (dryRun) {
    console.log(`  DRY-RUN: prompt preview:\n${prompt.slice(0, 800)}...\n`);
    await upsertInsight(
      masterId,
      changeSet.latest.year,
      changeSet.latest.quarter,
      structured,
      "[dry-run] narrative preview skipped",
      true,
    );
    return;
  }

  try {
    const narrative = await callAI(prompt);
    await upsertInsight(
      masterId,
      changeSet.latest.year,
      changeSet.latest.quarter,
      structured,
      narrative,
      dryRun,
    );
  } catch (err: unknown) {
    console.error(`  ❌ AI error: ${getErrorMessage(err)}`);
  }
}

async function main() {
  const dryRun = hasFlag("--dry-run");
  if (dryRun) console.log("🔍 Dry-run mode\n");

  const master = getArg("--master");
  const all = hasFlag("--all");
  const quarterToken = getArg("--quarter");
  const yearArg = getArg("--year");
  const quarterArg = getArg("--quarter-num");
  const targetQuarter = quarterToken
    ? parseQuarterToken(quarterToken)
    : yearArg && quarterArg
      ? { year: Number(yearArg), quarter: Number(quarterArg) }
      : undefined;

  if (!master && !all) {
    console.log("Usage:");
    console.log("  tsx scripts/generate-portfolio-insight.ts --master buffett [--quarter 2025Q4] [--dry-run]");
    console.log("  tsx scripts/generate-portfolio-insight.ts --all [--quarter 2025Q4] [--dry-run]");
    process.exit(0);
  }

  const masters = all ? (await getTribeMembers()).map((m) => m.id) : [master!];
  for (const id of masters) {
    await generateFor(id, dryRun, targetQuarter);
  }

  console.log("\n✅ Done.");
  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
