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

export type SectorModelType =
  | "general"
  | "bank_insurance"
  | "real_estate"
  | "utilities"
  | "cyclical";

export function detectSectorModel(
  sectorRaw?: string | null,
  industryRaw?: string | null,
  nameRaw?: string | null,
): {
  type: SectorModelType;
  label: string;
} {
  const text = `${sectorRaw ?? ""} ${industryRaw ?? ""} ${nameRaw ?? ""}`.toLowerCase();

  // 1. 房地产优先于普通金融 (如香港 GICS 经常将地产归在 Financials)
  if (
    text.includes("real estate") ||
    text.includes("reit") ||
    text.includes("property") ||
    text.includes("地产") ||
    text.includes("房地") ||
    text.includes("物业")
  ) {
    return { type: "real_estate", label: "房地产模型" };
  }

  // 2. 银行与保险 / 金融中介
  if (
    text.includes("bank") ||
    text.includes("insurance") ||
    text.includes("life insurance") ||
    text.includes("credit") ||
    text.includes("financial") ||
    text.includes("capital market") ||
    text.includes("securities") ||
    text.includes("asset management") ||
    text.includes("银行") ||
    text.includes("保险") ||
    text.includes("寿险") ||
    text.includes("券商") ||
    text.includes("证券") ||
    text.includes("信托") ||
    text.includes("金融")
  ) {
    return { type: "bank_insurance", label: "银行与保险模型" };
  }

  // 3. 公用事业与特许基建
  if (
    text.includes("utilities") ||
    text.includes("utility") ||
    text.includes("electric") ||
    text.includes("water supply") ||
    text.includes("gas utility") ||
    text.includes("hydropower") ||
    text.includes("公用事业") ||
    text.includes("电力") ||
    text.includes("水务") ||
    text.includes("燃气") ||
    text.includes("热力") ||
    text.includes("水电") ||
    text.includes("电网")
  ) {
    return { type: "utilities", label: "公用事业特许模型" };
  }

  // 4. 强周期资源 (能源/矿产/大宗商品材料/航运)
  if (
    text.includes("energy") ||
    text.includes("materials") ||
    text.includes("mining") ||
    text.includes("metals") ||
    text.includes("oil & gas") ||
    text.includes("petroleum") ||
    text.includes("coal") ||
    text.includes("steel") ||
    text.includes("chemical") ||
    text.includes("shipping") ||
    text.includes("能源") ||
    text.includes("采掘") ||
    text.includes("石油") ||
    text.includes("天然气") ||
    text.includes("煤炭") ||
    text.includes("钢铁") ||
    text.includes("有色") ||
    text.includes("化工") ||
    text.includes("航运") ||
    text.includes("海运")
  ) {
    return { type: "cyclical", label: "强周期资源模型" };
  }

  return { type: "general", label: "标准工商业模型" };
}

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

  // Sector Adaptive Model
  sectorModelType: SectorModelType;
  sectorModelLabel: string;
  cyclicalWarning: { title: string; message: string } | null;

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

  // Adaptive Quadrant Metrics
  metric1Title?: string;
  metric1Badge?: string;
  metric1BadgeClass?: string;
  metric1SubText?: string;

  metric2Title: string;
  metric2Badge: string;
  metric2BadgeClass: string;
  metric2MainNum: string;
  metric2SubText: string;

  metric4Title: string;
  metric4Badge: string;
  metric4BadgeClass: string;
  metric4MainNum: string;
  metric4SubText: string;

  // Capital Allocation specifics
  shareCountChangePct5Y: number | null; // e.g. -14.2%
  buybackLabel: string | null;          // "🔥 5年回购 -14.2%" or "⚠️ 5年稀释 +8.5%"
  totalBuyback5YUsd: number | null;     // Total cash spent on share repurchase (backward compat)
  totalBuyback5Y: number | null;
  buybackAmountLabel: string | null;    // e.g. "5年累计回购 ¥89.9亿"
  safetyLabel: string;                  // "手握净现金 / 低负债" | "负债适度受控" | "高杠杆警惕"

  // 5-Year CAGR
  revenueCagr5Y: number | null;
  revenueCagrLabel?: string | null;
  netIncomeCagr5Y: number | null;
  netIncomeCagrLabel?: string | null;

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
  const currency = typeof meta.currency === "string" ? meta.currency : market === "cn" ? "CNY" : market === "hk" ? "HKD" : "USD";
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

      // Robust shares estimation: if raw shares are unavailable (common in CN/HK),
      // deduce from NetIncome / EPS. Works even if both net and epsRaw are negative (loss).
      let shares: number | null = rawShs;
      if (shares == null && net != null && epsRaw != null && Math.abs(epsRaw) > 0.0001 && Math.abs(net) > 0) {
        shares = Math.round(Math.abs(net / epsRaw));
      }

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

  // Sector Model Adaptive Framework (Banking/Insurance vs Real Estate vs Utilities vs Cyclical vs General)
  const sectorModel = detectSectorModel(entity.sector, industry, nameZh ?? entity.canonicalName);
  const sectorModelType = sectorModel.type;
  const sectorModelLabel = sectorModel.label;

  // ── Metric 1: 5-Year ROE ──
  const metric1Title = "5年 ROE 均值";
  let metric1Badge =
    roeStability === "stellar"
      ? "★ 卓越护城河"
      : roeStability === "solid"
        ? "稳健盈利"
        : "周期性波动";
  let metric1BadgeClass =
    roeStability === "stellar"
      ? "vl-badge--stellar"
      : roeStability === "solid"
        ? "vl-badge--solid"
        : "vl-badge--neutral";
  let metric1SubText =
    roeMin5Y != null ? `5年最低 ${roeMin5Y}%` : "年化资本回报";

  if (sectorModelType === "bank_insurance") {
    if (roeAvg5Y != null && roeAvg5Y >= 11) {
      metric1Badge = "稳健利差回报";
      metric1BadgeClass = "vl-badge--cash";
    }
    metric1SubText = "加杠杆资本回报率 · 资产质量第一";
  } else if (sectorModelType === "utilities") {
    metric1Badge = "特许稳健回报";
    metric1BadgeClass = "vl-badge--cash";
    metric1SubText = "受监管核准资产回报 · 刚需抗周期";
  } else if (sectorModelType === "cyclical") {
    if (roeAvg5Y != null && roeAvg5Y >= 18) {
      metric1Badge = "景气高点回报";
      metric1BadgeClass = "vl-badge--alert";
      metric1SubText = "处于大宗周期景气高位 · 警惕周期均值回归";
    } else {
      metric1Badge = "周期起伏回报";
      metric1BadgeClass = "vl-badge--neutral";
      metric1SubText = "随行业供需景气周期大幅波动";
    }
  }

  // ── Metric 2: Cash Conversion ──
  let metric2Title = "真金白银造血力";
  let metric2Badge =
    cashConversionRatio && cashConversionRatio >= 1 ? "纯正造血" : "稳健现金";
  let metric2BadgeClass = "vl-badge--cash";
  let metric2MainNum =
    cashConversionRatio != null ? `${cashConversionRatio}x` : "—";
  let metric2SubText = "经营现金流 / 净利润";

  if (sectorModelType === "bank_insurance") {
    metric2Title = "资金营运与息差";
    metric2Badge = "特许资金运作";
    metric2BadgeClass = "vl-badge--neutral";
    metric2MainNum =
      cashConversionRatio != null && cashConversionRatio > 0 && cashConversionRatio <= 3.5
        ? `${cashConversionRatio}x`
        : "息差驱动";
    metric2SubText = "存贷投放与保单准备金驱动 (不适用工业OCF模型)";
  } else if (sectorModelType === "utilities") {
    metric2Title = "特许现金造血";
    metric2Badge = "特许现金奶牛";
    metric2BadgeClass = "vl-badge--cash";
    metric2MainNum =
      cashConversionRatio != null ? `${cashConversionRatio}x` : "—";
    metric2SubText = "特许权持续现金流入 · 高折旧充沛现金流";
  } else if (sectorModelType === "real_estate") {
    metric2Title = "销售回款与现金流";
    metric2Badge =
      cashConversionRatio && cashConversionRatio >= 1 ? "回款良性" : "在建存货沉淀";
    metric2BadgeClass =
      cashConversionRatio && cashConversionRatio >= 1 ? "vl-badge--cash" : "vl-badge--neutral";
    metric2MainNum =
      cashConversionRatio != null ? `${cashConversionRatio}x` : "—";
    metric2SubText = "经营现金流 / 净利润 (拿地与交房周期影响)";
  } else if (sectorModelType === "cyclical") {
    metric2Title = "周期现金造血";
    metric2Badge =
      cashConversionRatio && cashConversionRatio >= 1 ? "高景气现金回流" : "资本开支吸收";
    metric2BadgeClass =
      cashConversionRatio && cashConversionRatio >= 1 ? "vl-badge--cash" : "vl-badge--neutral";
    metric2MainNum =
      cashConversionRatio != null ? `${cashConversionRatio}x` : "—";
    metric2SubText = "经营现金流 / 净利润 (随大宗商品价格剧烈联动)";
  }

  // ── Metric 4: Balance Sheet & Safety ──
  let metric4Title = "资产负债与安全性";
  let metric4Badge = isNetCash ? "净现金充沛" : "适度杠杆";
  let metric4BadgeClass = isNetCash ? "vl-badge--cash" : "vl-badge--neutral";
  const metric4MainNum = debtToAssetsRatio != null ? `${debtToAssetsRatio}%` : "—";
  let metric4SubText = "负债稳健可控";

  if (sectorModelType === "bank_insurance") {
    metric4Title = "资本结构与偿付准备";
    metric4Badge = "特许资金杠杆";
    metric4BadgeClass = "vl-badge--neutral";
    metric4SubText = "负债主体为客户存款/保单准备金 · 核心看流动性与资本充足率";
  } else if (sectorModelType === "real_estate") {
    metric4Title = "负债结构与去化偿债";
    metric4Badge =
      debtToAssetsRatio && debtToAssetsRatio > 75 ? "高周转杠杆" : "适度杠杆";
    metric4BadgeClass =
      debtToAssetsRatio && debtToAssetsRatio > 75 ? "vl-badge--alert" : "vl-badge--neutral";
    metric4SubText = "包含大量预收购房款(合同负债) · 重点关注真实现金短债比";
  } else if (sectorModelType === "utilities") {
    metric4Title = "资本结构与项目债";
    metric4Badge = "长期特许项目债";
    metric4BadgeClass = "vl-badge--neutral";
    metric4SubText = "特许基础设施长期贷款 · 充沛现金流全额覆盖利息支出";
  } else if (sectorModelType === "cyclical") {
    metric4Title = "资产负债与周期防御";
    metric4Badge = isNetCash
      ? "手握充沛现金"
      : debtToAssetsRatio && debtToAssetsRatio > 60
        ? "警惕下行期负债"
        : "周期防守稳健";
    metric4BadgeClass = isNetCash
      ? "vl-badge--cash"
      : debtToAssetsRatio && debtToAssetsRatio > 60
        ? "vl-badge--alert"
        : "vl-badge--neutral";
    metric4SubText = "需具备穿越大宗商品低谷期的充沛偿债与现金安全垫";
  } else if (debtToAssetsRatio != null) {
    if (debtToAssetsRatio < 35 || isNetCash) {
      metric4Badge = "净现金充沛";
      metric4BadgeClass = "vl-badge--cash";
      metric4SubText = "手握净现金 / 低负债安全边际";
    } else if (debtToAssetsRatio > 65) {
      metric4Badge = "高杠杆警惕";
      metric4BadgeClass = "vl-badge--alert";
      metric4SubText = "总负债率偏高，警惕宏观加息周期与再融资偿债压力";
    } else {
      metric4Badge = "适度杠杆";
      metric4BadgeClass = "vl-badge--neutral";
      metric4SubText = "负债比例稳健适度，经营偿债风险可控";
    }
  }

  const safetyLabel = metric4SubText;

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

  const totalBuyback5Y =
    recentAnnuals.reduce((acc, a) => acc + (a.repurchaseAmt ?? 0), 0) || null;
  const totalBuyback5YUsd = totalBuyback5Y;
  const sym = currency === "USD" ? "$" : currency === "HKD" ? "HK$" : "¥";
  const buybackAmountLabel =
    totalBuyback5Y != null && totalBuyback5Y > 0
      ? `5年累计回购 ${sym}${formatUsdInYi(totalBuyback5Y)}`
      : null;

  let revenueCagr5Y: number | null = null;
  let revenueCagrLabel: string | null = null;
  let netIncomeCagr5Y: number | null = null;
  let netIncomeCagrLabel: string | null = null;

  if (recentAnnuals.length >= 2) {
    const firstA = recentAnnuals[0];
    const lastA = recentAnnuals[recentAnnuals.length - 1];
    const span = Math.max(1, lastA.year - firstA.year);

    if (firstA.revenue && lastA.revenue && firstA.revenue > 0 && lastA.revenue > 0) {
      revenueCagr5Y = Number((((lastA.revenue / firstA.revenue) ** (1 / span) - 1) * 100).toFixed(1));
      if (revenueCagr5Y < -20 && sectorModelType === "bank_insurance") {
        revenueCagrLabel = "会计准则口径调整 (IFRS 17)";
      }
    }

    if (firstA.netIncome != null && lastA.netIncome != null) {
      if (firstA.netIncome > 0 && lastA.netIncome > 0) {
        netIncomeCagr5Y = Number((((lastA.netIncome / firstA.netIncome) ** (1 / span) - 1) * 100).toFixed(1));
      } else if (firstA.netIncome <= 0 && lastA.netIncome > 0) {
        netIncomeCagrLabel = "扭亏为盈";
      } else if (firstA.netIncome > 0 && lastA.netIncome <= 0) {
        netIncomeCagrLabel = "由盈转亏";
      } else if (firstA.netIncome < 0 && lastA.netIncome < 0) {
        netIncomeCagrLabel = lastA.netIncome > firstA.netIncome ? "持续减亏" : "持续亏损";
      }
    }
  }

  const latestNetIncome = latestAnnual?.netIncome ?? null;
  const latestEquity = latestAnnual?.shareholdersEquity ?? null;
  const latestEps = latestAnnual?.eps ?? null;

  // Fallback to most recent known shares if latest annual has null shares
  const lastKnownShares =
    [...annuals].reverse().find((a) => a.shares != null && a.shares > 0)?.shares ?? null;
  const sharesOutstanding = latestAnnual?.shares ?? lastKnownShares;

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
  const canonicalLatestClose = primaryRows.length ? Number(primaryRows[primaryRows.length - 1].close) : null;

  // Find which security's price scale aligns with latestEps (e.g. for Berkshire, BRK-A aligns with 10-K EPS ~$46k)
  let epsAnchorPrice = canonicalLatestClose;
  if (latestEps != null && latestEps > 0 && validTickers.length > 1) {
    for (const t of validTickers) {
      const pRows = priceRowsByTicker.get(t) ?? [];
      const close = pRows.length ? Number(pRows[pRows.length - 1].close) : null;
      if (close != null && close > 0) {
        const testPe = close / latestEps;
        if (testPe >= 3 && testPe <= 150) {
          epsAnchorPrice = close;
          break;
        }
      }
    }
  }

  // Find price rows that align with the EPS anchor price for historical PE calculation
  let anchorRows = primaryRows;
  if (epsAnchorPrice != null) {
    const matchedTicker = validTickers.find((t) => {
      const p = priceRowsByTicker.get(t);
      const lastClose = p?.length ? Number(p[p.length - 1].close) : 0;
      return Math.abs(lastClose - epsAnchorPrice) < 1;
    });
    if (matchedTicker && priceRowsByTicker.has(matchedTicker)) {
      anchorRows = priceRowsByTicker.get(matchedTicker)!;
    }
  }

  // Calculate historical median PE across past fiscal years (no circular reasoning!)
  const historicalPes: number[] = [];
  for (const a of recentAnnuals) {
    if (a.eps != null && a.eps > 0) {
      const pNear = anchorRows.find((p) => p.date.toISOString().startsWith(`${a.year}`));
      if (pNear && Number(pNear.close) > 0) {
        const pe = Number(pNear.close) / a.eps;
        if (pe >= 6 && pe <= 60) {
          historicalPes.push(pe);
        }
      }
    }
  }

  let benchmarkPe = 18.0;
  if (historicalPes.length >= 2) {
    historicalPes.sort((a, b) => a - b);
    const mid = Math.floor(historicalPes.length / 2);
    const median =
      historicalPes.length % 2 === 0
        ? (historicalPes[mid - 1] + historicalPes[mid]) / 2
        : historicalPes[mid];
    benchmarkPe = Number(median.toFixed(1));
  } else if (roeAvg5Y != null && roeAvg5Y > 15) {
    benchmarkPe = 22.0;
  } else if (roeAvg5Y != null && roeAvg5Y < 8) {
    benchmarkPe = 14.0;
  }
  benchmarkPe = Math.max(10, Math.min(38, benchmarkPe));

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

    // Detect share class price scale relative to the EPS anchor price (e.g. BRK-B vs BRK-A)
    let secEps = latestEps;
    let secShares = sharesOutstanding;
    if (epsAnchorPrice != null && epsAnchorPrice > 0 && latestPrice != null && latestPrice > 0) {
      const priceScale = latestPrice / epsAnchorPrice;
      if (priceScale > 1.8 || priceScale < 0.55) {
        secEps = latestEps != null ? Number((latestEps * priceScale).toFixed(2)) : null;
        secShares = sharesOutstanding != null ? Math.round(sharesOutstanding / priceScale) : null;
      }
    }

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
      const rawEpsVal =
        epsByYear.get(clampedYear) ??
        epsByYear.get(maxAvailableYear) ??
        (latestPrice != null ? latestPrice / benchmarkPe : 1);
      
      const epsVal = secEps != null && latestEps != null && latestEps > 0
        ? rawEpsVal * (secEps / latestEps)
        : rawEpsVal;

      const val = Number((epsVal * benchmarkPe).toFixed(2));
      return {
        date: p.date,
        value: val,
      };
    });

    const marketCap =
      latestPrice != null && secShares != null && secShares > 0
        ? latestPrice * secShares
        : null;

    let peRatio: number | null = null;
    if (latestPrice != null && secEps != null && secEps > 0) {
      peRatio = Number((latestPrice / secEps).toFixed(1));
    } else if (marketCap != null && latestNetIncome != null && latestNetIncome > 0) {
      peRatio = Number((marketCap / latestNetIncome).toFixed(1));
    }
    if (peRatio != null && (peRatio <= 0 || peRatio > 1000)) {
      peRatio = null;
    }

    let pbRatio: number | null = null;
    if (marketCap != null && latestEquity != null && latestEquity > 0) {
      const rawPb = marketCap / latestEquity;
      if (rawPb > 0 && rawPb <= 500) {
        pbRatio = rawPb < 0.2 ? Number(rawPb.toFixed(2)) : Number(rawPb.toFixed(1));
      }
    }

    let valuationStatus: ValueLineData["valuationStatus"] = "insufficient";
    let valuationDiffPct: number | null = null;
    const latestValPoint = valueLinePoints[valueLinePoints.length - 1];

    if (
      latestPrice != null &&
      latestValPoint &&
      latestValPoint.value > 0 &&
      secEps != null &&
      secEps > 0 &&
      peRatio != null &&
      peRatio >= 2
    ) {
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

  // Cyclical Peak Alert Banner: warn against low PE trap at peak earnings
  let cyclicalWarning: ValueLineData["cyclicalWarning"] = null;
  if (
    sectorModelType === "cyclical" &&
    peRatio != null &&
    peRatio > 0 &&
    peRatio <= 9 &&
    ((roeAvg5Y != null && roeAvg5Y >= 18) || (latestAnnual?.netIncome != null && annuals.length >= 3))
  ) {
    cyclicalWarning = {
      title: "强周期景气高位预警",
      message: `该公司处于强周期资源/材料行业，当前看似极低的市盈率（${peRatio}x）常由大宗商品历史景气高峰驱动。周期股在盈利爆发期低 PE 往往预示景气见顶，下行期利润可能剧烈滑落，切忌机械当做击球区抄底。`,
    };
  }

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
  const topHolders = aggregatedHolders.slice(0, 6);

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
  const defaultMoat =
    sectorModelType === "bank_insurance"
      ? "稳固的特许经营牌照壁垒、低成本资金沉淀与风控承保能力"
      : sectorModelType === "utilities"
        ? "区域独占特许经营权、自然垄断与刚性抗周期护城河"
        : sectorModelType === "real_estate"
          ? "核心土储区位优势、稳健财务信用与高质交付运营能力"
          : sectorModelType === "cyclical"
            ? "核心资源区位禀赋、极低开采/冶炼边际成本曲线优势"
            : roeStability === "stellar"
              ? "长期卓越 ROE 构筑深厚经济特许权与稳定定价权"
              : "具备行业壁垒与客户转换成本优势";
  const aiMoat = coreMoatNote?.value ?? defaultMoat;

  const coreRiskNote = moatJson?.notes?.find(
    (n) => n.label.includes("最脆弱") || n.label.includes("风险") || n.enLabel === "Weakest Link"
  );
  const defaultRisk =
    sectorModelType === "bank_insurance"
      ? "需关注利差变动、信用资产质量及宏观流动性环境"
      : sectorModelType === "utilities"
        ? "需关注电价/公用事业费率核定、来水及燃料成本、大额资本开支周期"
        : sectorModelType === "real_estate"
          ? "需关注地产销售去化周期、再融资偿债压力及行业政策调控"
          : sectorModelType === "cyclical"
            ? "警惕大宗商品高位回落、行业产能过剩扩张及宏观需求下行冲击"
            : debtToAssetsRatio && debtToAssetsRatio > 65
              ? "总负债率偏高，需警惕再融资与宏观加息周期"
              : "需密切关注行业竞争格局重塑与再投资资本回报率";
  const aiRisk = coreRiskNote?.value ?? defaultRisk;

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

    sectorModelType,
    sectorModelLabel,
    cyclicalWarning,

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

    metric1Title,
    metric1Badge,
    metric1BadgeClass,
    metric1SubText,

    metric2Title,
    metric2Badge,
    metric2BadgeClass,
    metric2MainNum,
    metric2SubText,

    metric4Title,
    metric4Badge,
    metric4BadgeClass,
    metric4MainNum,
    metric4SubText,

    shareCountChangePct5Y,
    buybackLabel,
    totalBuyback5YUsd,
    totalBuyback5Y,
    buybackAmountLabel,
    safetyLabel,

    revenueCagr5Y,
    revenueCagrLabel,
    netIncomeCagr5Y,
    netIncomeCagrLabel,

    hasDeepDive,
    overview,
    businessSummary,
    businessSegments,
  };
}
