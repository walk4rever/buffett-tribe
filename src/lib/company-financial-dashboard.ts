import { formatMoneyInYi } from "@/lib/currency";
import {
  calculateFreeCashFlow,
  calculateReturnOnAverageBalance,
} from "@/lib/financial-math";
import { FINANCIAL_DATA_START_YEAR } from "@/lib/financial-period";
import { isSectorModelType13, type SectorModelType13 } from "@/lib/sector-classification";

export type FinancialYearItems = {
  year: number;
  periodEnd: Date;
  items: Record<string, string>;
};

export type CompanyFinancialContext = {
  sector: string | null;
  metadata: unknown;
  sectorModelType?: SectorModelType13 | null;
};

export type FinancialTemplate =
  | "operating"
  | "bank"
  | "insurance"
  | "capital_markets"
  | "real_estate"
  | "conglomerate";

type MetricKind = "money" | "percent" | "number" | "multiple";

export type FinancialDashboardRow = {
  key: string;
  zhLabel: string;
  enLabel: string;
  hint: string;
  kind: MetricKind;
  values: Record<number, string>;
};

export type FinancialDashboardTrend = {
  key: string;
  label: string;
  kind: MetricKind;
  points: Array<{ year: number; value: number | null; formatted: string }>;
  latestPoint: { year: number; value: number; formatted: string } | null;
};

export type CompanyFinancialDashboard = {
  template: FinancialTemplate;
  templateNote: string;
  latestYear: number | null;
  displayYears: number[];
  trendYears: number[];
  trends: FinancialDashboardTrend[];
  rows: FinancialDashboardRow[];
  currency: string | null;
};

type MetricDef = {
  key: string;
  zhLabel: string;
  enLabel: string;
  hint: string;
  kind: MetricKind;
  compute: (year: number, ctx: MetricContext) => number | null;
};

type MetricContext = {
  byYear: Map<number, FinancialYearItems>;
};

type TemplateProfile = {
  note: string;
  rowKeys: string[];
  trendKeys: string[];
};

function normalizeMeta(metadata: unknown): Record<string, string | number | boolean | null> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  return metadata as Record<string, string | number | boolean | null>;
}

function num(items: Record<string, string> | null | undefined, key: string) {
  const raw = items?.[key];
  if (raw == null || raw.trim() === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function value(ctx: MetricContext, year: number, key: string) {
  return num(ctx.byYear.get(year)?.items, key);
}

function ratio(numerator: number | null, denominator: number | null) {
  if (numerator == null || denominator == null || denominator === 0) return null;
  return numerator / denominator;
}

function ratioWithPositiveDenominator(numerator: number | null, denominator: number | null) {
  if (denominator == null || denominator <= 0) return null;
  return ratio(numerator, denominator);
}

function positiveBaseGrowth(ctx: MetricContext, year: number, key: string) {
  const current = value(ctx, year, key);
  const previous = value(ctx, year - 1, key);
  if (current == null || previous == null || previous <= 0) return null;
  return (current - previous) / previous;
}

function freeCashFlow(ctx: MetricContext, year: number) {
  return calculateFreeCashFlow(
    value(ctx, year, "OperatingCashFlow"),
    value(ctx, year, "CapEx"),
  );
}

function formatPercent(value: number | null, digits = 1) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

function formatNumber(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatMetricValue(value: number | null, kind: MetricKind, currency: string | null = null) {
  if (kind === "money") return formatMoneyInYi(value, currency);
  if (kind === "percent") return formatPercent(value);
  if (kind === "multiple") {
    return value == null || !Number.isFinite(value) ? "—" : `${formatNumber(value)}x`;
  }
  return formatNumber(value);
}

function classifyFinancialTemplate(company: CompanyFinancialContext): FinancialTemplate {
  const sectorModelType = company.sectorModelType;
  if (isSectorModelType13(sectorModelType)) {
    if (sectorModelType === "banks") return "bank";
    if (sectorModelType === "insurance") return "insurance";
    if (sectorModelType === "capital_markets") return "capital_markets";
    if (sectorModelType === "real_estate") return "real_estate";
    if (sectorModelType === "conglomerate") return "conglomerate";
    return "operating";
  }

  const meta = normalizeMeta(company.metadata);
  const sic = typeof meta.sic === "string" ? meta.sic : String(meta.sic ?? "");
  const sector = (company.sector ?? "").toLowerCase();
  const industry = typeof meta.industry === "string" ? meta.industry.toLowerCase() : "";

  if (/^60(1|2|3|6|9)/.test(sic) || industry.includes("bank")) return "bank";
  if (/^63/.test(sic) || industry.includes("insurance")) return "insurance";
  if (industry.includes("real estate") || industry.includes("房地产")) return "real_estate";
  if (industry.includes("conglomerate") || industry.includes("multi-sector") || industry.includes("控股")) {
    return "conglomerate";
  }
  if (/^62/.test(sic) || industry.includes("broker") || industry.includes("asset management")) {
    return "capital_markets";
  }
  if (sector.includes("financial")) return "capital_markets";
  return "operating";
}

const metrics: MetricDef[] = [
  {
    key: "Revenue",
    zhLabel: "营收",
    enLabel: "Revenue",
    hint: "年度营业收入",
    kind: "money",
    compute: (year, ctx) => value(ctx, year, "Revenue"),
  },
  {
    key: "RevenueGrowth",
    zhLabel: "营收同比",
    enLabel: "Revenue Growth",
    hint: "本年营收 / 上年营收 - 1；上年必须为正且为连续财年",
    kind: "percent",
    compute: (year, ctx) => positiveBaseGrowth(ctx, year, "Revenue"),
  },
  {
    key: "OperatingIncome",
    zhLabel: "营业利润",
    enLabel: "Operating Income",
    hint: "年度营业利润",
    kind: "money",
    compute: (year, ctx) => value(ctx, year, "OperatingIncome"),
  },
  {
    key: "NetIncome",
    zhLabel: "净利润",
    enLabel: "Net Income",
    hint: "年度净利润",
    kind: "money",
    compute: (year, ctx) => value(ctx, year, "NetIncome"),
  },
  {
    key: "NetIncomeGrowth",
    zhLabel: "净利润同比",
    enLabel: "Net Income Growth",
    hint: "本年净利润 / 上年净利润 - 1；上年必须为正且为连续财年",
    kind: "percent",
    compute: (year, ctx) => positiveBaseGrowth(ctx, year, "NetIncome"),
  },
  {
    key: "AssetGrowth",
    zhLabel: "总资产同比",
    enLabel: "Total Assets Growth",
    hint: "本年总资产 / 上年总资产 - 1；上年必须为正且为连续财年",
    kind: "percent",
    compute: (year, ctx) => positiveBaseGrowth(ctx, year, "TotalAssets"),
  },
  {
    key: "GrossMargin",
    zhLabel: "毛利率",
    enLabel: "Gross Margin",
    hint: "毛利润 / 营收",
    kind: "percent",
    compute: (year, ctx) => ratioWithPositiveDenominator(
      value(ctx, year, "GrossProfit"),
      value(ctx, year, "Revenue"),
    ),
  },
  {
    key: "OperatingMargin",
    zhLabel: "营业利润率",
    enLabel: "Operating Margin",
    hint: "营业利润 / 营收",
    kind: "percent",
    compute: (year, ctx) => ratioWithPositiveDenominator(
      value(ctx, year, "OperatingIncome"),
      value(ctx, year, "Revenue"),
    ),
  },
  {
    key: "NetMargin",
    zhLabel: "净利率",
    enLabel: "Net Margin",
    hint: "净利润 / 营收",
    kind: "percent",
    compute: (year, ctx) => ratioWithPositiveDenominator(
      value(ctx, year, "NetIncome"),
      value(ctx, year, "Revenue"),
    ),
  },
  {
    key: "ROE",
    zhLabel: "ROE",
    enLabel: "Return on Equity",
    hint: "净利润 / 期初期末平均股东权益",
    kind: "percent",
    compute: (year, ctx) => calculateReturnOnAverageBalance(
      value(ctx, year, "NetIncome"),
      value(ctx, year - 1, "ShareholdersEquity"),
      value(ctx, year, "ShareholdersEquity"),
    ),
  },
  {
    key: "ROA",
    zhLabel: "ROA",
    enLabel: "Return on Assets",
    hint: "净利润 / 期初期末平均总资产",
    kind: "percent",
    compute: (year, ctx) => calculateReturnOnAverageBalance(
      value(ctx, year, "NetIncome"),
      value(ctx, year - 1, "TotalAssets"),
      value(ctx, year, "TotalAssets"),
    ),
  },
  {
    key: "OperatingCashFlow",
    zhLabel: "经营现金流",
    enLabel: "Operating Cash Flow",
    hint: "经营活动产生的现金流量净额",
    kind: "money",
    compute: (year, ctx) => value(ctx, year, "OperatingCashFlow"),
  },
  {
    key: "CapEx",
    zhLabel: "资本支出",
    enLabel: "Capital Expenditures",
    hint: "资本性支出绝对值",
    kind: "money",
    compute: (year, ctx) => {
      const capEx = value(ctx, year, "CapEx");
      return capEx == null ? null : Math.abs(capEx);
    },
  },
  {
    key: "FreeCashFlow",
    zhLabel: "自由现金流",
    enLabel: "Free Cash Flow",
    hint: "经营现金流 - 资本支出",
    kind: "money",
    compute: (year, ctx) => freeCashFlow(ctx, year),
  },
  {
    key: "FCFMargin",
    zhLabel: "自由现金流率",
    enLabel: "FCF Margin",
    hint: "自由现金流 / 营收",
    kind: "percent",
    compute: (year, ctx) => {
      const revenue = value(ctx, year, "Revenue");
      if (revenue == null || revenue <= 0) return null;
      return ratio(freeCashFlow(ctx, year), revenue);
    },
  },
  {
    key: "CapExToRevenue",
    zhLabel: "资本开支率",
    enLabel: "CapEx / Revenue",
    hint: "资本支出绝对值 / 营收",
    kind: "percent",
    compute: (year, ctx) => {
      const revenue = value(ctx, year, "Revenue");
      const capEx = value(ctx, year, "CapEx");
      if (revenue == null || revenue <= 0 || capEx == null) return null;
      return Math.abs(capEx) / revenue;
    },
  },
  {
    key: "AssetTurnover",
    zhLabel: "总资产周转率",
    enLabel: "Asset Turnover",
    hint: "营收 / 期初期末平均总资产",
    kind: "multiple",
    compute: (year, ctx) => {
      const revenue = value(ctx, year, "Revenue");
      const openingAssets = value(ctx, year - 1, "TotalAssets");
      const closingAssets = value(ctx, year, "TotalAssets");
      if (revenue == null || openingAssets == null || closingAssets == null) return null;
      const averageAssets = (openingAssets + closingAssets) / 2;
      if (averageAssets <= 0) return null;
      return revenue / averageAssets;
    },
  },
  {
    key: "CashConversion",
    zhLabel: "现金转化率",
    enLabel: "Cash Conversion",
    hint: "经营现金流 / 正值净利润",
    kind: "percent",
    compute: (year, ctx) => {
      const netIncome = value(ctx, year, "NetIncome");
      if (netIncome == null || netIncome <= 0) return null;
      return ratio(value(ctx, year, "OperatingCashFlow"), netIncome);
    },
  },
  {
    key: "LiabilitiesToAssets",
    zhLabel: "负债 / 资产",
    enLabel: "Liabilities / Assets",
    hint: "总负债 / 总资产",
    kind: "percent",
    compute: (year, ctx) => ratioWithPositiveDenominator(
      value(ctx, year, "TotalLiabilities"),
      value(ctx, year, "TotalAssets"),
    ),
  },
  {
    key: "EquityToAssets",
    zhLabel: "权益 / 资产",
    enLabel: "Equity / Assets",
    hint: "股东权益 / 总资产；账面比例，不等同于监管资本充足率",
    kind: "percent",
    compute: (year, ctx) => ratioWithPositiveDenominator(
      value(ctx, year, "ShareholdersEquity"),
      value(ctx, year, "TotalAssets"),
    ),
  },
  {
    key: "TotalAssets",
    zhLabel: "总资产",
    enLabel: "Total Assets",
    hint: "财年末资产总额",
    kind: "money",
    compute: (year, ctx) => value(ctx, year, "TotalAssets"),
  },
  {
    key: "TotalLiabilities",
    zhLabel: "总负债",
    enLabel: "Total Liabilities",
    hint: "财年末负债总额",
    kind: "money",
    compute: (year, ctx) => value(ctx, year, "TotalLiabilities"),
  },
  {
    key: "ShareholdersEquity",
    zhLabel: "股东权益",
    enLabel: "Shareholders' Equity",
    hint: "财年末股东权益",
    kind: "money",
    compute: (year, ctx) => value(ctx, year, "ShareholdersEquity"),
  },
  {
    key: "EPSDiluted",
    zhLabel: "摊薄 EPS",
    enLabel: "Diluted EPS",
    hint: "摊薄每股收益",
    kind: "number",
    compute: (year, ctx) => value(ctx, year, "EPSDiluted"),
  },
];

const operatingKeys = [
  "Revenue",
  "RevenueGrowth",
  "NetIncome",
  "NetIncomeGrowth",
  "GrossMargin",
  "OperatingMargin",
  "NetMargin",
  "ROE",
  "OperatingCashFlow",
  "CapEx",
  "FreeCashFlow",
  "FCFMargin",
  "CashConversion",
  "CapExToRevenue",
  "AssetTurnover",
  "LiabilitiesToAssets",
];

const profiles: Record<FinancialTemplate, TemplateProfile> = {
  operating: {
    note: "同比仅在上年为正且连续时计算；ROE按平均权益；FCF = OCF − |CapEx|。",
    rowKeys: operatingKeys,
    trendKeys: [
      "RevenueGrowth",
      "NetIncomeGrowth",
      "GrossMargin",
      "OperatingMargin",
      "ROE",
      "FCFMargin",
      "CashConversion",
    ],
  },
  bank: {
    note: "ROE/ROA按平均余额；净息差与资产质量未接入；权益/资产为账面比率，非 CET1；负债含客户存款。",
    rowKeys: [
      "NetIncome",
      "NetIncomeGrowth",
      "EPSDiluted",
      "ROE",
      "ROA",
      "TotalAssets",
      "AssetGrowth",
      "TotalLiabilities",
      "ShareholdersEquity",
      "EquityToAssets",
    ],
    trendKeys: ["NetIncomeGrowth", "EPSDiluted", "ROE", "ROA", "AssetGrowth", "EquityToAssets"],
  },
  insurance: {
    note: "ROE/ROA按平均余额；保费增长、综合成本率与偿付能力未接入；权益/资产非偿付能力指标。",
    rowKeys: [
      "NetIncome",
      "NetIncomeGrowth",
      "EPSDiluted",
      "ROE",
      "ROA",
      "TotalAssets",
      "AssetGrowth",
      "TotalLiabilities",
      "ShareholdersEquity",
      "EquityToAssets",
    ],
    trendKeys: ["NetIncomeGrowth", "EPSDiluted", "ROE", "ROA", "AssetGrowth", "EquityToAssets"],
  },
  capital_markets: {
    note: "AUM与净流入未接入；FCF = OCF − |CapEx|；现金流受交易结算时点影响。",
    rowKeys: [
      "Revenue",
      "RevenueGrowth",
      "NetIncome",
      "NetIncomeGrowth",
      "NetMargin",
      "EPSDiluted",
      "ROE",
      "OperatingCashFlow",
      "CapEx",
      "FreeCashFlow",
      "FCFMargin",
      "CashConversion",
    ],
    trendKeys: [
      "RevenueGrowth",
      "NetIncomeGrowth",
      "NetMargin",
      "ROE",
      "FCFMargin",
      "CashConversion",
    ],
  },
  real_estate: {
    note: "FFO/AFFO 与 NAV 未接入，不以净利润替代；FCF = OCF − |CapEx|。",
    rowKeys: [
      "Revenue",
      "RevenueGrowth",
      "NetIncome",
      "OperatingCashFlow",
      "CapEx",
      "FreeCashFlow",
      "FCFMargin",
      "CapExToRevenue",
      "TotalAssets",
      "TotalLiabilities",
      "ShareholdersEquity",
      "LiabilitiesToAssets",
    ],
    trendKeys: [
      "RevenueGrowth",
      "FreeCashFlow",
      "FCFMargin",
      "CapExToRevenue",
      "LiabilitiesToAssets",
    ],
  },
  conglomerate: {
    note: "按合并报表计算，未拆分业务分部；FCF = OCF − |CapEx|。",
    rowKeys: [
      "Revenue",
      "RevenueGrowth",
      "OperatingIncome",
      "OperatingMargin",
      "NetIncome",
      "NetIncomeGrowth",
      "ROE",
      "OperatingCashFlow",
      "CapEx",
      "FreeCashFlow",
      "FCFMargin",
      "CashConversion",
      "LiabilitiesToAssets",
    ],
    trendKeys: [
      "RevenueGrowth",
      "OperatingMargin",
      "NetIncomeGrowth",
      "CashConversion",
      "FCFMargin",
      "ROE",
    ],
  },
};

function getMetric(key: string) {
  return metrics.find((metric) => metric.key === key);
}

function uniqueByYear(financials: FinancialYearItems[]) {
  const newestByYear = new Map<number, FinancialYearItems>();
  const eligibleFinancials = financials.filter((row) => row.year >= FINANCIAL_DATA_START_YEAR);
  for (const row of [...eligibleFinancials].sort((a, b) => b.periodEnd.getTime() - a.periodEnd.getTime())) {
    if (!newestByYear.has(row.year)) newestByYear.set(row.year, row);
  }
  return [...newestByYear.values()].sort((a, b) => b.year - a.year).slice(0, 10);
}

export function buildCompanyFinancialDashboard(
  company: CompanyFinancialContext,
  financials: FinancialYearItems[],
  currency: string | null = null,
): CompanyFinancialDashboard {
  const normalizedFinancials = uniqueByYear(financials);
  const trendYears = normalizedFinancials.map((row) => row.year).sort((a, b) => a - b);
  const displayYears = normalizedFinancials.slice(0, 5).map((row) => row.year);
  const byYear = new Map(normalizedFinancials.map((row) => [row.year, row]));
  const ctx: MetricContext = { byYear };
  const template = classifyFinancialTemplate(company);
  const profile = profiles[template];
  const latestYear = normalizedFinancials[0]?.year ?? null;

  const rows = profile.rowKeys.flatMap((key) => {
    const metric = getMetric(key);
    if (!metric) return [];

    const rawValues = displayYears.map((year) => [year, metric.compute(year, ctx)] as const);
    if (rawValues.every(([, metricValue]) => metricValue == null)) return [];

    return [{
      key: metric.key,
      zhLabel: metric.zhLabel,
      enLabel: metric.enLabel,
      hint: metric.hint,
      kind: metric.kind,
      values: Object.fromEntries(
        rawValues.map(([year, metricValue]) => [
          year,
          formatMetricValue(metricValue, metric.kind, currency),
        ]),
      ),
    }];
  });

  const trends = profile.trendKeys.flatMap((key) => {
    const metric = getMetric(key);
    if (!metric) return [];

    const points = trendYears.map((year) => {
      const metricValue = metric.compute(year, ctx);
      return {
        year,
        value: metricValue,
        formatted: formatMetricValue(metricValue, metric.kind, currency),
      };
    });
    if (points.every((point) => point.value == null)) return [];

    const latestPoint = [...points].reverse().find(
      (point): point is typeof point & { value: number } => point.value != null,
    );

    return [{
      key: metric.key,
      label: metric.zhLabel,
      kind: metric.kind,
      points,
      latestPoint: latestPoint
        ? { year: latestPoint.year, value: latestPoint.value, formatted: latestPoint.formatted }
        : null,
    }];
  });

  return {
    template,
    templateNote: profile.note,
    latestYear,
    displayYears,
    trendYears,
    trends,
    rows,
    currency,
  };
}
