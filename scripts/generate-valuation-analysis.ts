/**
 * Generate valuation analysis for companies.
 * Numbers are computed in code (valuation-metrics); the LLM only interprets
 * them and proposes scenario assumptions. Implied returns are computed in code.
 *
 * Usage:
 *   tsx scripts/generate-valuation-analysis.ts --company MCO [--dry-run] [--force]
 *   tsx scripts/generate-valuation-analysis.ts --all [--dry-run] [--force]
 */

import "dotenv/config";
import {
  AI_MODEL,
  assertDbCapacityForBatch,
  callJsonLLM,
  disconnectPrisma,
  fetchHolders,
  findCompanies,
  getArg,
  hasFlag,
  jsonObject,
  normalizeText,
  parseJsonObject,
  prisma,
  toJsonValue,
} from "./lib/company-generation";
import {
  computeScenarios,
  computeValuationMetrics,
  type ScenarioInput,
  type ValuationMetrics,
} from "@/lib/valuation-metrics";

const ARTIFACT_TYPE = "valuation_analysis";

const SYSTEM_PROMPT = `You are a professional value investment analyst. Generate a Chinese valuation analysis in JSON format.

CRITICAL: All metrics provided to you were computed from source data. You MUST NOT compute or invent any
numbers — only interpret the given ones. Scenario growth/exit-PE assumptions are yours to propose;
the implied returns will be computed by code afterwards.

Output shape:
{
  "position": {
    "verdict": "15字以内：当前估值位置一句话定性（如：历史区间偏低/中位/偏高）",
    "narrative": "120字左右：解读当前 PE 在自身历史区间的位置，结合分位数和中位数。不与同行比较（无数据）。"
  },
  "quality": {
    "narrative": "120字左右：用 ROE、利润率、营收/净利增速趋势回答'这个估值贵得值不值'。"
  },
  "scenarios": [
    { "name": "保守", "growthPct": 数字, "exitPe": 数字, "rationale": "50字以内：该假设的依据" },
    { "name": "基准", "growthPct": 数字, "exitPe": 数字, "rationale": "..." },
    { "name": "乐观", "growthPct": 数字, "exitPe": 数字, "rationale": "..." }
  ],
  "conclusion": {
    "narrative": "120字左右：综合估值位置与质量的整体判断，强调区间与假设而非结论性建议",
    "masterContrast": "80字左右：若持仓数据中有大师近期动作（加减仓/建仓/清仓），解读同一估值下的不同判断；没有则输出空字符串"
  }
}

Rules:
- Scenario growth assumptions must be anchored to the provided revenue/net income CAGR and quality trends; exit PE anchored to the historical PE range. State the anchor in rationale.
- 保守 scenario should be genuinely conservative (growth below historical CAGR, exit PE near historical low-to-median).
- No investment advice wording: never use 买入/卖出/目标价/建议. Express ranges and assumptions.
- Every narrative must end with a Chinese full stop.
- Output ONLY valid JSON.`;

type LlmValuation = {
  position: { verdict: string; narrative: string };
  quality: { narrative: string };
  scenarios: ScenarioInput[];
  conclusion: { narrative: string; masterContrast: string };
};

function parsePayload(raw: string): LlmValuation {
  const parsed = parseJsonObject(raw);
  const position = jsonObject(parsed.position);
  const quality = jsonObject(parsed.quality);
  const conclusion = jsonObject(parsed.conclusion);
  if (
    !position ||
    !normalizeText(position.narrative) ||
    !quality ||
    !Array.isArray(parsed.scenarios) ||
    parsed.scenarios.length < 2 ||
    !conclusion
  ) {
    throw new Error("Invalid valuation analysis structure");
  }
  const scenarios = (parsed.scenarios as Array<Record<string, unknown>>).map((s) => ({
    name: normalizeText(s.name) || "情景",
    growthPct: Number(s.growthPct),
    exitPe: Number(s.exitPe),
    rationale: normalizeText(s.rationale),
  }));
  if (scenarios.some((s) => !Number.isFinite(s.growthPct) || !Number.isFinite(s.exitPe))) {
    throw new Error("Scenario assumptions are not numeric");
  }
  return {
    position: { verdict: normalizeText(position.verdict), narrative: normalizeText(position.narrative) },
    quality: { narrative: normalizeText(quality.narrative) },
    scenarios,
    conclusion: {
      narrative: normalizeText(conclusion.narrative),
      masterContrast: normalizeText(conclusion.masterContrast),
    },
  };
}

function buildMetricsText(m: ValuationMetrics) {
  const inB = (v: number | null) => (v != null ? (v / 1e9).toFixed(2) + "B" : "-");
  const fundamentals = m.fundamentals
    .map(
      (f) =>
        `  FY${f.year}: Revenue ${inB(f.revenue)} | NetIncome ${inB(f.netIncome)} | EPS ${f.epsDiluted ?? "-"} | OCF ${inB(f.operatingCashFlow)} | CapEx ${inB(f.capex)} | FCF ${inB(f.freeCashFlow)} | ROE ${f.roePct ?? "-"}% | NetMargin ${f.netMarginPct ?? "-"}%`
    )
    .join("\n");

  const cashFlowLine =
    m.fcfBasis === "fcf"
      ? `- Price / FCF per share: ${m.priceToFcf} (FCF = OCF - CapEx)`
      : `- Price / OCF per share: ${m.priceToOcf} (OCF used as FCF proxy, no CapEx data)`;

  return `Computed valuation metrics (as of ${m.asOfDate}, price $${m.latestPrice}):
- Current PE (FY${m.latestFiscalYear} diluted EPS): ${m.pe.current}
- Historical PE range over ${m.pe.sampleDays} weekly samples: min ${m.pe.min} / median ${m.pe.median} / max ${m.pe.max}
- Current PE percentile within history: ${m.pe.percentile}% (lower = cheaper vs own history)
${cashFlowLine}
- Revenue CAGR (${m.fundamentals[0]?.year}-${m.latestFiscalYear}): ${m.revenueCagrPct}%
- Net income CAGR: ${m.netIncomeCagrPct}%

Annual fundamentals:
${fundamentals}`;
}

async function main() {
  const companyQuery = getArg("--company");
  const dryRun = hasFlag("--dry-run");
  const force = hasFlag("--force");
  const all = hasFlag("--all");

  if (!companyQuery && !all) {
    console.error("Usage: tsx scripts/generate-valuation-analysis.ts --company <ticker|name|cik> [--dry-run] [--force]");
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

    if (!company.ticker) {
      console.log("  SKIP: no ticker, cannot compute price-based metrics");
      continue;
    }

    const existing = await prisma.companyAnalysis.findUnique({
      where: { entityId: company.id },
      select: { valuation: true, version: true, updatedAt: true },
    });
    if (existing?.valuation != null && !force) {
      console.log(`  SKIP: already has ${ARTIFACT_TYPE} v${existing.version} (${existing.updatedAt.toISOString()}), use --force`);
      continue;
    }

    const metrics = await computeValuationMetrics({ entityId: company.id, ticker: company.ticker });
    if (!metrics || metrics.pe.current == null) {
      console.log("  SKIP: insufficient data (need FY financials with EPS + stock prices)");
      continue;
    }

    const holders = await fetchHolders(company.id, 10);
    const holderLines = holders.length
      ? holders.map((h) => `  - ${h.name}${h.tribeId ? ` (${h.tribeId})` : ""}: ${h.percent?.toFixed(2) ?? "-"}% 仓位`).join("\n")
      : "  none";

    const prompt = `Company: ${company.canonicalName} (${company.ticker})
Sector: ${company.sector ?? "N/A"}

${buildMetricsText(metrics)}

Master holders (latest):
${holderLines}

Generate the valuation analysis payload.`;

    if (dryRun) {
      console.log(`  DRY-RUN: prompt ${prompt.length} chars`);
      console.log(`  Preview:\n${prompt}\n`);
      continue;
    }

    try {
      const content = await callJsonLLM({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: prompt,
        temperature: 0.3,
        maxTokens: 3000,
      });
      const llm = parsePayload(content);

      const latestEps = metrics.fundamentals[metrics.fundamentals.length - 1]?.epsDiluted ?? null;
      const scenarioResults = computeScenarios({
        latestEps,
        latestPrice: metrics.latestPrice,
        horizonYears: metrics.scenarioHorizonYears,
        scenarios: llm.scenarios,
      });

      const payload = {
        metrics,
        position: llm.position,
        quality: llm.quality,
        scenarios: {
          horizonYears: metrics.scenarioHorizonYears,
          items: scenarioResults,
          note: "情景回报为代码按 EPS×(1+g)^N×退出PE 计算的隐含年化（不含分红），假设由 AI 提出，仅作框架参考。",
        },
        conclusion: llm.conclusion,
      };

      const source = AI_MODEL ?? "unknown";
      await prisma.companyAnalysis.upsert({
        where: { entityId: company.id },
        create: {
          entityId: company.id,
          valuation: toJsonValue(payload),
          source,
          version: 1,
        },
        update: {
          valuation: toJsonValue(payload),
          source,
          version: { increment: 1 },
        },
      });
      console.log(`  Saved ${ARTIFACT_TYPE} (scenarios: ${scenarioResults.map((s) => `${s.name} ${s.impliedAnnualReturnPct}%`).join(", ")})`);
    } catch (err) {
      console.error("  Failed:", err instanceof Error ? err.message : String(err));
    }
    console.log();
  }

  await disconnectPrisma();
}

main().catch(async (err) => {
  console.error("[generate-valuation-analysis] fatal", err);
  await disconnectPrisma();
  process.exit(1);
});
