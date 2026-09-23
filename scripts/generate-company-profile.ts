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
  disconnectPrisma,
  fetchFinancials,
  fetchLatestFilingEvidence,
  findCompanies,
  getArg,
  hasFlag,
  normalizeText,
  parseJsonObject,
  prisma,
  toJsonValue,
} from "./lib/company-generation";

const SYSTEM_PROMPT = `你是价值投资研究员，为上市公司撰写统一精炼的公司概览。

输出要求（JSON 格式）：
{
  "overview": "严格不超过3句话的中文概览（总字数 100-120 字）。"
}

三句话规范：
1. 第一句【行业定位与业务本质】：公司是什么、行业定位与核心业务本质（40-50字）。
2. 第二句【主打产品与服务体系】：主打核心产品系列或核心服务（30-40字）。
3. 第三句【主营收入与商业模式】：FY{年份} 营收规模与商业模式关键词（如生态锁定、规模效应、高转换成本、轻资产、订阅付费等）（40-50字）。如无具体财年数据，侧重说明核心商业模式与变现路径。

规则：
- 聚焦客观事实与商业模式，不提供买卖建议或主观投资评级。
- 如提供了财务数据，必须引用真实最新财年年份与营收；如未提供财务数据，不得臆造具体数值，侧重提炼业务模式。
- 必须严格控制在3句话以内，总字数在 100-130 字之间，严禁冗长展开。
- overview 必须以中文句号结尾。
- 输出必须是合法 JSON，不要任何 Markdown 标记或额外解释。`;

function parseOverview(raw: string): string {
  const parsed = parseJsonObject(raw);
  let text = typeof parsed.overview === "string" ? parsed.overview : "";
  if (!text && parsed.content && typeof parsed.content === "string") {
    text = parsed.content;
  }
  text = normalizeText(text);
  if (!text) {
    throw new Error("Invalid overview text in response");
  }
  return text;
}

function buildPrompt(params: {
  name: string;
  ticker: string | null;
  cik: string | null;
  sector: string | null;
  metadata: Record<string, unknown> | null;
  financials: Awaited<ReturnType<typeof fetchFinancials>>;
  filingEvidence: Awaited<ReturnType<typeof fetchLatestFilingEvidence>> | null;
}) {
  const dashboard = buildFinancialDashboardText({
    sector: params.sector,
    metadata: params.metadata,
    financials: params.financials,
  });
  const meta = params.metadata ?? {};
  const zhName = typeof meta.nameZh === "string" ? meta.nameZh : "";

  const evidenceBlock = params.filingEvidence && params.filingEvidence.sections.length > 0
    ? `\nFiling Excerpts (optional background):\n${buildFilingEvidenceText(params.filingEvidence)}`
    : "";

  return `Company: ${params.name}${zhName ? ` (${zhName})` : ""}${params.ticker ? ` [${params.ticker}]` : ""}
Sector: ${params.sector ?? "N/A"}
Industry: ${typeof meta.industry === "string" ? meta.industry : "N/A"}
Exchange: ${typeof meta.exchange === "string" ? meta.exchange : "N/A"}

Latest Financial Year: ${dashboard.latestYear ?? "最新"}
Key Metrics:
${dashboard.cardLines}

Financial history:
${buildFinancialHistoryText(params.financials)}
${evidenceBlock}

请根据以上事实，严格按照三句话规范（行业定位/业务本质 + 主打产品 + 最新财年营收与商业模式关键词）生成 100-120 字的公司概览。`;
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
      select: { overview: true, profile: true, updatedAt: true },
    });
    const hasOverview = Boolean(existing?.overview && existing.overview.trim());
    if (hasOverview && !force) {
      console.log(`  SKIP: already has overview (updatedAt: ${existing?.updatedAt.toISOString()}), use --force to overwrite`);
      continue;
    }

    const financials = await fetchFinancials(company.id, 5);
    let filingEvidence: Awaited<ReturnType<typeof fetchLatestFilingEvidence>> | null = null;
    try {
      filingEvidence = await fetchLatestFilingEvidence(company.id);
    } catch {
      // Optional background evidence, non-blocking for Phase 1
    }
    console.log(`  Financials: ${financials.length} years`);
    console.log(`  Filing evidence: ${filingEvidence ? filingEvidence.filingLabel : "none (Phase 1 fast mode)"}`);

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

    let rawContent = "";
    try {
      rawContent = await callJsonLLM({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: prompt,
        temperature: 0.2,
      });
      const overviewText = parseOverview(rawContent);
      const source = AI_MODEL ?? "unknown";

      await prisma.companyAnalysis.upsert({
        where: { entityId: company.id },
        create: {
          entityId: company.id,
          overview: overviewText,
          profile: toJsonValue({ title: "公司概览", content: overviewText }),
          source,
          version: 1,
        },
        update: {
          overview: overviewText,
          profile: toJsonValue({ title: "公司概览", content: overviewText }),
          source,
          version: { increment: 1 },
        },
      });

      console.log(`  ✓ Saved overview (${overviewText.length} chars): ${overviewText.slice(0, 60)}...`);
    } catch (err) {
      console.error("  Failed:", err instanceof Error ? err.message : String(err));
      if (rawContent) {
        console.error("  Raw content received:", rawContent.slice(0, 300));
      }
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
