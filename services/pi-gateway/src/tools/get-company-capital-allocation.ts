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

type Annual = {
  year?: number;
  operatingCashFlow?: number | null;
  capEx?: number | null;
  repurchaseAmt?: number | null;
  dividendsPaid?: number | null;
  acquisitionsAmt?: number | null;
  shares?: number | null;
  roe?: number | null;
};

type CapitalStats = {
  annuals?: Annual[];
  earliestYear?: number;
  latestYear?: number;
  periodCount?: number;
  flowCoverage?: number;
  cumOcf?: number | null;
  cumCapEx?: number | null;
  cumFcf?: number | null;
  cumBuybacks?: number | null;
  cumDividends?: number | null;
  cumAcquisitions?: number | null;
  buybackCoverage?: number;
  dividendCoverage?: number;
  fcfAfterDistributions?: number | null;
  retainedEarnings?: number | null;
  retainedEarningsPct?: number | null;
  shareholderReturnPct?: number | null;
  capexPct?: number | null;
  buybackPct?: number | null;
  dividendPct?: number | null;
  sharesStart?: number | null;
  sharesEnd?: number | null;
  shareDeltaPct?: number | null;
  avgRoe?: number | null;
};

function annualFcf(annual: Annual): number | null {
  if (annual.operatingCashFlow == null || annual.capEx == null) return null;
  return annual.operatingCashFlow - Math.abs(annual.capEx);
}

function formatCapitalAllocation(payload: CompanyMetricsPayload): string {
  if (payload.available !== true) {
    return [
      `Capital allocation data is unavailable for ${companyLabel(payload.company)}.`,
      typeof payload.message === "string" ? payload.message : "",
      typeof payload.periodCount === "number"
        ? `Annual periods available: ${payload.periodCount} (at least 2 required).`
        : "",
    ].filter(Boolean).join("\n");
  }

  const stats = (payload.stats ?? {}) as CapitalStats;
  const currency =
    (payload.company?.tradingCurrency ?? payload.company?.reportingCurrency ?? null) as string | null;
  const annuals = Array.isArray(stats.annuals) ? stats.annuals : [];
  const periodCount = stats.periodCount ?? annuals.length;
  const latestYear = stats.latestYear;
  const earliestYear = stats.earliestYear;

  const lines = [
    `**${companyLabel(payload.company)} — Capital Allocation${latestYear ? ` (FY${earliestYear}–FY${latestYear})` : ""}**`,
    "",
    `- Currency: ${currency ?? "N/A"}`,
    `- Periods: ${periodCount} ${periodCount === 1 ? "fiscal year" : "fiscal years"}`,
    `- Coverage: OCF/CapEx ${stats.flowCoverage ?? 0}/${periodCount}; buybacks ${stats.buybackCoverage ?? 0}/${periodCount}; dividends ${stats.dividendCoverage ?? 0}/${periodCount}`,
    `- Cumulative OCF: ${formatCompactAmount(stats.cumOcf, currency)}`,
    `- Cumulative CapEx: ${formatCompactAmount(stats.cumCapEx, currency)}`,
    `- Cumulative FCF: ${formatCompactAmount(stats.cumFcf, currency)}`,
    `- Buybacks: ${formatCompactAmount(stats.cumBuybacks, currency)}`,
    `- Dividends: ${formatCompactAmount(stats.cumDividends, currency)}`,
    `- Acquisitions: ${formatCompactAmount(stats.cumAcquisitions, currency)}`,
    `- FCF after distributions: ${formatCompactAmount(stats.fcfAfterDistributions, currency)}`,
    `- Retained earnings: ${formatCompactAmount(stats.retainedEarnings, currency)} (${formatPlainPercent(stats.retainedEarningsPct, 1)} of net income)`,
    `- Shareholder returns: ${formatPlainPercent(stats.shareholderReturnPct, 1)} of net income`,
    `- CapEx / OCF: ${formatPlainPercent(stats.capexPct, 1)}; buybacks / FCF: ${formatPlainPercent(stats.buybackPct, 1)}; dividends / FCF: ${formatPlainPercent(stats.dividendPct, 1)}`,
    `- Shares: ${formatNumber(stats.sharesStart, 0)} → ${formatNumber(stats.sharesEnd, 0)} (${formatPercent(stats.shareDeltaPct, 1)})`,
    `- Average ROE: ${formatPlainPercent(stats.avgRoe, 1)}`,
    "",
    "| FY | OCF | CapEx | FCF | Buybacks | Dividends | Shares |",
    "|---:|---:|---:|---:|---:|---:|---:|",
  ];

  for (const annual of annuals) {
    lines.push(
      `| ${annual.year ?? "—"} | ${formatCompactAmount(annual.operatingCashFlow, currency)} | ${formatCompactAmount(annual.capEx, currency)} | ${formatCompactAmount(annualFcf(annual), currency)} | ${formatCompactAmount(annual.repurchaseAmt, currency)} | ${formatCompactAmount(annual.dividendsPaid, currency)} | ${formatNumber(annual.shares, 0)} |`,
    );
  }

  lines.push(
    "",
    "All values are computed from normalized annual financial data. Missing values are shown as —; do not infer them.",
  );
  return lines.join("\n");
}

export const getCompanyCapitalAllocationTool = defineTool({
  name: "get_company_capital_allocation",
  label: "Get Company Capital Allocation",
  description:
    "Fetch computed capital-allocation facts for a company from normalized annual financials: operating cash flow, CapEx, free cash flow, buybacks, dividends, acquisitions, share-count change, ROE, and data coverage. This is deterministic data, not an LLM opinion. Use it for questions about capital allocation discipline, shareholder returns, reinvestment, or dilution. It needs at least two annual periods.",
  promptSnippet:
    "get_company_capital_allocation(company) → computed OCF/CapEx/FCF, buybacks, dividends, share change, ROE, and coverage",
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
      const payload = await fetchCompanyMetrics(company, "capital_allocation", signal);
      return {
        content: [{ type: "text" as const, text: formatCapitalAllocation(payload) }],
        details: {
          available: payload.available === true,
          view: "capital_allocation",
          periodCount: payload.periodCount ?? null,
        },
      };
    } catch (error) {
      return {
        content: [{
          type: "text" as const,
          text: `Capital allocation lookup failed: ${error instanceof Error ? error.message : String(error)}`,
        }],
        details: null,
      };
    }
  },
});
