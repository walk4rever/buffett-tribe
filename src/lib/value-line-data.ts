import db from "@/lib/prisma";
import {
  formatCompanyUrl,
  formatDvlUrl,
  formatMoney,
  formatSecurityClassLabel,
  getCompanyFinancials,
  getCompanySecurities,
  getRecentHolders,
  parseCompanyIdentifier,
} from "@/lib/company-data";
import { getTribeMembers } from "@/lib/tribe";
import { getLatestPortfolioValueUsd } from "@/lib/master-data";
import { formatUsdInYi } from "@/lib/currency";

function parseNum(items: Record<string, string | number> | undefined, key: string): number | null {
  if (!items) return null;
  const val = items[key];
  if (val == null) return null;
  const n = typeof val === "number" ? val : Number(val);
  return Number.isFinite(n) ? n : null;
}

export type ValueLineAnnualData = {
  year: number;
  revenue: number | null;
  netIncome: number | null;
  operatingCashFlow: number | null;
  capEx: number | null;
  freeCashFlow: number | null;
  shareholdersEquity: number | null;
  totalAssets: number | null;
  totalLiabilities: number | null;
  roe: number | null; // percentage, e.g. 24.5
  eps: number | null;
  shares: number | null;
  repurchaseAmt: number | null;
};

export type ValueLineHolderBreakdownItem = {
  ticker: string;
  shareClassLabel: string | null;
  weightPct: number | null;
  shares: number | null;
  valueUsd: number | null;
};

export type ValueLineHolder = {
  name: string;
  investorName: string;
  firmName?: string;
  shares: number | null;
  weightPct: number | null;
  valueUsd: number | null;
  valueLabel: string | null;
  quarterLabel: string | null;
  sourceYear?: number | null;
  sourceQuarter?: number | null;
  activity?: "New" | "Added" | "Reduced" | "Unchanged" | "SoldOut" | string | null;
  shareDeltaPct?: number | null;
  tribeId: string | null;
  aumLabel?: string | null;
  shareClassLabel?: string | null;
  breakdownText?: string | null;
  breakdown?: ValueLineHolderBreakdownItem[];
};

export type ValueLineSecurityOption = {
  ticker: string;
  shareClass: string | null;
  titleOfClass: string | null;
  classLabel: string;
  isPrimary: boolean;

  latestPrice: number | null;
  latestPriceDate: string | null;
  high52w: number | null;
  low52w: number | null;
  marketCap: number | null;
  peRatio: number | null;
  pbRatio: number | null;

  pricePoints: Array<{ date: string; close: number }>;
  valueLinePoints: Array<{ date: string; value: number }>;
  valuationStatus: "undervalued" | "fair" | "overvalued" | "insufficient";
  valuationDiffPct: number | null;
};

export type ValueLineData = {
  entityId: string;
  ticker: string;
  canonicalName: string;
  nameZh: string | null;
  sector: string | null;
  industry: string | null;
  exchange: string | null;
  market: "us" | "hk" | "cn";
  href: string;
  dvlHref: string;

  // Multi-ticker / Security options
  availableSecurities: ValueLineSecurityOption[];
  selectedTicker: string;

  // Market & Pricing (Active Security)
  latestPrice: number | null;
  latestPriceDate: string | null;
  high52w: number | null;
  low52w: number | null;
  marketCap: number | null;
  peRatio: number | null;
  pbRatio: number | null;

  // Price history points (e.g. monthly for compact sparkline)
  pricePoints: Array<{ date: string; close: number }>;

  // Value Line Corridor (Price vs. Earnings Corridor)
  valueLinePoints: Array<{ date: string; value: number }>;
  benchmarkPe: number;
  valuationStatus: "undervalued" | "fair" | "overvalued" | "insufficient";
  valuationDiffPct: number | null;

  // Tribe Superinvestor Holders
  topHolders: ValueLineHolder[];

  // 1-Sentence Business Essence
  businessEssence: string;

  // AI Moat & Risk Insights
  aiMoat: string;
  aiRisk: string;
  moatStrength: string;

  // Value Triad & Capital Allocation (The Buffett Quadrant)
  annuals: ValueLineAnnualData[];
  roeAvg5Y: number | null;
  roeMin5Y: number | null;
  roeStability: "stellar" | "solid" | "volatile" | "negative" | "insufficient";
  cashConversionRatio: number | null; // OCF / NetIncome (past 3-5 yrs)
  debtToAssetsRatio: number | null;   // Liabilities / Assets (latest)
  isNetCash: boolean;

  // Capital Allocation specifics
  shareCountChangePct5Y: number | null; // e.g. -14.2%
  buybackLabel: string | null;          // "🔥 5年回购 -14.2%" or "⚠️ 5年稀释 +8.5%"
  totalBuyback5YUsd: number | null;     // Total cash spent on share repurchase
  safetyLabel: string;                  // "手握净现金 / 低负债" | "负债适度受控" | "高杠杆警惕"

  // 5-Year CAGR
  revenueCagr5Y: number | null;
  netIncomeCagr5Y: number | null;

  // Deep Dive Status & Company Narrative Profile
  hasDeepDive: boolean;
  overview: string | null;
  businessSummary: string | null;
  businessSegments: string | null;
};

export async function getValueLineData(
  identifier: string,
  preferredTicker?: string,
): Promise<ValueLineData | null> {
  const trimmed = identifier.trim();
  const parsed = parseCompanyIdentifier(trimmed);

  const entitySelect = {
    id: true,
    ticker: true,
    code: true,
    canonicalName: true,
    sector: true,
    market: true,
    cik: true,
    metadata: true,
    analyses: {
      select: {
        overview: true,
        canvas: true,
        profile: true,
        business: true,
        moat: true,
      },
    },
  };

  let entity = null;

  if (parsed) {
    if (parsed.market === "us") {
      entity = await db.entity.findFirst({
        where: { type: "company", cik: parsed.cik },
        select: entitySelect,
      });
    } else {
      entity = await db.entity.findFirst({
        where: { type: "company", market: parsed.market, code: parsed.code },
        select: entitySelect,
      });
    }
  }

  if (!entity) {
    const upper = trimmed.toUpperCase();
    entity = await db.entity.findFirst({
      where: {
        type: "company",
        OR: [
          { ticker: upper },
          { code: upper },
          { id: trimmed },
          { cik: trimmed.replace(/^(CIK|US-)/i, "").replace(/^0+/, "") },
        ],
      },
      select: entitySelect,
    });
  }

  // Fallback: lookup via security table (e.g. searching GOOGL finds Alphabet)
  if (!entity) {
    const sec = await db.security.findFirst({
      where: { ticker: { equals: trimmed, mode: "insensitive" } },
      select: { companyEntityId: true },
    });
    if (sec?.companyEntityId) {
      entity = await db.entity.findUnique({
        where: { id: sec.companyEntityId },
        select: entitySelect,
      });
    }
  }

  if (!entity) return null;

  const canonicalTicker = entity.ticker ?? entity.code ?? entity.canonicalName;
  const meta = (entity.metadata as Record<string, unknown>) ?? {};
  const nameZh = typeof meta.nameZh === "string" ? meta.nameZh.trim() : null;
  const industry = typeof meta.industry === "string" ? meta.industry : null;
  const exchange = typeof meta.exchange === "string" ? meta.exchange : null;
  const market = (entity.market as "hk" | "cn" | null) ?? "us";
  const href = formatCompanyUrl(entity) ?? `/company/${canonicalTicker}`;
  const dvlHref = formatDvlUrl(entity) ?? `/company/${canonicalTicker}`;

  // 1. Fetch Multi-Year Financials first to establish earnings base & benchmark PE
  const financials = await getCompanyFinancials(entity.id, 7);

  const annuals: ValueLineAnnualData[] = financials
    .map((f) => {
      const rev = parseNum(f.items, "Revenue");
      const net = parseNum(f.items, "NetIncome");
      const ocf = parseNum(f.items, "OperatingCashFlow");
      const capex = parseNum(f.items, "CapEx") ?? 0;
      const equity = parseNum(f.items, "ShareholdersEquity");
      const assets = parseNum(f.items, "TotalAssets");
      const liabilities = parseNum(f.items, "TotalLiabilities");
      const epsRaw = parseNum(f.items, "EPSDiluted") ?? parseNum(f.items, "EPSBasic");
      const repAmt = parseNum(f.items, "ShareRepurchaseAmt");
      const rawShs =
        parseNum(f.items, "CommonStockSharesOutstanding") ??
        parseNum(f.items, "WeightedAverageNumberOfDilutedSharesOutstanding");

      const shares = rawShs ?? (net != null && epsRaw != null && epsRaw > 0 ? net / epsRaw : null);
      const eps =
        epsRaw ?? (net != null && shares != null && shares > 0 ? Number((net / shares).toFixed(2)) : null);

      // ROE is only meaningful if equity > 0
      const roe =
        net != null && equity != null && equity > 0 ? Number(((net / equity) * 100).toFixed(1)) : null;

      const fcf = ocf != null ? ocf - capex : null;

      return {
        year: f.year,
        revenue: rev,
        netIncome: net,
        operatingCashFlow: ocf,
        capEx: capex,
        freeCashFlow: fcf,
        shareholdersEquity: equity,
        totalAssets: assets,
        totalLiabilities: liabilities,
        roe,
        eps,
        shares,
        repurchaseAmt: repAmt,
      };
    })
    .sort((a, b) => a.year - b.year);

  // Value Triad & Capital Allocation Metrics
  const recentAnnuals = annuals.slice(-5);
  const validRoes = recentAnnuals.map((a) => a.roe).filter((r): r is number => r != null);
  const roeAvg5Y = validRoes.length
    ? Number((validRoes.reduce((sum, v) => sum + v, 0) / validRoes.length).toFixed(1))
    : null;
  const roeMin5Y = validRoes.length ? Math.min(...validRoes) : null;

  let roeStability: ValueLineData["roeStability"] = "insufficient";
  if (roeAvg5Y != null && roeMin5Y != null && validRoes.length >= 3) {
    if (roeMin5Y > 15) roeStability = "stellar";
    else if (roeAvg5Y > 12 && roeMin5Y > 8) roeStability = "solid";
    else if (roeAvg5Y > 0) roeStability = "volatile";
    else roeStability = "negative";
  }

  const totalOcf = recentAnnuals.reduce((acc, a) => acc + (a.operatingCashFlow ?? 0), 0);
  const totalNet = recentAnnuals.reduce((acc, a) => acc + (a.netIncome ?? 0), 0);
  const cashConversionRatio =
    totalNet > 0 && totalOcf > 0 ? Number((totalOcf / totalNet).toFixed(2)) : null;

  const latestAnnual = annuals[annuals.length - 1] ?? null;
  const debtToAssetsRatio =
    latestAnnual?.totalLiabilities != null && latestAnnual?.totalAssets != null && latestAnnual.totalAssets > 0
      ? Number(((latestAnnual.totalLiabilities / latestAnnual.totalAssets) * 100).toFixed(1))
      : null;

  const isNetCash = debtToAssetsRatio != null ? debtToAssetsRatio < 40 : false;

  let safetyLabel = "负债稳健可控";
  if (debtToAssetsRatio != null) {
    if (debtToAssetsRatio < 35 || isNetCash) {
      safetyLabel = "手握净现金 / 低负债";
    } else if (debtToAssetsRatio > 65) {
      safetyLabel = "高杠杆警惕";
    } else {
      safetyLabel = "负债比例稳健适度";
    }
  }

  const annualsWithShares = recentAnnuals.filter((a) => a.shares != null && a.shares > 0);
  let shareCountChangePct5Y: number | null = null;
  let buybackLabel: string | null = null;
  if (annualsWithShares.length >= 2) {
    const oldestShs = annualsWithShares[0].shares!;
    const newestShs = annualsWithShares[annualsWithShares.length - 1].shares!;
    shareCountChangePct5Y = Number((((newestShs - oldestShs) / oldestShs) * 100).toFixed(1));
    if (shareCountChangePct5Y <= -3) {
      buybackLabel = `🔥 5年注销回购 ${Math.abs(shareCountChangePct5Y)}%`;
    } else if (shareCountChangePct5Y >= 5) {
      buybackLabel = `⚠️ 5年增发稀释 +${shareCountChangePct5Y}%`;
    } else {
      buybackLabel = `股本稳定 (${shareCountChangePct5Y > 0 ? "+" : ""}${shareCountChangePct5Y}%)`;
    }
  }

  const totalBuyback5YUsd =
    recentAnnuals.reduce((acc, a) => acc + (a.repurchaseAmt ?? 0), 0) || null;

  let revenueCagr5Y: number | null = null;
  let netIncomeCagr5Y: number | null = null;
  if (recentAnnuals.length >= 2) {
    const firstA = recentAnnuals[0];
    const lastA = recentAnnuals[recentAnnuals.length - 1];
    const span = Math.max(1, lastA.year - firstA.year);
    if (firstA.revenue && lastA.revenue && firstA.revenue > 0 && lastA.revenue > 0) {
      revenueCagr5Y = Number((((lastA.revenue / firstA.revenue) ** (1 / span) - 1) * 100).toFixed(1));
    }
    if (firstA.netIncome && lastA.netIncome && firstA.netIncome > 0 && lastA.netIncome > 0) {
      netIncomeCagr5Y = Number((((lastA.netIncome / firstA.netIncome) ** (1 / span) - 1) * 100).toFixed(1));
    }
  }

  const latestNetIncome = latestAnnual?.netIncome ?? null;
  const latestEquity = latestAnnual?.shareholdersEquity ?? null;
  const latestEps = latestAnnual?.eps ?? null;
  const sharesOutstanding = latestAnnual?.shares ?? null;

  // EPS by year map for corridor
  const epsByYear = new Map<number, number>();
  recentAnnuals.forEach((a) => {
    if (a.eps != null && a.eps > 0) {
      epsByYear.set(a.year, a.eps);
    }
  });

  const minAvailableYear = recentAnnuals[0]?.year ?? 2020;
  const maxAvailableYear = recentAnnuals[recentAnnuals.length - 1]?.year ?? 2025;

  // 2. Fetch all securities and stock price histories for multi-ticker support
  const rawSecurities = await getCompanySecurities(entity.id);

  const candidateTickers = Array.from(
    new Set([canonicalTicker, ...rawSecurities.map((s) => s.ticker).filter((t): t is string => Boolean(t))])
  );

  const allPriceRows = await db.stockPrice.findMany({
    where: { ticker: { in: candidateTickers } },
    orderBy: { date: "asc" },
    select: { ticker: true, date: true, close: true, high: true, low: true },
  });

  const priceRowsByTicker = new Map<string, typeof allPriceRows>();
  for (const p of allPriceRows) {
    if (!priceRowsByTicker.has(p.ticker)) {
      priceRowsByTicker.set(p.ticker, []);
    }
    priceRowsByTicker.get(p.ticker)!.push(p);
  }

  // Tickers that actually have prices
  const validTickers = candidateTickers.filter((t) => (priceRowsByTicker.get(t)?.length ?? 0) > 0);

  // If no prices found under securities, try canonicalTicker
  if (validTickers.length === 0 && priceRowsByTicker.has(canonicalTicker)) {
    validTickers.push(canonicalTicker);
  }

  // Calculate benchmark PE across company's primary prices
  const primaryRows = priceRowsByTicker.get(canonicalTicker) ?? allPriceRows;
  let benchmarkPe = 18.0;
  const canonicalLatestClose = primaryRows.length ? Number(primaryRows[primaryRows.length - 1].close) : null;
  const primaryPe =
    canonicalLatestClose != null && latestEps != null && latestEps > 0
      ? canonicalLatestClose / latestEps
      : null;

  if (primaryPe != null && primaryPe >= 10 && primaryPe <= 45) {
    benchmarkPe = Number(primaryPe.toFixed(1));
  } else {
    const historicalPes: number[] = [];
    for (const a of recentAnnuals) {
      if (a.eps != null && a.eps > 0) {
        const pNear = primaryRows.find((p) => p.date.toISOString().startsWith(`${a.year}`));
        if (pNear) {
          const pe = Number(pNear.close) / a.eps;
          if (pe >= 8 && pe <= 50) historicalPes.push(pe);
        }
      }
    }
    if (historicalPes.length > 0) {
      historicalPes.sort((a, b) => a - b);
      benchmarkPe = Number(historicalPes[Math.floor(historicalPes.length / 2)].toFixed(1));
    }
  }
  benchmarkPe = Math.max(12, Math.min(35, benchmarkPe));

  // Build security options
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  const availableSecurities: ValueLineSecurityOption[] = validTickers.map((t) => {
    const pRows = priceRowsByTicker.get(t) ?? [];
    const secRow = rawSecurities.find((s) => s.ticker?.toUpperCase() === t.toUpperCase());
    const isPrimary = t.toUpperCase() === canonicalTicker.toUpperCase();
    const classLabel = secRow ? formatSecurityClassLabel(secRow) ?? (validTickers.length > 1 ? t : "") : "";

    const latestRow = pRows[pRows.length - 1] ?? null;
    const latestPrice = latestRow ? Number(latestRow.close) : null;
    const latestPriceDate = latestRow ? latestRow.date.toISOString().slice(0, 10) : null;

    const pastYearPrices = pRows.filter((p) => p.date >= oneYearAgo);
    const high52w = pastYearPrices.length
      ? Math.max(...pastYearPrices.map((p) => Number(p.high ?? p.close)))
      : null;
    const low52w = pastYearPrices.length
      ? Math.min(...pastYearPrices.map((p) => Number(p.low ?? p.close)))
      : null;

    const step = Math.max(1, Math.floor(pRows.length / 45));
    const pricePoints = pRows
      .filter((_, idx) => idx % step === 0 || idx === pRows.length - 1)
      .map((p) => ({
        date: p.date.toISOString().slice(0, 10),
        close: Number(p.close),
      }));

    const valueLinePoints = pricePoints.map((p) => {
      const pointYear = parseInt(p.date.slice(0, 4), 10);
      const clampedYear = Math.max(minAvailableYear, Math.min(maxAvailableYear, pointYear));
      const epsVal =
        epsByYear.get(clampedYear) ??
        epsByYear.get(maxAvailableYear) ??
        (latestPrice != null ? latestPrice / benchmarkPe : 1);
      const val = Number((epsVal * benchmarkPe).toFixed(2));
      return {
        date: p.date,
        value: val,
      };
    });

    let valuationStatus: ValueLineData["valuationStatus"] = "insufficient";
    let valuationDiffPct: number | null = null;
    const latestValPoint = valueLinePoints[valueLinePoints.length - 1];
    if (latestPrice != null && latestValPoint && latestValPoint.value > 0) {
      const ratio = latestPrice / latestValPoint.value;
      valuationDiffPct = Number(((ratio - 1) * 100).toFixed(0));
      if (valuationDiffPct <= -15) {
        valuationStatus = "undervalued";
      } else if (valuationDiffPct >= 20) {
        valuationStatus = "overvalued";
      } else {
        valuationStatus = "fair";
      }
    }

    const marketCap =
      latestPrice != null && sharesOutstanding != null && sharesOutstanding > 0
        ? latestPrice * sharesOutstanding
        : null;

    const peRatio =
      latestPrice != null && latestEps != null && latestEps > 0
        ? Number((latestPrice / latestEps).toFixed(1))
        : marketCap != null && latestNetIncome != null && latestNetIncome > 0
          ? Number((marketCap / latestNetIncome).toFixed(1))
          : null;

    const pbRatio =
      marketCap != null && latestEquity != null && latestEquity > 0
        ? Number((marketCap / latestEquity).toFixed(1))
        : null;

    return {
      ticker: t,
      shareClass: secRow?.shareClass ?? null,
      titleOfClass: secRow?.titleOfClass ?? null,
      classLabel,
      isPrimary,
      latestPrice,
      latestPriceDate,
      high52w,
      low52w,
      marketCap,
      peRatio,
      pbRatio,
      pricePoints,
      valueLinePoints,
      valuationStatus,
      valuationDiffPct,
    };
  });

  // Ensure canonical ticker is listed first
  availableSecurities.sort((a, b) => (a.isPrimary ? -1 : b.isPrimary ? 1 : 0));

  // Determine active security
  const preferredNorm = preferredTicker?.trim().toUpperCase();
  const activeSec =
    availableSecurities.find((s) => s.ticker.toUpperCase() === preferredNorm) ??
    availableSecurities.find((s) => s.isPrimary) ??
    availableSecurities[0] ??
    null;

  const currentTicker = activeSec?.ticker ?? canonicalTicker;
  const latestPrice = activeSec?.latestPrice ?? null;
  const latestPriceDate = activeSec?.latestPriceDate ?? null;
  const high52w = activeSec?.high52w ?? null;
  const low52w = activeSec?.low52w ?? null;
  const marketCap = activeSec?.marketCap ?? null;
  const peRatio = activeSec?.peRatio ?? null;
  const pbRatio = activeSec?.pbRatio ?? null;
  const pricePoints = activeSec?.pricePoints ?? [];
  const valueLinePoints = activeSec?.valueLinePoints ?? [];
  const valuationStatus = activeSec?.valuationStatus ?? "insufficient";
  const valuationDiffPct = activeSec?.valuationDiffPct ?? null;

  // 3. Tribe Superinvestor Holders (aggregated with multi-ticker class breakdown)
  const [holdersRes, tribeMembers] = await Promise.all([
    getRecentHolders(entity.id, 20),
    getTribeMembers(),
  ]);
  const tribeMap = new Map(tribeMembers.map((m) => [m.id, m]));

  const distinctTribeIds = [
    ...new Set(
      (holdersRes.holders ?? [])
        .map((h) => h.tribeId)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const aumEntries = await Promise.all(
    distinctTribeIds.map(async (tribeId) => {
      try {
        const val = await getLatestPortfolioValueUsd(tribeId);
        return [tribeId, val ? `AUM $${formatUsdInYi(val)}` : null] as const;
      } catch {
        return [tribeId, null] as const;
      }
    })
  );
  const aumMap = new Map(aumEntries);

  type GroupedHolder = {
    name: string;
    investorName: string;
    firmName?: string;
    tribeId: string | null;
    activity?: string | null;
    shareDeltaPct?: number | null;
    quarterLabel: string | null;
    sourceYear: number | null;
    sourceQuarter: number | null;
    isSoldOut: boolean;
    items: Array<{
      ticker: string;
      classLabel: string | null;
      shares: number | null;
      weightPct: number | null;
      valueUsd: number | null;
      isSoldOut?: boolean;
    }>;
  };

  const holderGroups = new Map<string, GroupedHolder>();
  const distinctCompanyTickers = new Set(
    rawSecurities
      .map((s) => s.ticker?.trim().toUpperCase())
      .filter((t): t is string => Boolean(t))
  );

  for (const h of holdersRes.holders ?? []) {
    const groupKey = h.tribeId ?? h.holderName;
    const member = h.tribeId ? tribeMap.get(h.tribeId) ?? null : null;
    const investorName = member?.nameZh ?? member?.name ?? h.holderName;
    const firmName = member?.firm ?? h.holderName;

    const rawValueUsd = h.valueUsd != null ? Number(h.valueUsd) : null;
    const effectiveValueUsd =
      rawValueUsd ?? (h.shares && latestPrice ? Number(h.shares) * latestPrice : null);

    const secRow = rawSecurities.find((s) => s.ticker?.toUpperCase() === h.ticker?.toUpperCase());
    const classLabel = secRow ? formatSecurityClassLabel(secRow) : null;
    const isSoldOut = h.isSoldOut ?? (h.activity === "SoldOut");

    if (!holderGroups.has(groupKey)) {
      holderGroups.set(groupKey, {
        name: h.holderName,
        investorName,
        firmName,
        tribeId: h.tribeId,
        activity: h.activity ?? null,
        shareDeltaPct: h.shareDeltaPct ?? null,
        quarterLabel: h.sourceYear && h.sourceQuarter ? `${h.sourceYear}Q${h.sourceQuarter}` : null,
        sourceYear: h.sourceYear ?? null,
        sourceQuarter: h.sourceQuarter ?? null,
        isSoldOut,
        items: [],
      });
    } else {
      const existing = holderGroups.get(groupKey)!;
      if (!isSoldOut) {
        existing.isSoldOut = false;
        if (existing.activity === "SoldOut") {
          existing.activity = h.activity ?? null;
        }
      }
      const currentScore = (h.sourceYear ?? 0) * 4 + (h.sourceQuarter ?? 0);
      const existingScore = (existing.sourceYear ?? 0) * 4 + (existing.sourceQuarter ?? 0);
      if (currentScore > existingScore) {
        existing.sourceYear = h.sourceYear ?? null;
        existing.sourceQuarter = h.sourceQuarter ?? null;
        existing.quarterLabel = h.sourceYear && h.sourceQuarter ? `${h.sourceYear}Q${h.sourceQuarter}` : null;
      }
    }

    holderGroups.get(groupKey)!.items.push({
      ticker: h.ticker ?? "",
      classLabel,
      shares: h.shares ? Number(h.shares) : null,
      weightPct: h.percent != null ? Number(h.percent.toFixed(2)) : null,
      valueUsd: effectiveValueUsd,
      isSoldOut,
    });
  }

  const aggregatedHolders: ValueLineHolder[] = [];
  for (const group of holderGroups.values()) {
    const totalShares = group.items.reduce((sum, it) => sum + (it.shares ?? 0), 0);
    const totalWeight = group.items.reduce((sum, it) => sum + (it.weightPct ?? 0), 0);
    const totalValue = group.items.reduce((sum, it) => sum + (it.valueUsd ?? 0), 0);

    const breakdown: ValueLineHolderBreakdownItem[] = group.items.map((it) => ({
      ticker: it.ticker,
      shareClassLabel: it.classLabel,
      weightPct: it.weightPct,
      shares: it.shares,
      valueUsd: it.valueUsd,
    }));

    let shareClassLabel: string | null = null;
    let breakdownText: string | null = null;

    // Only display ticker labels when company actually has multiple distinct share classes (e.g. GOOG + GOOGL)
    if (distinctCompanyTickers.size > 1) {
      if (group.items.length > 1) {
        const tickers = group.items.map((it) => it.ticker).filter(Boolean);
        shareClassLabel = tickers.join(" + ");
        const shortLabels = group.items.map((it) => {
          return it.weightPct != null ? `${it.ticker} ${it.weightPct.toFixed(1)}%` : it.ticker;
        });
        breakdownText = shortLabels.join(" + ");
      } else if (group.items.length === 1 && group.items[0].ticker) {
        shareClassLabel = group.items[0].ticker;
      }
    }

    const aumLabel = group.tribeId ? aumMap.get(group.tribeId) ?? null : null;

    aggregatedHolders.push({
      name: group.name,
      investorName: group.investorName,
      firmName: group.firmName,
      shares: totalShares > 0 ? totalShares : null,
      weightPct: totalWeight > 0 ? Number(totalWeight.toFixed(1)) : null,
      valueUsd: totalValue > 0 ? totalValue : null,
      valueLabel: totalValue > 0 ? `$${formatMoney(totalValue)}` : null,
      quarterLabel: group.quarterLabel,
      sourceYear: group.sourceYear,
      sourceQuarter: group.sourceQuarter,
      activity: group.activity,
      shareDeltaPct: group.shareDeltaPct,
      tribeId: group.tribeId,
      aumLabel,
      shareClassLabel,
      breakdownText,
      breakdown,
    });
  }

  // Multi-tier sorting:
  // 1. Active holding before SoldOut
  // 2. Most recent quarter first (sourceYear, sourceQuarter)
  // 3. Holding weight % descending
  // 4. Holding market value USD descending
  aggregatedHolders.sort((a, b) => {
    const aSoldOut = a.activity === "SoldOut";
    const bSoldOut = b.activity === "SoldOut";
    if (aSoldOut !== bSoldOut) {
      return aSoldOut ? 1 : -1;
    }

    const aQuarterScore = (a.sourceYear ?? 0) * 4 + (a.sourceQuarter ?? 0);
    const bQuarterScore = (b.sourceYear ?? 0) * 4 + (b.sourceQuarter ?? 0);
    if (aQuarterScore !== bQuarterScore) {
      return bQuarterScore - aQuarterScore;
    }

    const aWeight = a.weightPct ?? 0;
    const bWeight = b.weightPct ?? 0;
    if (Math.abs(bWeight - aWeight) > 0.001) {
      return bWeight - aWeight;
    }

    const aValue = a.valueUsd ?? 0;
    const bValue = b.valueUsd ?? 0;
    return bValue - aValue;
  });
  const topHolders = aggregatedHolders.slice(0, 4);

  // 4. AI Business Essence, Moat & Risk Insights
  const analysis = entity.analyses[0] ?? null;
  const hasDeepDive = Boolean(analysis?.canvas || analysis?.business || analysis?.moat);
  const profileJson = analysis?.profile as { title?: string; content?: string } | null | undefined;
  const businessJson = analysis?.business as { narrative?: { title?: string; content?: string } } | null | undefined;
  const moatJson = analysis?.moat as {
    summary?: { thesis?: string; strength?: string; type?: string };
    notes?: Array<{ label: string; value: string; enLabel?: string }>;
  } | null | undefined;

  let businessEssence = "";
  if (analysis?.overview) {
    businessEssence = analysis.overview.split(/[。！？\n]/)[0] + "。";
  } else if (moatJson?.summary?.thesis && moatJson.summary.thesis.length >= 10) {
    businessEssence = moatJson.summary.thesis.split(/[。！？\n]/)[0] + "。";
  } else if (profileJson?.content) {
    businessEssence = profileJson.content.split(/[。！？\n]/)[0] + "。";
  } else if (businessJson?.narrative?.content) {
    businessEssence = businessJson.narrative.content.split(/[。！？\n]/)[0] + "。";
  } else {
    businessEssence = `${nameZh ?? entity.canonicalName}，${entity.sector ?? "优质"}赛道代表企业，拥有稳固的商业运营与客户基础。`;
  }
  if (businessEssence.length > 80) {
    businessEssence = businessEssence.slice(0, 78) + "...";
  }

  const coreMoatNote = moatJson?.notes?.find(
    (n) => n.label.includes("护城河") || n.enLabel === "Core Moat"
  );
  const aiMoat =
    coreMoatNote?.value ??
    (roeStability === "stellar"
      ? "长期卓越 ROE 构筑深厚经济特许权与稳定定价权"
      : "具备行业壁垒与客户转换成本优势");

  const coreRiskNote = moatJson?.notes?.find(
    (n) => n.label.includes("最脆弱") || n.label.includes("风险") || n.enLabel === "Weakest Link"
  );
  const aiRisk =
    coreRiskNote?.value ??
    (debtToAssetsRatio && debtToAssetsRatio > 65
      ? "总负债率偏高，需警惕再融资与宏观加息周期"
      : "需密切关注行业竞争格局重塑与再投资资本回报率");

  const moatStrength = moatJson?.summary?.strength ?? (roeStability === "stellar" ? "强" : "中");

  const revStr = latestAnnual?.revenue ? formatMoney(String(latestAnnual.revenue)) : null;
  const fallbackSummary = `${nameZh ?? entity.canonicalName} 是一家${exchange ? `在 ${exchange} 上市的` : "公开上市的"}${entity.sector ?? "优质"}企业${industry ? `，细分行业为 ${industry}` : ""}。以定期财报与合规披露为基础，聚焦其商业壁垒与资本回报能力。`;
  const fallbackSegments = revStr
    ? `${nameZh ?? entity.canonicalName} 最近完整财年营收约 ${revStr}。主营业务与产品结构涵盖其细分领域核心产品线，盈利质量与现金流表现可参见下方报表细目。`
    : null;

  const overview = analysis?.overview ?? profileJson?.content ?? fallbackSummary;
  const businessSummary = overview;
  const businessSegments = businessJson?.narrative?.content ?? fallbackSegments;

  return {
    entityId: entity.id,
    ticker: currentTicker,
    canonicalName: entity.canonicalName,
    nameZh,
    sector: entity.sector,
    industry,
    exchange,
    market,
    href,
    dvlHref,

    availableSecurities,
    selectedTicker: currentTicker,

    latestPrice,
    latestPriceDate,
    high52w,
    low52w,
    marketCap,
    peRatio,
    pbRatio,

    pricePoints,
    valueLinePoints,
    benchmarkPe,
    valuationStatus,
    valuationDiffPct,

    topHolders,
    businessEssence,

    aiMoat,
    aiRisk,
    moatStrength,

    annuals,
    roeAvg5Y,
    roeMin5Y,
    roeStability,
    cashConversionRatio,
    debtToAssetsRatio,
    isNetCash,

    shareCountChangePct5Y,
    buybackLabel,
    totalBuyback5YUsd,
    safetyLabel,

    revenueCagr5Y,
    netIncomeCagr5Y,

    hasDeepDive,
    overview,
    businessSummary,
    businessSegments,
  };
}
