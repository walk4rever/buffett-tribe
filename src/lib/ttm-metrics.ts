/**
 * src/lib/ttm-metrics.ts
 *
 * TTM (Trailing Twelve Months) metrics computation and quarterly financials queries.
 *
 * Algorithm:
 * - Flow items (Revenue, NetIncome, OperatingIncome, GrossProfit, OperatingCashFlow, CapEx, EPSDiluted):
 *   1) If the latest reported period is a quarter (Q1, Q2, Q3) or interim (H1), roll the latest 4 quarters
 *      (or 2 half-years) to form a true 12-month rolling sum.
 *   2) If the latest period is FY, TTM is the latest FY.
 * - Balance sheet items (TotalAssets, TotalLiabilities, ShareholdersEquity):
 *   Point-in-time snapshot from the latest reported period.
 * - Valuation multiples:
 *   PE-TTM = latest price / EPS-TTM (or marketCap / NetIncome-TTM)
 *   PS-TTM = marketCap / Revenue-TTM
 *   PB-TTM = marketCap / ShareholdersEquity
 *   FCF-TTM = OperatingCashFlow-TTM - abs(CapEx-TTM)
 */

import prisma from "@/lib/prisma";
import { getEntityFamilyIds } from "@/lib/company-data";

export type TtmPeriodBreakdown = {
  periodEnd: string;
  periodType: string;
  label: string;
};

export type TtmMetrics = {
  entityId: string;
  asOfDate: string;
  asOfPeriod: string;
  isTtm: boolean;
  currency: string | null;

  // Flow items (TTM rolling 12 months)
  revenue: number | null;
  grossProfit: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  operatingCashFlow: number | null;
  capex: number | null;
  freeCashFlow: number | null;
  epsDiluted: number | null;

  // Balance sheet items (as of latest period end)
  totalAssets: number | null;
  totalLiabilities: number | null;
  shareholdersEquity: number | null;

  // Valuation multiples (with stock price)
  latestPrice: number | null;
  peTtm: number | null;
  psTtm: number | null;
  pbTtm: number | null;
  priceToFcfTtm: number | null;
  fcfYieldTtmPct: number | null;

  // Margin & Return ratios
  grossMarginPct: number | null;
  operatingMarginPct: number | null;
  netMarginPct: number | null;
  roePct: number | null;

  // Included periods for transparency
  periodsIncluded: TtmPeriodBreakdown[];
};

export type FinancialQuarterItems = {
  periodEnd: Date;
  periodLabel: string;
  periodType: string;
  items: Record<string, string>;
};

function round(value: number | null, digits = 2): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function formatPeriodLabel(date: Date, periodType: string): string {
  const year = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;

  if (periodType === "FY") return `FY ${year}`;
  if (periodType === "H1") return `${year} H1`;
  if (periodType === "H2") return `${year} H2`;
  if (periodType === "Q1") return `${year} Q1`;
  if (periodType === "Q2") return `${year} Q2`;
  if (periodType === "Q3") return `${year} Q3`;
  if (periodType === "Q4") return `${year} Q4`;

  // Fallback by month
  if (m <= 3) return `${year} Q1`;
  if (m <= 6) return `${year} Q2`;
  if (m <= 9) return `${year} Q3`;
  return `${year} Q4`;
}

/**
 * Fetch quarterly financial records grouped by (periodEnd, periodType)
 * for trend tables and quarterly views.
 */
export async function getCompanyQuarterlyFinancials(
  entityId: string,
  limit = 8,
): Promise<FinancialQuarterItems[]> {
  const familyIds = await getEntityFamilyIds(entityId);
  const rows = await prisma.financial.findMany({
    where: {
      entityId: { in: familyIds },
      periodType: { in: ["Q1", "Q2", "Q3", "Q4", "H1", "H2", "FY"] },
    },
    orderBy: [{ periodEnd: "desc" }, { periodType: "asc" }],
    select: {
      periodEnd: true,
      periodType: true,
      lineItem: true,
      value: true,
    },
    take: 600,
  });

  // Group by (periodEnd, periodType). If both FY and Q4 exist on 12-31, prefer Q4 in quarterly view
  const periodMap = new Map<string, { periodEnd: Date; periodType: string; items: Record<string, string> }>();

  for (const row of rows) {
    if (row.value == null) continue;
    const dateStr = row.periodEnd.toISOString().slice(0, 10);
    const key = `${dateStr}_${row.periodType}`;
    if (!periodMap.has(key)) {
      periodMap.set(key, { periodEnd: row.periodEnd, periodType: row.periodType, items: {} });
    }
    const bucket = periodMap.get(key)!;
    if (!(row.lineItem in bucket.items)) {
      bucket.items[row.lineItem] = row.value.toString();
    }
  }

  // Filter and sort
  const allPeriods = [...periodMap.values()].sort((a, b) => {
    const diff = b.periodEnd.getTime() - a.periodEnd.getTime();
    if (diff !== 0) return diff;
    // Prefer non-FY over FY for quarterly table
    if (a.periodType === "FY" && b.periodType !== "FY") return 1;
    if (b.periodType === "FY" && a.periodType !== "FY") return -1;
    return 0;
  });

  // Deduplicate same periodEnd if both Q4 and FY exist
  const discretePeriods: typeof allPeriods = [];
  for (const p of allPeriods) {
    const dateStr = p.periodEnd.toISOString().slice(0, 10);
    // In quarterly view, if we have Q4/H2 and FY on the same date, pick the quarterly one
    const existing = discretePeriods.find((dp) => dp.periodEnd.toISOString().slice(0, 10) === dateStr);
    if (!existing) {
      discretePeriods.push(p);
    } else if (existing.periodType === "FY" && (p.periodType === "Q4" || p.periodType === "H2")) {
      const idx = discretePeriods.indexOf(existing);
      discretePeriods[idx] = p;
    }
  }

  return discretePeriods.slice(0, limit).map((p) => ({
    periodEnd: p.periodEnd,
    periodType: p.periodType,
    periodLabel: formatPeriodLabel(p.periodEnd, p.periodType),
    items: p.items,
  }));
}

/**
 * Computes TTM fundamental metrics and valuation multiples for an entity.
 */
export async function computeCompanyTtmMetrics(params: {
  entityId: string;
  ticker?: string | null;
  currency?: string | null;
}): Promise<TtmMetrics | null> {
  const familyIds = await getEntityFamilyIds(params.entityId);

  const [financialRows, stockPriceRow] = await Promise.all([
    prisma.financial.findMany({
      where: { entityId: { in: familyIds } },
      select: {
        periodEnd: true,
        periodType: true,
        lineItem: true,
        value: true,
        unit: true,
      },
      orderBy: [{ periodEnd: "desc" }],
    }),
    params.ticker
      ? prisma.stockPrice.findFirst({
          where: { ticker: params.ticker },
          orderBy: { date: "desc" },
          select: { close: true, date: true },
        })
      : null,
  ]);

  if (!financialRows.length) return null;

  const currency = params.currency ?? financialRows.find((r) => r.unit != null)?.unit ?? null;
  const latestPrice = stockPriceRow?.close ? Number(stockPriceRow.close.toString()) : null;

  // Group all financial rows into period buckets: Map<`${YYYY-MM-DD}_${periodType}`, Record<string, number>>
  const buckets = new Map<
    string,
    {
      periodEnd: Date;
      periodType: string;
      items: Record<string, number>;
    }
  >();

  for (const r of financialRows) {
    if (r.value == null) continue;
    const dateStr = r.periodEnd.toISOString().slice(0, 10);
    const key = `${dateStr}_${r.periodType}`;
    if (!buckets.has(key)) {
      buckets.set(key, { periodEnd: r.periodEnd, periodType: r.periodType, items: {} });
    }
    buckets.get(key)!.items[r.lineItem] = Number(r.value.toString());
  }

  const sortedBuckets = [...buckets.values()].sort((a, b) => {
    const diff = b.periodEnd.getTime() - a.periodEnd.getTime();
    if (diff !== 0) return diff;
    // Non-FY precedes FY on same date
    if (a.periodType === "FY") return 1;
    if (b.periodType === "FY") return -1;
    return 0;
  });

  if (!sortedBuckets.length) return null;

  const latestBucket = sortedBuckets[0];
  const asOfDate = latestBucket.periodEnd.toISOString().slice(0, 10);
  const asOfPeriod = formatPeriodLabel(latestBucket.periodEnd, latestBucket.periodType);

  // Latest balance sheet snapshot (TotalAssets, TotalLiabilities, ShareholdersEquity)
  const totalAssets = latestBucket.items.TotalAssets ?? null;
  const totalLiabilities = latestBucket.items.TotalLiabilities ?? null;
  const shareholdersEquity = latestBucket.items.ShareholdersEquity ?? null;

  // Determine which periods to sum for TTM flow items:
  // 1) If there is a quarterly/interim report MORE RECENT than the latest FY:
  //    Roll the latest 4 discrete quarters (or 2 half-years) to form a true 12-month rolling sum.
  // 2) If the latest reported period is the full fiscal year (FY), or no recent quarter exists:
  //    Use the latest FY directly.
  const latestFyBucket = sortedBuckets.find((b) => b.periodType === "FY");
  const latestQuarterBucket = sortedBuckets.find((b) =>
    ["Q1", "Q2", "Q3", "H1"].includes(b.periodType),
  );

  const hasMoreRecentQuarter =
    latestQuarterBucket != null &&
    (latestFyBucket == null ||
      latestQuarterBucket.periodEnd.getTime() > latestFyBucket.periodEnd.getTime());

  let periodsToSum: Array<{ periodEnd: Date; periodType: string; items: Record<string, number> }> = [];
  let isTtm = false;

  if (hasMoreRecentQuarter) {
    const isQuarterlyReporter = sortedBuckets.some((b) =>
      ["Q1", "Q2", "Q3", "Q4"].includes(b.periodType),
    );
    const isSemiAnnualReporter =
      !isQuarterlyReporter && sortedBuckets.some((b) => ["H1", "H2"].includes(b.periodType));

    if (isQuarterlyReporter) {
      const quarters = sortedBuckets.filter((b) =>
        ["Q1", "Q2", "Q3", "Q4"].includes(b.periodType),
      );
      if (quarters.length >= 4) {
        periodsToSum = quarters.slice(0, 4);
        isTtm = true;
      } else if (quarters.length > 0) {
        periodsToSum = quarters;
        isTtm = true;
      }
    } else if (isSemiAnnualReporter) {
      const halfYears = sortedBuckets.filter((b) => ["H1", "H2"].includes(b.periodType));
      if (halfYears.length >= 2) {
        periodsToSum = halfYears.slice(0, 2);
        isTtm = true;
      }
    }
  }

  // Fallback to latest FY if not rolling quarters
  if (!periodsToSum.length && latestFyBucket) {
    periodsToSum = [latestFyBucket];
    isTtm = false;
  }

  const sumLineItem = (key: string): number | null => {
    let sum = 0;
    let count = 0;
    for (const p of periodsToSum) {
      if (key in p.items && Number.isFinite(p.items[key])) {
        sum += p.items[key];
        count++;
      }
    }
    return count > 0 ? sum : null;
  };

  const revenue = sumLineItem("Revenue");
  const grossProfit = sumLineItem("GrossProfit");
  const operatingIncome = sumLineItem("OperatingIncome");
  const netIncome = sumLineItem("NetIncome");
  const ocf = sumLineItem("OperatingCashFlow");
  const capex = sumLineItem("CapEx");
  const epsDiluted = sumLineItem("EPSDiluted");

  const freeCashFlow = ocf != null && capex != null ? ocf - Math.abs(capex) : ocf;

  // Margin ratios
  const grossMarginPct = grossProfit != null && revenue ? round((grossProfit / revenue) * 100) : null;
  const operatingMarginPct =
    operatingIncome != null && revenue ? round((operatingIncome / revenue) * 100) : null;
  const netMarginPct = netIncome != null && revenue ? round((netIncome / revenue) * 100) : null;
  const roePct = netIncome != null && shareholdersEquity ? round((netIncome / shareholdersEquity) * 100) : null;

  // Multiple calculations
  // PE: latestPrice / EPS-TTM
  const peTtm =
    latestPrice != null && epsDiluted != null && epsDiluted > 0 ? round(latestPrice / epsDiluted) : null;

  // Share count proxy for PS & PB: NetIncome / EPSDiluted
  let sharesCount: number | null = null;
  if (netIncome != null && epsDiluted != null && epsDiluted > 0) {
    sharesCount = netIncome / epsDiluted;
  }

  const marketCap =
    latestPrice != null && sharesCount != null && sharesCount > 0 ? latestPrice * sharesCount : null;

  const psTtm = marketCap != null && revenue != null && revenue > 0 ? round(marketCap / revenue) : null;
  const pbTtm =
    marketCap != null && shareholdersEquity != null && shareholdersEquity > 0
      ? round(marketCap / shareholdersEquity)
      : null;

  const priceToFcfTtm =
    marketCap != null && freeCashFlow != null && freeCashFlow > 0 ? round(marketCap / freeCashFlow) : null;

  const fcfYieldTtmPct =
    marketCap != null && freeCashFlow != null && marketCap > 0
      ? round((freeCashFlow / marketCap) * 100, 2)
      : null;

  const periodsIncluded: TtmPeriodBreakdown[] = periodsToSum.map((p) => ({
    periodEnd: p.periodEnd.toISOString().slice(0, 10),
    periodType: p.periodType,
    label: formatPeriodLabel(p.periodEnd, p.periodType),
  }));

  return {
    entityId: params.entityId,
    asOfDate,
    asOfPeriod,
    isTtm,
    currency,
    revenue: round(revenue),
    grossProfit: round(grossProfit),
    operatingIncome: round(operatingIncome),
    netIncome: round(netIncome),
    operatingCashFlow: round(ocf),
    capex: round(capex),
    freeCashFlow: round(freeCashFlow),
    epsDiluted: round(epsDiluted),
    totalAssets: round(totalAssets),
    totalLiabilities: round(totalLiabilities),
    shareholdersEquity: round(shareholdersEquity),
    latestPrice: round(latestPrice),
    peTtm,
    psTtm,
    pbTtm,
    priceToFcfTtm,
    fcfYieldTtmPct,
    grossMarginPct,
    operatingMarginPct,
    netMarginPct,
    roePct,
    periodsIncluded,
  };
}
