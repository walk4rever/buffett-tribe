/**
 * Unified company analysis generation - replaces 5 separate scripts
 *
 * Generates all analysis fields in a single LLM call:
 * - overview (100-120 chars company summary)
 * - business (business model canvas)
 * - moat (competitive advantages)
 * - management (capital allocation & quality)
 * - valuation (intrinsic value assessment)
 *
 * Usage:
 *   tsx scripts/generate-company-analysis-unified.ts --company AAPL [--dry-run] [--force]
 *   tsx scripts/generate-company-analysis-unified.ts --all [--dry-run] [--force]
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

const SYSTEM_PROMPT = `你是价值投资研究员，为上市公司生成完整的投资分析报告。

输出要求（JSON 格式）：
{
  "overview": "严格不超过3句话的中文概览（总字数 100-120 字）",
  "business": {
    "canvas": {
      "keyPartners": ["合作伙伴1", "合作伙伴2"],
      "keyActivities": ["核心活动1", "核心活动2"],
      "keyResources": ["关键资源1", "关键资源2"],
      "valueProposition": "价值主张",
      "customerRelationships": ["客户关系1", "客户关系2"],
      "channels": ["渠道1", "渠道2"],
      "customerSegments": ["客户群体1", "客户群体2"],
      "costStructure": ["成本结构1", "成本结构2"],
      "revenueStreams": ["收入来源1", "收入来源2"]
    },
    "overview": "业务概览文本（200-300字）"
  },
  "moat": {
    "competitive_advantages": [
      {
        "type": "network_effect | switching_cost | intangible_asset | cost_advantage | efficient_scale",
        "title": "护城河标题",
        "description": "护城河描述",
        "strength": "strong | moderate | weak"
      }
    ],
    "summary": "护城河总结（150-200字）",
    "sustainability": "long_term | medium_term | short_term"
  },
  "management": {
    "quality_score": "优秀|良好|一般|待观察",
    "capital_allocation": {
      "shareholder_returns": "股东回报评价",
      "reinvestment": "再投资策略评价",
      "debt_management": "债务管理评价",
      "overall": "整体资本配置评价"
    },
    "track_record": "管理层历史表现评价（150-200字）",
    "alignment": "管理层与股东利益一致性评价"
  },
  "valuation": {
    "intrinsic_value_range": {
      "low": 100,
      "high": 150,
      "currency": "USD"
    },
    "current_price_assessment": "低估|合理|高估",
    "key_assumptions": ["假设1", "假设2", "假设3"],
    "risks": ["风险1", "风险2", "风险3"],
    "summary": "估值总结（150-200字）"
  }
}

规则：
- 聚焦客观事实与商业模式，不提供买卖建议
- 如提供了财务数据，必须引用真实数据；如未提供，不得臆造
- overview 必须严格控制在3句话、100-120字以内
- 所有数值估算需基于财务数据与行业常识
- 输出必须是合法 JSON，不要任何 Markdown 标记`;

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

请根据以上事实，生成完整的公司投资分析报告。`;
}

function parseUnifiedResponse(raw: string): {
  overview: string;
  business: unknown;
  moat: unknown;
  management: unknown;
  valuation: unknown;
} {
  const parsed = parseJsonObject(raw);

  // Extract overview
  let overview = typeof parsed.overview === "string" ? parsed.overview : "";
  if (!overview && parsed.content && typeof parsed.content === "string") {
    overview = parsed.content;
  }
  overview = normalizeText(overview);
  if (!overview) {
    throw new Error("Invalid overview text in response");
  }

  // Validate other fields exist
  if (!parsed.business || typeof parsed.business !== "object") {
    throw new Error("Invalid business field in response");
  }
  if (!parsed.moat || typeof parsed.moat !== "object") {
    throw new Error("Invalid moat field in response");
  }
  if (!parsed.management || typeof parsed.management !== "object") {
    throw new Error("Invalid management field in response");
  }
  if (!parsed.valuation || typeof parsed.valuation !== "object") {
    throw new Error("Invalid valuation field in response");
  }

  return {
    overview,
    business: parsed.business,
    moat: parsed.moat,
    management: parsed.management,
    valuation: parsed.valuation,
  };
}

async function main() {
  const companyQuery = getArg("--company");
  const dryRun = hasFlag("--dry-run");
  const force = hasFlag("--force");
  const all = hasFlag("--all");

  if (!companyQuery && !all) {
    console.error("Usage: tsx scripts/generate-company-analysis-unified.ts --company <ticker|name|cik> [--dry-run] [--force]");
    console.error("       tsx scripts/generate-company-analysis-unified.ts --all [--dry-run] [--force]");
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
      select: {
        overview: true,
        business: true,
        moat: true,
        management: true,
        valuation: true,
        updatedAt: true
      },
    });

    const hasAllFields = Boolean(
      existing?.overview &&
      existing.business &&
      existing.moat &&
      existing.management &&
      existing.valuation
    );

    if (hasAllFields && !force) {
      console.log(`  SKIP: already has complete analysis (updatedAt: ${existing?.updatedAt.toISOString()}), use --force to overwrite`);
      continue;
    }

    const financials = await fetchFinancials(company.id, 5);
    let filingEvidence: Awaited<ReturnType<typeof fetchLatestFilingEvidence>> | null = null;
    try {
      filingEvidence = await fetchLatestFilingEvidence(company.id);
    } catch {
      // Optional background evidence, non-blocking
    }

    console.log(`  Financials: ${financials.length} years`);
    console.log(`  Filing evidence: ${filingEvidence ? filingEvidence.filingLabel : "none (will use financial data only)"}`);

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
      console.log(`  [DRY RUN] Would generate unified analysis`);
      console.log(`  Prompt length: ${prompt.length} chars`);
      continue;
    }

    try {
      console.log(`  Calling LLM (unified generation)...`);
      const raw = await callJsonLLM(SYSTEM_PROMPT, prompt, {
        model: AI_MODEL,
        maxTokens: 16000,
        temperature: 0.2,
      });

      const result = parseUnifiedResponse(raw);
      const source = AI_MODEL ?? "unknown";

      await prisma.companyAnalysis.upsert({
        where: { entityId: company.id },
        update: {
          overview: result.overview,
          business: toJsonValue(result.business),
          moat: toJsonValue(result.moat),
          management: toJsonValue(result.management),
          valuation: toJsonValue(result.valuation),
          source,
        },
        create: {
          entityId: company.id,
          overview: result.overview,
          business: toJsonValue(result.business),
          moat: toJsonValue(result.moat),
          management: toJsonValue(result.management),
          valuation: toJsonValue(result.valuation),
          source,
        },
      });

      console.log(`  ✓ Generated unified analysis (${result.overview.length} chars overview)`);
    } catch (err) {
      console.error(`  ✗ Failed to generate: ${err instanceof Error ? err.message : String(err)}`);
      if (all) {
        continue; // Continue with next company in --all mode
      } else {
        throw err; // Fail fast for single company
      }
    }
  }

  console.log("\nDone!");
  await disconnectPrisma();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
