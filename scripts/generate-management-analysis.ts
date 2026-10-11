/**
 * Generate management analysis (资本配置行为分析) for companies.
 *
 * Usage:
 *   tsx scripts/generate-management-analysis.ts --company MCO [--dry-run] [--force]
 *   tsx scripts/generate-management-analysis.ts --all [--dry-run] [--force]
 */

import "dotenv/config";
import {
  AI_MODEL,
  assertDbCapacityForBatch,
  buildFinancialHistoryText,
  callJsonLLM,
  disconnectPrisma,
  fetchFinancials,
  findCompanies,
  getArg,
  hasFlag,
  jsonObject,
  normalizeText,
  parseJsonObject,
  prisma,
  toJsonValue,
  truncateText,
} from "./lib/company-generation";

const ARTIFACT_TYPE = "management_analysis";

type ManagementPayload = {
  headline: string;
  capitalAllocation: { score: number; cards: unknown[] };
  alignment: { cards: unknown[] };
  watchlist: unknown[];
};

const SYSTEM_PROMPT = `You are a professional value investment analyst. Generate a Chinese management analysis in JSON format.

This analysis focuses on capital allocation BEHAVIOR — what management did, not who they are.
Judge management by their actions: buybacks, dividends, M&A, returns on capital, dilution discipline.

Output shape:
{
  "headline": "40字以内的管理层总评，行为导向",
  "capitalAllocation": {
    "score": 1-10,
    "cards": [
      { "label": "回购与分红", "enLabel": "Buybacks & Dividends", "verdict": "40字左右的评价", "evidence": "60字左右的具体证据，引用数字", "sourceRef": "来源标注，如 10-K FY2025 Item 5 / FY2020-2025 财务数据" },
      { "label": "并购与投资", "enLabel": "M&A & Investments", "verdict": "...", "evidence": "...", "sourceRef": "..." },
      { "label": "资本回报纪律", "enLabel": "Return Discipline", "verdict": "...", "evidence": "ROE/利润率趋势证据", "sourceRef": "..." }
    ]
  },
  "alignment": {
    "cards": [
      { "label": "股本稀释 vs 回笼", "verdict": "...", "evidence": "净利润与EPS增速差所隐含的股本变化", "sourceRef": "FY2020-2025 财务数据" },
      { "label": "薪酬与激励", "verdict": "数据不足，待接入 DEF 14A 委托书。", "evidence": "", "sourceRef": "" }
    ]
  },
  "watchlist": ["3-4条后续观察项，每条20字以内"]
}

Rules:
- Only use the provided data. Never invent numbers. If evidence is thin, say "数据不足" and lower the score.
- 薪酬与激励 card: we have no proxy statement data, always output the 数据不足 verdict as shown.
- Every verdict/evidence must end with a Chinese full stop. No investment advice (no 买入/卖出 wording).
- Output ONLY valid JSON.`;

async function fetchBuybackEvidence(entityId: string): Promise<string> {
  const sections = await prisma.filingSection.findMany({
    where: { entityId, section: { in: ["item_5_market", "item_7_mda"] } },
    select: { section: true, content: true, source: { select: { periodYear: true } } },
    orderBy: { source: { periodYear: "desc" } },
    take: 4,
  });
  return sections
    .map(
      (s) =>
        `[10-K FY${s.source?.periodYear ?? "?"} ${s.section}]\n${truncateText(s.content, s.section === "item_5_market" ? 2400 : 1800)}`
    )
    .join("\n\n");
}

function parsePayload(raw: string): ManagementPayload {
  const parsed = parseJsonObject(raw);
  const capitalAllocation = jsonObject(parsed.capitalAllocation);
  const alignment = jsonObject(parsed.alignment);
  if (
    !normalizeText(parsed.headline) ||
    !capitalAllocation ||
    !Array.isArray(capitalAllocation.cards) ||
    !alignment ||
    !Array.isArray(alignment.cards) ||
    !Array.isArray(parsed.watchlist)
  ) {
    throw new Error("Invalid management analysis structure");
  }
  return parsed as unknown as ManagementPayload;
}

async function main() {
  const companyQuery = getArg("--company");
  const dryRun = hasFlag("--dry-run");
  const force = hasFlag("--force");
  const all = hasFlag("--all");

  if (!companyQuery && !all) {
    console.error("Usage: tsx scripts/generate-management-analysis.ts --company <ticker|name|cik> [--dry-run] [--force]");
    process.exit(1);
  }

  const companies = await findCompanies(companyQuery);
  if (!companies.length) {
    console.error(`No company found for: ${companyQuery}`);
    process.exit(1);
  }

  console.log(`Found ${companies.length} company(s) to process\n`);
  await assertDbCapacityForBatch(companies.length);

  for (const company of companies) {
    const label = `${company.canonicalName}${company.ticker ? ` (${company.ticker})` : ""}`;
    console.log(`--- ${label} ---`);

    const existing = await prisma.companyAnalysis.findUnique({
      where: { entityId: company.id },
      select: { management: true, version: true, updatedAt: true },
    });
    if (existing?.management != null && !force) {
      console.log(`  SKIP: already has ${ARTIFACT_TYPE} v${existing.version} (${existing.updatedAt.toISOString()}), use --force`);
      continue;
    }

    const [financials, buybackEvidence] = await Promise.all([
      fetchFinancials(company.id, 6),
      fetchBuybackEvidence(company.id),
    ]);

    console.log(`  Financials: ${financials.length}y | Buyback evidence: ${buybackEvidence.length} chars`);

    const prompt = `Company: ${company.canonicalName}${company.ticker ? ` (${company.ticker})` : ""}
Sector: ${company.sector ?? "N/A"}

Financial history (FY):
${buildFinancialHistoryText(financials)}

SEC filing evidence (buybacks, MD&A):
${buybackEvidence || "  none"}

Generate the management analysis payload.`;

    if (dryRun) {
      console.log(`  DRY-RUN: prompt ${prompt.length} chars`);
      console.log(`  Preview:\n${prompt.slice(0, 1200)}\n  ...`);
      continue;
    }

    try {
      const content = await callJsonLLM({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: prompt,
        temperature: 0.4,
        maxTokens: 16000,
      });
      const payload = parsePayload(content);
      const source = AI_MODEL ?? "unknown";

      await prisma.companyAnalysis.upsert({
        where: { entityId: company.id },
        create: {
          entityId: company.id,
          management: toJsonValue(payload),
          source,
          version: 1,
        },
        update: {
          management: toJsonValue(payload),
          source,
          version: { increment: 1 },
        },
      });
      console.log(`  Saved ${ARTIFACT_TYPE} (cards: ${payload.capitalAllocation.cards.length})`);
    } catch (err) {
      console.error("  Failed:", err instanceof Error ? err.message : String(err));
    }
    console.log();
  }

  await disconnectPrisma();
}

main().catch(async (err) => {
  console.error("[generate-management-analysis] fatal", err);
  await disconnectPrisma();
  process.exit(1);
});
