import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  fetchCompanyMetrics,
  type CompanyMetricsPayload,
} from "./company-metrics-client.js";
import {
  companyLabel,
  formatCompactAmount,
  formatNumber,
  formatPercent,
  formatPlainPercent,
} from "./company-metrics-format.js";

type HistoricalMetrics = {
  peMin?: number | null;
  peMedian?: number | null;
  peMax?: number | null;
  currentPercentile?: number | null;
  sampleCount?: number;
  pbMin?: number | null;
  pbMedian?: number | null;
  pbMax?: number | null;
};

type LatestAnnual = {
  year?: number;
  revenue?: number | null;
  netIncome?: number | null;
  operatingCashFlow?: number | null;
  capEx?: number | null;
  freeCashFlow?: number | null;
};

function formatValuation(payload: CompanyMetricsPayload): string {
  if (payload.available !== true) {
    const missing = Array.isArray(payload.missing)
      ? payload.missing.join(", ")
      : "annual financials or stock price";
    return [
      `Valuation data is unavailable for ${companyLabel(payload.company)}.`,
      typeof payload.message === "string" ? payload.message : "",
      `Missing: ${missing}.`,
    ].filter(Boolean).join("\n");
  }

  const currency =
    (payload.company?.tradingCurrency ?? payload.company?.reportingCurrency ?? null) as string | null;
  const asOf = (payload.asOf ?? {}) as { priceDate?: string | null; fiscalYear?: number | null };
  const historicalPe = (payload.historicalPe ?? {}) as HistoricalMetrics;
  const historicalPb = (payload.historicalPb ?? {}) as HistoricalMetrics;
  const latestAnnual = (payload.latestAnnual ?? null) as LatestAnnual | null;
  const missing = Array.isArray(payload.missing) ? payload.missing as string[] : [];

  const lines = [
    `**${companyLabel(payload.company)} — Valuation**`,
    "",
    `- Price as of: ${asOf.priceDate ?? "—"}`,
    `- Latest fiscal year: ${asOf.fiscalYear ?? "—"}`,
    `- Latest price: ${formatNumber(payload.latestPrice, 2)}${currency ? ` ${currency}` : ""}`,
    `- Current PE: ${formatNumber(payload.currentPe, 1)}`,
    `- Current PB: ${formatNumber(payload.currentPb, 2)}`,
    `- Benchmark PE: ${formatNumber(payload.benchmarkPe, 1)}`,
    `- Benchmark PB: ${formatNumber(payload.benchmarkPb, 2)}`,
    `- Valuation anchor: ${typeof payload.valuationAnchorLabel === "string" ? payload.valuationAnchorLabel : "—"}`,
    `- Valuation position: ${typeof payload.valuationStatus === "string" ? payload.valuationStatus : "—"}${typeof payload.valuationDiffPct === "number" ? ` (${formatPercent(payload.valuationDiffPct, 1)})` : ""}`,
    `- EPS: ${formatNumber(payload.eps, 2)}; BPS: ${formatNumber(payload.bps, 2)}`,
    `- EPS CAGR: ${formatPercent(payload.epsGrowthCagrPct, 1)}`,
    `- Average ROE (5Y): ${formatPlainPercent(payload.roeAvg5Y, 1)}`,
    `- Price/FCF: ${formatNumber(payload.priceToFcf, 1)}; Price/OCF: ${formatNumber(payload.priceToOcf, 1)} (${typeof payload.fcfBasis === "string" ? payload.fcfBasis : "n/a"})`,
    `- Currency available: ${payload.valuationCurrencyAvailable === true ? "yes" : "no"}`,
    `- Historical PE: min ${formatNumber(historicalPe.peMin, 1)}, median ${formatNumber(historicalPe.peMedian, 1)}, max ${formatNumber(historicalPe.peMax, 1)}, current percentile ${formatPlainPercent(historicalPe.currentPercentile, 0)} (${historicalPe.sampleCount ?? 0} samples)`,
    `- Historical PB: min ${formatNumber(historicalPb.pbMin, 2)}, median ${formatNumber(historicalPb.pbMedian, 2)}, max ${formatNumber(historicalPb.pbMax, 2)}, current percentile ${formatPlainPercent(historicalPb.currentPercentile, 0)} (${historicalPb.sampleCount ?? 0} samples)`,
  ];

  if (latestAnnual) {
    lines.push(
      "",
      `**Latest annual snapshot (FY${latestAnnual.year ?? "—"})**`,
      `- Revenue: ${formatCompactAmount(latestAnnual.revenue, currency)}`,
      `- Net income: ${formatCompactAmount(latestAnnual.netIncome, currency)}`,
      `- Operating cash flow: ${formatCompactAmount(latestAnnual.operatingCashFlow, currency)}`,
      `- CapEx: ${formatCompactAmount(latestAnnual.capEx, currency)}`,
      `- Free cash flow: ${formatCompactAmount(latestAnnual.freeCashFlow, currency)}`,
    );
  }

  if (missing.length > 0) {
    lines.push("", `Missing or unavailable inputs: ${missing.join(", ")}.`);
  }
  lines.push(
    "",
    "These are computed valuation metrics, not a recommendation or target price. Do not treat missing values as zero.",
  );
  return lines.join("\n");
}

export const getCompanyValuationTool = defineTool({
  name: "get_company_valuation",
  label: "Get Company Valuation Metrics",
  description:
    "Fetch computed valuation metrics for a company from normalized annual financials and the latest available stock price: current PE/PB, historical PE/PB range and percentile, benchmark multiples, valuation position, EPS/BPS, EPS growth, and price/FCF or price/OCF. This is deterministic data, not an LLM opinion or a buy/sell recommendation. It does not provide interactive scenarios or target prices.",
  promptSnippet:
    "get_company_valuation(company) → latest price, PE/PB, historical percentile, benchmark, and valuation position",
  parameters: Type.Object({
    company: Type.String({
      description: "Company ticker or name (e.g. AAPL, 9992.HK, 600519.SS, 苹果, 泡泡玛特)",
    }),
  }),
  async execute(_id, params, signal) {
    const company = params.company.trim();
    if (!company) {
      return {
        content: [{ type: "text" as const, text: "company is required." }],
        details: null,
      };
    }

    try {
      const payload = await fetchCompanyMetrics(company, "valuation", signal);
      return {
        content: [{ type: "text" as const, text: formatValuation(payload) }],
        details: {
          available: payload.available === true,
          view: "valuation",
          priceDate: (payload.asOf as { priceDate?: string | null } | undefined)?.priceDate ?? null,
        },
      };
    } catch (error) {
      return {
        content: [{
          type: "text" as const,
          text: `Valuation lookup failed: ${error instanceof Error ? error.message : String(error)}`,
        }],
        details: null,
      };
    }
  },
});
