import { computeCapitalAllocationStats } from "@/lib/capital-allocation-metrics";
import {
  computeAnnualEpsGrowthPct,
  computeHistoricalPbMetrics,
  computeHistoricalPeMetrics,
} from "@/lib/valuation-analysis-metrics";
import type { ValueLineAnnualData, ValueLineData } from "@/lib/value-line-data";
import { getImplementedValuationLabel } from "@/lib/financial-model";

export type AgentCompanyRef = {
  entityId: string;
  name: string;
  nameZh: string | null;
  ticker: string;
  market: string;
  reportingCurrency: string | null;
  tradingCurrency: string | null;
};

export type CapitalAllocationAgentPayload =
  | {
      available: false;
      view: "capital_allocation";
      company: AgentCompanyRef;
      reason: "insufficient_annuals";
      periodCount: number;
      message: string;
    }
  | {
      available: true;
      view: "capital_allocation";
      company: AgentCompanyRef;
      latestFiscalYear: number;
      periodCount: number;
      currency: string | null;
      stats: NonNullable<ReturnType<typeof computeCapitalAllocationStats>>;
    };

export type ValuationAgentPayload = {
  available: boolean;
  view: "valuation";
  company: AgentCompanyRef;
  asOf: {
    priceDate: string | null;
    fiscalYear: number | null;
  };
  latestPrice: number | null;
  currentPe: number | null;
  currentPb: number | null;
  benchmarkPe: number | null;
  benchmarkPb: number | null;
  valuationStatus: ValueLineData["valuationStatus"];
  valuationDiffPct: number | null;
  valuationAnchorLabel: string;
  valuationCurrencyAvailable: boolean;
  eps: number | null;
  bps: number | null;
  epsGrowthCagrPct: number | null;
  roeAvg5Y: number | null;
  fcfBasis: "fcf" | "ocf_proxy";
  priceToFcf: number | null;
  priceToOcf: number | null;
  historicalPe: ReturnType<typeof computeHistoricalPeMetrics>;
  historicalPb: ReturnType<typeof computeHistoricalPbMetrics>;
  latestAnnual: Pick<
    ValueLineAnnualData,
    | "year"
    | "revenue"
    | "netIncome"
    | "operatingCashFlow"
    | "capEx"
    | "freeCashFlow"
    | "eps"
    | "shares"
  > | null;
  missing: string[];
  message?: string;
};

function companyRef(data: ValueLineData): AgentCompanyRef {
  return {
    entityId: data.entityId,
    name: data.canonicalName,
    nameZh: data.nameZh,
    ticker: data.selectedTicker || data.ticker,
    market: data.market,
    reportingCurrency: data.reportingCurrency,
    tradingCurrency: data.tradingCurrency,
  };
}

function ratio(numerator: number | null, denominator: number | null): number | null {
  if (
    numerator == null ||
    denominator == null ||
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator <= 0
  ) {
    return null;
  }
  return Number((numerator / denominator).toFixed(2));
}

/** Build the compact, computed capital-allocation payload used by the agent.
 *  This intentionally reads ValueLineData instead of CompanyAnalysis.management:
 *  the latter is legacy LLM output and is no longer rendered on the company page. */
export function buildCapitalAllocationAgentPayload(
  data: ValueLineData,
): CapitalAllocationAgentPayload {
  const stats = computeCapitalAllocationStats(data.annuals);
  if (!stats) {
    return {
      available: false,
      view: "capital_allocation",
      company: companyRef(data),
      reason: "insufficient_annuals",
      periodCount: data.annuals.length,
      message: "Capital allocation needs at least two annual financial periods.",
    };
  }

  return {
    available: true,
    view: "capital_allocation",
    company: companyRef(data),
    latestFiscalYear: stats.latestYear,
    periodCount: stats.periodCount,
    currency: data.tradingCurrency ?? data.reportingCurrency,
    stats,
  };
}

/** Build the compact, computed valuation payload used by the agent.
 *  Scenario inputs are deliberately excluded: the page's scenario simulator is
 *  interactive and user-adjusted, so the agent must not invent a target price. */
export function buildValuationAgentPayload(data: ValueLineData): ValuationAgentPayload {
  const annuals = data.valuationAnnuals ?? [];
  const latestAnnual = annuals.at(-1) ?? null;
  const pricePoints = data.pricePoints ?? [];
  const latestPrice =
    data.latestPrice ??
    (pricePoints.length > 0 ? pricePoints[pricePoints.length - 1].close : null);
  const priceDate =
    data.latestPriceDate ??
    (pricePoints.length > 0 ? pricePoints[pricePoints.length - 1].date : null);
  const selectedSecurity =
    (data.availableSecurities ?? []).find((security) => security.ticker === data.selectedTicker) ??
    (data.availableSecurities ?? []).find((security) => security.isPrimary) ??
    null;
  const companyEps = latestAnnual?.eps ?? null;
  const currentPe =
    selectedSecurity?.peRatio ??
    data.peRatio ??
    (latestPrice != null && companyEps != null && companyEps > 0
      ? latestPrice / companyEps
      : null);
  const annualBps =
    latestAnnual?.shareholdersCommonEquity != null &&
    latestAnnual.shares != null &&
    latestAnnual.shares > 0
      ? latestAnnual.shareholdersCommonEquity / latestAnnual.shares
      : null;
  const currentPb =
    selectedSecurity?.pbRatio ??
    data.pbRatio ??
    (latestPrice != null && annualBps != null && annualBps > 0
      ? latestPrice / annualBps
      : null);
  // The page's active security may be an ADR or a different share class; derive
  // per-share values from its displayed multiples when possible.
  const eps =
    currentPe != null && latestPrice != null && currentPe > 0
      ? latestPrice / currentPe
      : companyEps;
  const bps =
    currentPb != null && latestPrice != null && currentPb > 0
      ? latestPrice / currentPb
      : annualBps;
  const shares =
    latestAnnual?.netIncomeCommon != null && eps != null && eps !== 0
      ? latestAnnual.netIncomeCommon / eps
      : latestAnnual?.shares ?? null;
  const ocfPerShare =
    shares != null && shares > 0 && latestAnnual?.operatingCashFlow != null
      ? latestAnnual.operatingCashFlow / shares
      : null;
  const fcfPerShare =
    shares != null && shares > 0 && latestAnnual?.freeCashFlow != null
      ? latestAnnual.freeCashFlow / shares
      : null;

  const missing: string[] = [];
  if (annuals.length === 0) missing.push("annual_financials");
  if (latestPrice == null) missing.push("stock_price");
  if (eps == null || eps <= 0) missing.push("positive_eps");
  if (bps == null || bps <= 0) missing.push("positive_bps");
  if (!data.valuationCurrencyAvailable) missing.push("valuation_currency");

  const available = annuals.length > 0 && latestPrice != null;
  return {
    available,
    view: "valuation",
    company: companyRef(data),
    asOf: {
      priceDate,
      fiscalYear: latestAnnual?.year ?? null,
    },
    latestPrice,
    currentPe: currentPe != null && Number.isFinite(currentPe)
      ? Number(currentPe.toFixed(2))
      : null,
    currentPb: currentPb != null && Number.isFinite(currentPb)
      ? Number(currentPb.toFixed(2))
      : null,
    benchmarkPe: data.benchmarkPe,
    benchmarkPb: data.benchmarkPb,
    valuationStatus: data.valuationStatus,
    valuationDiffPct: data.valuationDiffPct,
    valuationAnchorLabel: getImplementedValuationLabel(
      data.financialModel.valuationAnchor,
    ),
    valuationCurrencyAvailable: data.valuationCurrencyAvailable,
    eps,
    bps: bps != null && Number.isFinite(bps) ? Number(bps.toFixed(2)) : null,
    epsGrowthCagrPct: computeAnnualEpsGrowthPct(
      annuals.map((annual) => ({
        year: annual.year,
        eps: annual.eps,
        disclosedAt: annual.disclosedAt,
      })),
    ),
    roeAvg5Y: data.roeAvg5Y,
    fcfBasis: latestAnnual?.freeCashFlow != null ? "fcf" : "ocf_proxy",
    priceToFcf: ratio(latestPrice, fcfPerShare),
    priceToOcf: ratio(latestPrice, ocfPerShare),
    historicalPe: computeHistoricalPeMetrics(
      data.historicalPePoints ?? [],
      currentPe,
    ),
    historicalPb: computeHistoricalPbMetrics(
      data.historicalPbPoints ?? [],
      currentPb,
    ),
    latestAnnual: latestAnnual
      ? {
          year: latestAnnual.year,
          revenue: latestAnnual.revenue,
          netIncome: latestAnnual.netIncome,
          operatingCashFlow: latestAnnual.operatingCashFlow,
          capEx: latestAnnual.capEx,
          freeCashFlow: latestAnnual.freeCashFlow,
          eps: latestAnnual.eps,
          shares: latestAnnual.shares,
        }
      : null,
    missing,
    ...(available
      ? {}
      : {
          message: "Valuation needs both annual financials and a stock price.",
        }),
  };
}
