import db from "@/lib/prisma";
import { formatCompanyUrl, formatMoney, getCompanyFinancials, getRecentHolders } from "@/lib/company-data";
import { getTribeMembers } from "@/lib/tribe";

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

export type ValueLineHolder = {
  name: string;
  investorName: string;
  firmName?: string;
  shares: number | null;
  weightPct: number | null;
  valueUsd: number | null;
  valueLabel: string | null;
  quarterLabel: string | null;
  activity?: "New" | "Added" | "Reduced" | "Unchanged" | "SoldOut" | string | null;
  shareDeltaPct?: number | null;
  tribeId: string | null;
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

  // Market & Pricing
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

export async function getValueLineData(identifier: string): Promise<ValueLineData | null> {
  const trimmed = identifier.trim().toUpperCase();

  const entity = await db.entity.findFirst({
    where: {
      type: "company",
      OR: [
        { ticker: trimmed },
        { code: trimmed },
        { id: identifier.trim() },
        { cik: identifier.trim().replace(/^CIK/i, "") },
      ],
    },
    select: {
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
    },
  });

  if (!entity) return null;

  const ticker = entity.ticker ?? entity.code ?? entity.canonicalName;
  const meta = (entity.metadata as Record<string, unknown>) ?? {};
  const nameZh = typeof meta.nameZh === "string" ? meta.nameZh.trim() : null;
  const industry = typeof meta.industry === "string" ? meta.industry : null;
  const exchange = typeof meta.exchange === "string" ? meta.exchange : null;
  const market = (entity.market as "hk" | "cn" | null) ?? "us";
  const href = formatCompanyUrl(entity) ?? `/company/${ticker}`;

  // 1. Fetch Price History (downsampled to weekly/monthly for fast sparkline)
  const priceRows = await db.stockPrice.findMany({
    where: { ticker },
    orderBy: { date: "asc" },
    select: { date: true, close: true, high: true, low: true },
  });

  const latestPriceRow = priceRows[priceRows.length - 1] ?? null;
  const latestPrice = latestPriceRow ? Number(latestPriceRow.close) : null;
  const latestPriceDate = latestPriceRow ? latestPriceRow.date.toISOString().slice(0, 10) : null;

  // 52-week high/low calculation
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const pastYearPrices = priceRows.filter((p) => p.date >= oneYearAgo);
  const high52w = pastYearPrices.length
    ? Math.max(...pastYearPrices.map((p) => Number(p.high ?? p.close)))
    : null;
  const low52w = pastYearPrices.length
    ? Math.min(...pastYearPrices.map((p) => Number(p.low ?? p.close)))
    : null;

  // Downsample price points for sparkline (~45 points max)
  const step = Math.max(1, Math.floor(priceRows.length / 45));
  const pricePoints = priceRows
    .filter((_, idx) => idx % step === 0 || idx === priceRows.length - 1)
    .map((p) => ({
      date: p.date.toISOString().slice(0, 10),
      close: Number(p.close),
    }));

  // 2. Fetch Multi-Year Financials
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

  // 3. Compute Value Triad & Capital Allocation Metrics
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

  // Cash Conversion Ratio = Total OCF / Total Net Income over last 3-5 years
  const totalOcf = recentAnnuals.reduce((acc, a) => acc + (a.operatingCashFlow ?? 0), 0);
  const totalNet = recentAnnuals.reduce((acc, a) => acc + (a.netIncome ?? 0), 0);
  const cashConversionRatio =
    totalNet > 0 && totalOcf > 0 ? Number((totalOcf / totalNet).toFixed(2)) : null;

  // Debt to Assets
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

  // Capital Allocation: 5-Year Share Count Change (Buyback vs Dilution)
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

  // Total 5-Year Cash Repurchase
  const totalBuyback5YUsd =
    recentAnnuals.reduce((acc, a) => acc + (a.repurchaseAmt ?? 0), 0) || null;

  // 5-Year CAGR (Revenue & Net Income)
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

  // Market Cap & PE Calculation
  const latestNetIncome = latestAnnual?.netIncome ?? null;
  const latestEquity = latestAnnual?.shareholdersEquity ?? null;
  const latestEps = latestAnnual?.eps ?? null;
  const sharesOutstanding = latestAnnual?.shares ?? null;

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

  // 4. Value Line Corridor (EPS x Benchmark PE)
  let benchmarkPe = 18.0;
  if (peRatio != null && peRatio >= 10 && peRatio <= 45) {
    benchmarkPe = peRatio;
  } else {
    const historicalPes: number[] = [];
    for (const a of recentAnnuals) {
      if (a.eps != null && a.eps > 0) {
        const pNear = priceRows.find((p) => p.date.toISOString().startsWith(`${a.year}`));
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

  const epsByYear = new Map<number, number>();
  recentAnnuals.forEach((a) => {
    if (a.eps != null && a.eps > 0) {
      epsByYear.set(a.year, a.eps);
    }
  });

  const minAvailableYear = recentAnnuals[0]?.year ?? 2020;
  const maxAvailableYear = recentAnnuals[recentAnnuals.length - 1]?.year ?? 2025;

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

  // Valuation Status at Latest Date
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

  // 5. Tribe Superinvestor Holders (deduplicated by holder/tribe)
  const [holdersRes, tribeMembers] = await Promise.all([
    getRecentHolders(entity.id, 10),
    getTribeMembers(),
  ]);
  const tribeMap = new Map(tribeMembers.map((m) => [m.id, m]));
  const seenHolders = new Set<string>();
  const topHolders: ValueLineHolder[] = [];
  for (const h of holdersRes.holders ?? []) {
    const key = h.tribeId ?? h.holderName;
    if (seenHolders.has(key)) continue;
    seenHolders.add(key);

    const member = h.tribeId ? tribeMap.get(h.tribeId) ?? null : null;
    const investorName = member?.nameZh ?? member?.name ?? h.holderName;
    const firmName = member?.firm ?? h.holderName;

    const rawValueUsd = h.valueUsd != null ? Number(h.valueUsd) : null;
    const effectiveValueUsd =
      rawValueUsd ?? (h.shares && latestPrice ? Number(h.shares) * latestPrice : null);
    const valueLabel = effectiveValueUsd != null ? `$${formatMoney(effectiveValueUsd)}` : null;

    topHolders.push({
      name: h.holderName,
      investorName,
      firmName,
      shares: h.shares ? Number(h.shares) : null,
      weightPct: h.percent != null ? Number(h.percent.toFixed(1)) : null,
      valueUsd: effectiveValueUsd,
      valueLabel,
      quarterLabel: h.sourceYear && h.sourceQuarter ? `${h.sourceYear}Q${h.sourceQuarter}` : null,
      activity: h.activity ?? null,
      shareDeltaPct: h.shareDeltaPct ?? null,
      tribeId: h.tribeId,
    });
    if (topHolders.length >= 4) break;
  }

  // 6. AI Business Essence, Moat & Risk Insights
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
    ticker,
    canonicalName: entity.canonicalName,
    nameZh,
    sector: entity.sector,
    industry,
    exchange,
    market,
    href,

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
