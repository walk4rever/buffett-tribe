/**
 * Generate and upsert company basic information narrative.
 *
 * Usage:
 *   tsx scripts/generate-company-profile.ts --company AAPL [--dry-run] [--force]
 *   tsx scripts/generate-company-profile.ts --all [--dry-run] [--force]
 */

import "dotenv/config";
import {
  AI_MODEL,
  buildFilingEvidenceText,
  buildFinancialDashboardText,
  buildFinancialHistoryText,
  callJsonLLM,
  createGeneratedContentVersion,
  disconnectPrisma,
  fetchFinancials,
  fetchLatestFilingEvidence,
  findCompanies,
  getArg,
  hasFlag,
  jsonObject,
  normalizeText,
  parseJsonObject,
  prisma,
  toJsonValue,
} from "./lib/company-generation";

const PROMPT_VERSION = "company-profile-v1";

type NarrativeSection = {
  title: string;
  content: string;
};

const SYSTEM_PROMPT = `You generate factual Chinese company basic information for an investing product.

Output shape:
{
  "overview": {
    "title": "公司基本信息",
    "content": "200字左右的中文概述，包括公司定位、主营业务、市场地位。"
  }
}

Rules:
- This is a factual company profile, not investment advice.
- Focus on what the company is, where it operates, what it sells, and its broad market position.
- Use SEC filing evidence and supplied metadata where available.
- Do not discuss moat, valuation, stock attractiveness, or investment thesis.
- overview.content must end with a Chinese full stop.
- Output ONLY valid JSON. No markdown, no explanation.`;

function parseProfile(raw: string): NarrativeSection {
  const parsed = parseJsonObject(raw);
  const overview = jsonObject(parsed.overview);
  if (!overview) {
    throw new Error("Invalid overview");
  }
  const title = normalizeText(overview.title);
  const content = normalizeText(overview.content);
  if (!title || !content) {
    throw new Error("Invalid overview title/content");
  }
  return { title, content };
}

function mergeNarrative(existing: unknown, overview: NarrativeSection) {
  const object = jsonObject(existing);
  const business = jsonObject(object?.business);

  return {
    overview,
    business: {
      title: normalizeText(business?.title) || "主打产品、服务与营收结构",
      content: normalizeText(business?.content),
    },
  };
}

function buildPrompt(params: {
  name: string;
  ticker: string | null;
  cik: string | null;
  sector: string | null;
  metadata: Record<string, unknown> | null;
  financials: Awaited<ReturnType<typeof fetchFinancials>>;
  filingEvidence: Awaited<ReturnType<typeof fetchLatestFilingEvidence>>;
}) {
  const dashboard = buildFinancialDashboardText({
    sector: params.sector,
    metadata: params.metadata,
    financials: params.financials,
  });
  const meta = params.metadata ?? {};

  return `Company: ${params.name}${params.ticker ? ` (${params.ticker})` : ""}
CIK: ${params.cik ?? "N/A"}
Sector: ${params.sector ?? "N/A"}
Industry: ${typeof meta.industry === "string" ? meta.industry : "N/A"}
Exchange: ${typeof meta.exchange === "string" ? meta.exchange : "N/A"}

Latest FY: ${dashboard.latestYear ?? "N/A"}
Key Metrics:
${dashboard.cardLines}

Financial history:
${buildFinancialHistoryText(params.financials)}

${buildFilingEvidenceText(params.filingEvidence)}

Generate only the company basic information overview.`;
}

async function main() {
  const companyQuery = getArg("--company");
  const dryRun = hasFlag("--dry-run");
  const force = hasFlag("--force");
  const all = hasFlag("--all");

  if (!companyQuery && !all) {
    console.error("Usage: tsx scripts/generate-company-profile.ts --company <ticker|name|cik> [--dry-run] [--force]");
    console.error("       tsx scripts/generate-company-profile.ts --all [--dry-run] [--force]");
    process.exit(1);
  }

  const companies = await findCompanies(companyQuery);
  if (companies.length === 0) {
    console.error(`No company found for: ${companyQuery}`);
    process.exit(1);
  }

  console.log(`Found ${companies.length} company(s) to process\n`);

  for (const company of companies) {
    const label = `${company.canonicalName}${company.ticker ? ` (${company.ticker})` : ""}${company.cik ? ` [CIK: ${company.cik}]` : ""}`;
    console.log(`--- ${label} ---`);

    const existing = await prisma.companyAnalysis.findUnique({
      where: { entityId: company.id },
      select: { narrative: true, moat: true, updatedAt: true },
    });
    const existingOverview = jsonObject(jsonObject(existing?.narrative)?.overview);
    if (existingOverview && normalizeText(existingOverview.content) && !force) {
      console.log(`  SKIP: already has company profile (updatedAt: ${existing?.updatedAt.toISOString()}), use --force to overwrite`);
      continue;
    }

    const financials = await fetchFinancials(company.id, 5);
    const filingEvidence = await fetchLatestFilingEvidence(company.id);
    console.log(`  Financials: ${financials.length} years`);
    console.log(`  Filing evidence: ${filingEvidence ? filingEvidence.filingLabel : "none"}`);

    const prompt = buildPrompt({
      name: company.canonicalName,
      ticker: company.ticker,
      cik: company.cik,
      sector: company.sector,
      metadata: (company.metadata as Record<string, unknown> | null) ?? null,
      financials,
      filingEvidence,
    });

    if (dryRun) {
      console.log(`  DRY-RUN: would call AI with prompt (${prompt.length} chars)`);
      console.log(`  Prompt preview:\n${prompt.slice(0, 800)}...\n`);
      continue;
    }

    try {
      const content = await callJsonLLM({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: prompt,
        temperature: 0.2,
        maxTokens: 1500,
      });
      const overview = parseProfile(content);
      const narrative = mergeNarrative(existing?.narrative, overview);
      const source = AI_MODEL ?? "unknown";

      await prisma.$transaction(async (tx) => {
        await tx.companyAnalysis.upsert({
          where: { entityId: company.id },
          create: {
            entityId: company.id,
            narrative: toJsonValue(narrative),
            moat: toJsonValue(existing?.moat ?? {}),
            source,
            version: 1,
          },
          update: {
            narrative: toJsonValue(narrative),
            source,
            version: { increment: 1 },
          },
        });

        await createGeneratedContentVersion({
          tx,
          scopeType: "entity",
          scopeId: company.id,
          artifactType: "company_profile",
          payload: toJsonValue({ overview }),
          source,
          promptVersion: PROMPT_VERSION,
        });
      });

      console.log("  Saved company profile");
    } catch (err) {
      console.error("  Failed:", err instanceof Error ? err.message : String(err));
    }

    console.log();
  }

  await disconnectPrisma();
}

main().catch(async (err) => {
  console.error("[generate-company-profile] fatal", err);
  await disconnectPrisma();
  process.exit(1);
});
