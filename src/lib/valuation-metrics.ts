import prisma from "@/lib/prisma";

/**
 * Valuation metrics computed from Financial (FY line items) + StockPrice.
 * All numbers are computed in code — the LLM only interprets them.
 * FCF = OCF - CapEx when CapEx data exists; falls back to OCF proxy otherwise.
 */

export type AnnualFundamentals = {
  year: number;
  revenue: number | null;
  netIncome: number | null;
  epsDiluted: number | null;
  operatingCashFlow: number | null;
  capex: number | null;
  freeCashFlow: number | null;
  shareholdersEquity: number | null;
  roePct: number | null;
  netMarginPct: number | null;
};

export type PeStats = {
  current: number | null;
  min: number | null;
  max: number | null;
  median: number | null;
  percentile: number | null; // 0-100, position of current PE in daily history
  sampleDays: number;
};

export type ScenarioInput = {
  name: string;
  growthPct: number; // annual EPS growth assumption
  exitPe: number;
  rationale: string;
};

export type ScenarioResult = ScenarioInput & {
  impliedPrice: number | null;
  impliedAnnualReturnPct: number | null;
};

export type ValuationMetrics = {
  ticker: string;
  asOfDate: string;
  latestPrice: number | null;
  latestFiscalYear: number | null;
  fundamentals: AnnualFundamentals[];
  pe: PeStats;
  priceToOcf: number | null; // price / OCF per share (always computed)
  priceToFcf: number | null; // price / FCF per share, null when CapEx missing
  fcfBasis: "fcf" | "ocf_proxy"; // which basis downstream display/narrative should use
  revenueCagrPct: number | null;
  netIncomeCagrPct: number | null;
  scenarioHorizonYears: number;
};

function toNum(value: { toString(): string } | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value.toString());
  return Number.isFinite(n) ? n : null;
}

function round(value: number | null, digits = 2): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function cagrPct(first: number | null, last: number | null, years: number): number | null {
  if (first == null || last == null || first <= 0 || last <= 0 || years <= 0) return null;
  return round(((last / first) ** (1 / years) - 1) * 100);
}

/**
 * FCF = OCF - CapEx. CapEx is stored as a payment magnitude
 * (us-gaap PaymentsToAcquirePropertyPlantAndEquipment is positive),
 * abs() guards against sources that store it signed.
 */
export function computeFcf(ocf: number | null, capex: number | null): number | null {
  if (ocf == null || capex == null) return null;
  return ocf - Math.abs(capex);
}

export async function fetchAnnualFundamentals(entityId: string): Promise<AnnualFundamentals[]> {
  const rows = await prisma.financial.findMany({
    where: { entityId, periodType: "FY" },
    select: { periodEnd: true, lineItem: true, value: true },
    orderBy: { periodEnd: "asc" },
  });

  const byYear = new Map<number, Record<string, number | null>>();
  for (const row of rows) {
    const year = row.periodEnd.getUTCFullYear();
    if (!byYear.has(year)) byYear.set(year, {});
    const bucket = byYear.get(year)!;
    if (!(row.lineItem in bucket)) bucket[row.lineItem] = toNum(row.value);
  }

  return [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, items]) => {
      const netIncome = items.NetIncome ?? null;
      const equity = items.ShareholdersEquity ?? null;
      const revenue = items.Revenue ?? null;
      const ocf = items.OperatingCashFlow ?? null;
      const capex = items.CapEx ?? null;
      return {
        year,
        revenue,
        netIncome,
        epsDiluted: items.EPSDiluted ?? null,
        operatingCashFlow: ocf,
        capex,
        freeCashFlow: computeFcf(ocf, capex),
        shareholdersEquity: equity,
        roePct: netIncome != null && equity ? round((netIncome / equity) * 100) : null,
        netMarginPct: netIncome != null && revenue ? round((netIncome / revenue) * 100) : null,
      };
    });
}

function percentileOf(series: number[], value: number): number | null {
  if (!series.length) return null;
  const below = series.filter((v) => v <= value).length;
  return round((below / series.length) * 100, 1);
}

export async function computeValuationMetrics(params: {
  entityId: string;
  ticker: string;
}): Promise<ValuationMetrics | null> {
  const fundamentals = await fetchAnnualFundamentals(params.entityId);
  if (!fundamentals.length) return null;

  const prices = await prisma.stockPrice.findMany({
    where: { ticker: params.ticker },
    select: { date: true, close: true },
    orderBy: { date: "asc" },
  });
  if (!prices.length) return null;

  const latest = prices[prices.length - 1];
  const latestPrice = toNum(latest.close);

  // EPS lookup: for a given date, use the most recent fiscal year ended before it.
  const epsByYear = fundamentals
    .filter((f) => f.epsDiluted != null && f.epsDiluted > 0)
    .map((f) => ({ year: f.year, eps: f.epsDiluted as number }));

  function trailingEps(date: Date): number | null {
    const y = date.getUTCFullYear();
    for (let i = epsByYear.length - 1; i >= 0; i--) {
      if (epsByYear[i].year < y) return epsByYear[i].eps;
    }
    return null;
  }

  const dailyPe: number[] = [];
  for (const p of prices) {
    const eps = trailingEps(p.date);
    const close = toNum(p.close);
    if (eps != null && close != null) dailyPe.push(close / eps);
  }

  const latestEps = epsByYear.length ? epsByYear[epsByYear.length - 1].eps : null;
  const currentPe = latestPrice != null && latestEps != null ? latestPrice / latestEps : null;
  const sorted = [...dailyPe].sort((a, b) => a - b);

  const pe: PeStats = {
    current: round(currentPe),
    min: sorted.length ? round(sorted[0]) : null,
    max: sorted.length ? round(sorted[sorted.length - 1]) : null,
    median: sorted.length ? round(sorted[Math.floor(sorted.length / 2)]) : null,
    percentile: currentPe != null ? percentileOf(sorted, currentPe) : null,
    sampleDays: dailyPe.length,
  };

  const latestFY = fundamentals[fundamentals.length - 1];
  // Diluted share count proxy: NetIncome / EPSDiluted.
  const shares =
    latestFY.netIncome != null && latestFY.epsDiluted ? latestFY.netIncome / latestFY.epsDiluted : null;
  const ocfPerShare =
    shares != null && shares > 0 && latestFY.operatingCashFlow != null
      ? latestFY.operatingCashFlow / shares
      : null;
  const priceToOcf =
    latestPrice != null && ocfPerShare != null && ocfPerShare > 0 ? latestPrice / ocfPerShare : null;
  const fcfPerShare =
    shares != null && shares > 0 && latestFY.freeCashFlow != null ? latestFY.freeCashFlow / shares : null;
  const priceToFcf =
    latestPrice != null && fcfPerShare != null && fcfPerShare > 0 ? latestPrice / fcfPerShare : null;

  const span = fundamentals.length - 1;
  const first = fundamentals[0];

  return {
    ticker: params.ticker,
    asOfDate: latest.date.toISOString().slice(0, 10),
    latestPrice: round(latestPrice),
    latestFiscalYear: latestFY.year,
    fundamentals,
    pe,
    priceToOcf: round(priceToOcf),
    priceToFcf: round(priceToFcf),
    fcfBasis: priceToFcf != null ? "fcf" : "ocf_proxy",
    revenueCagrPct: cagrPct(first.revenue, latestFY.revenue, span),
    netIncomeCagrPct: cagrPct(first.netIncome, latestFY.netIncome, span),
    scenarioHorizonYears: 5,
  };
}

/**
 * Scenario math: implied price after N years = EPS * (1+g)^N * exitPE.
 * Annualized return vs current price. Dividends excluded (noted in UI).
 */
export function computeScenarios(params: {
  latestEps: number | null;
  latestPrice: number | null;
  horizonYears: number;
  scenarios: ScenarioInput[];
}): ScenarioResult[] {
  return params.scenarios.map((s) => {
    if (
      params.latestEps == null ||
      params.latestPrice == null ||
      params.latestPrice <= 0 ||
      !Number.isFinite(s.growthPct) ||
      !Number.isFinite(s.exitPe)
    ) {
      return { ...s, impliedPrice: null, impliedAnnualReturnPct: null };
    }
    const impliedPrice = params.latestEps * (1 + s.growthPct / 100) ** params.horizonYears * s.exitPe;
    const annualReturn = ((impliedPrice / params.latestPrice) ** (1 / params.horizonYears) - 1) * 100;
    return {
      ...s,
      impliedPrice: round(impliedPrice),
      impliedAnnualReturnPct: round(annualReturn, 1),
    };
  });
}
