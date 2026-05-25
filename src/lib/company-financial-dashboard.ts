import { formatUsdInYi } from "@/lib/currency";

export type FinancialYearItems = {
  year: number;
  periodEnd: Date;
  items: Record<string, string>;
};

export type CompanyFinancialContext = {
  sector: string | null;
  metadata: unknown;
};

type FinancialTemplate = "general" | "financial";
type MetricKind = "money" | "percent" | "number";
type SourceType = "reported" | "derived" | "not_applicable" | "missing";

export type FinancialDashboardCard = {
  key: string;
  label: string;
  value: string;
  hint: string;
  sourceType: SourceType;
};

export type FinancialDashboardRow = {
  key: string;
  zhLabel: string;
  enLabel: string;
  sourceType: SourceType;
  values: Record<number, string>;
};

export type FinancialTrendSummary = {
  key: string;
  label: string;
  value: string;
  hint: string;
};

export type CompanyFinancialDashboard = {
  template: FinancialTemplate;
  templateLabel: string;
  latestYear: number | null;
  displayYears: number[];
  cards: FinancialDashboardCard[];
  rows: FinancialDashboardRow[];
  longTermTrends: FinancialTrendSummary[];
};

type MetricDef = {
  key: string;
  zhLabel: string;
  enLabel: string;
  kind: MetricKind;
  sourceType: SourceType;
  hint: string;
  compute: (year: number, ctx: MetricContext) => number | null;
};

type MetricContext = {
  financials: FinancialYearItems[];
  byYear: Map<number, FinancialYearItems>;
};

function normalizeMeta(metadata: unknown): Record<string, string | number | boolean | null> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  return metadata as Record<string, string | number | boolean | null>;
}

function num(items: Record<string, string> | null | undefined, key: string) {
  const raw = items?.[key];
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function value(ctx: MetricContext, year: number, key: string) {
  return num(ctx.byYear.get(year)?.items, key);
}

function ratio(numerator: number | null, denominator: number | null) {
  if (numerator == null || denominator == null || denominator === 0) return null;
  return numerator / denominator;
}

function growth(current: number | null, prior: number | null) {
  if (current == null || prior == null || prior === 0) return null;
  return current / prior - 1;
}

function cagr(end: number | null, start: number | null, years: number) {
  if (end == null || start == null || start <= 0 || years <= 0) return null;
  return Math.pow(end / start, 1 / years) - 1;
}

function averageWithPrior(ctx: MetricContext, year: number, key: string) {
  const current = value(ctx, year, key);
  const prior = value(ctx, year - 1, key);
  if (current == null || prior == null) return current;
  return (current + prior) / 2;
}

function formatPercent(v: number | null, digits = 1) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

function formatNumber(v: number | null) {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatMetricValue(value: number | null, kind: MetricKind) {
  if (kind === "money") return formatUsdInYi(value);
  if (kind === "percent") return formatPercent(value);
  return formatNumber(value);
}

function classifyFinancialTemplate(company: CompanyFinancialContext): FinancialTemplate {
  const meta = normalizeMeta(company.metadata);
  const sic = typeof meta.sic === "string" ? meta.sic : String(meta.sic ?? "");
  const sector = (company.sector ?? "").toLowerCase();
  const industry = typeof meta.industry === "string" ? meta.industry.toLowerCase() : "";

  if (/^60(1|2|3|6|9)/.test(sic) || industry.includes("bank")) return "financial";
  if (/^63/.test(sic) || industry.includes("insurance")) return "financial";
  if (sector.includes("financial")) return "financial";
  return "general";
}

function latestCagr(ctx: MetricContext, latestYear: number, key: string) {
  const latest = value(ctx, latestYear, key);
  const oldest = ctx.financials[4];
  if (!oldest) return null;
  return cagr(latest, value(ctx, oldest.year, key), latestYear - oldest.year);
}

const generalMetrics: MetricDef[] = [
  {
    key: "Revenue",
    zhLabel: "营收",
    enLabel: "Revenue",
    kind: "money",
    sourceType: "reported",
    hint: "Revenue",
    compute: (year, ctx) => value(ctx, year, "Revenue"),
  },
  {
    key: "RevenueYoY",
    zhLabel: "营收同比",
    enLabel: "Revenue YoY",
    kind: "percent",
    sourceType: "derived",
    hint: "Revenue vs prior FY",
    compute: (year, ctx) => growth(value(ctx, year, "Revenue"), value(ctx, year - 1, "Revenue")),
  },
  {
    key: "GrossMargin",
    zhLabel: "毛利率",
    enLabel: "Gross Margin",
    kind: "percent",
    sourceType: "derived",
    hint: "Gross Profit / Revenue",
    compute: (year, ctx) => ratio(value(ctx, year, "GrossProfit"), value(ctx, year, "Revenue")),
  },
  {
    key: "OperatingMargin",
    zhLabel: "营业利润率",
    enLabel: "Operating Margin",
    kind: "percent",
    sourceType: "derived",
    hint: "Operating Income / Revenue",
    compute: (year, ctx) => ratio(value(ctx, year, "OperatingIncome"), value(ctx, year, "Revenue")),
  },
  {
    key: "NetMargin",
    zhLabel: "净利率",
    enLabel: "Net Margin",
    kind: "percent",
    sourceType: "derived",
    hint: "Net Income / Revenue",
    compute: (year, ctx) => ratio(value(ctx, year, "NetIncome"), value(ctx, year, "Revenue")),
  },
  {
    key: "ROE",
    zhLabel: "ROE",
    enLabel: "Return on Equity",
    kind: "percent",
    sourceType: "derived",
    hint: "Net Income / Average Equity",
    compute: (year, ctx) => ratio(value(ctx, year, "NetIncome"), averageWithPrior(ctx, year, "ShareholdersEquity")),
  },
  {
    key: "OperatingCashFlow",
    zhLabel: "经营现金流净额",
    enLabel: "Operating Cash Flow",
    kind: "money",
    sourceType: "reported",
    hint: "Operating activities",
    compute: (year, ctx) => value(ctx, year, "OperatingCashFlow"),
  },
  {
    key: "DebtToAssets",
    zhLabel: "资产负债比",
    enLabel: "Liabilities / Assets",
    kind: "percent",
    sourceType: "derived",
    hint: "Total Liabilities / Total Assets",
    compute: (year, ctx) => ratio(value(ctx, year, "TotalLiabilities"), value(ctx, year, "TotalAssets")),
  },
];

const financialMetrics: MetricDef[] = [
  {
    key: "NetIncome",
    zhLabel: "净利润",
    enLabel: "Net Income",
    kind: "money",
    sourceType: "reported",
    hint: "Net Income",
    compute: (year, ctx) => value(ctx, year, "NetIncome"),
  },
  {
    key: "ROE",
    zhLabel: "ROE",
    enLabel: "Return on Equity",
    kind: "percent",
    sourceType: "derived",
    hint: "Net Income / Average Equity",
    compute: (year, ctx) => ratio(value(ctx, year, "NetIncome"), averageWithPrior(ctx, year, "ShareholdersEquity")),
  },
  {
    key: "ROA",
    zhLabel: "ROA",
    enLabel: "Return on Assets",
    kind: "percent",
    sourceType: "derived",
    hint: "Net Income / Average Assets",
    compute: (year, ctx) => ratio(value(ctx, year, "NetIncome"), averageWithPrior(ctx, year, "TotalAssets")),
  },
  {
    key: "DebtToAssets",
    zhLabel: "资产负债比",
    enLabel: "Liabilities / Assets",
    kind: "percent",
    sourceType: "derived",
    hint: "Total Liabilities / Total Assets",
    compute: (year, ctx) => ratio(value(ctx, year, "TotalLiabilities"), value(ctx, year, "TotalAssets")),
  },
  {
    key: "TotalAssets",
    zhLabel: "总资产",
    enLabel: "Total Assets",
    kind: "money",
    sourceType: "reported",
    hint: "Total Assets",
    compute: (year, ctx) => value(ctx, year, "TotalAssets"),
  },
  {
    key: "OperatingCashFlow",
    zhLabel: "经营现金流净额",
    enLabel: "Operating Cash Flow",
    kind: "money",
    sourceType: "reported",
    hint: "Operating activities",
    compute: (year, ctx) => value(ctx, year, "OperatingCashFlow"),
  },
  {
    key: "NetIncomeYoY",
    zhLabel: "净利润同比",
    enLabel: "Net Income YoY",
    kind: "percent",
    sourceType: "derived",
    hint: "Net Income vs prior FY",
    compute: (year, ctx) => growth(value(ctx, year, "NetIncome"), value(ctx, year - 1, "NetIncome")),
  },
  {
    key: "EPSDiluted",
    zhLabel: "摊薄EPS",
    enLabel: "Diluted EPS",
    kind: "number",
    sourceType: "reported",
    hint: "EPS Diluted",
    compute: (year, ctx) => value(ctx, year, "EPSDiluted"),
  },
];



function getMetrics(template: FinancialTemplate) {
  if (template === "financial") return financialMetrics;
  return generalMetrics;
}

function templateLabel(template: FinancialTemplate) {
  if (template === "financial") return "金融公司";
  return "通用公司";
}

function buildLongTermTrends(template: FinancialTemplate, latestYear: number | null, ctx: MetricContext): FinancialTrendSummary[] {
  if (!latestYear) return [];
  const oldest = ctx.financials[4];
  const horizon = oldest ? "近5年" : "长期";
  const trend = (key: string, label: string, lineItem: string): FinancialTrendSummary => ({
    key,
    label,
    value: formatPercent(latestCagr(ctx, latestYear, lineItem)),
    hint: oldest ? `FY ${oldest.year} → FY ${latestYear}` : "历史不足",
  });

  if (template === "financial") {
    return [
      trend("NetIncomeCagr", `${horizon}净利润CAGR`, "NetIncome"),
      trend("EPSCagr", `${horizon}摊薄EPS CAGR`, "EPSDiluted"),
      trend("AssetsCagr", `${horizon}总资产CAGR`, "TotalAssets"),
      trend("EquityCagr", `${horizon}股东权益CAGR`, "ShareholdersEquity"),
    ];
  }

  return [
    trend("RevenueCagr", `${horizon}营收CAGR`, "Revenue"),
    trend("OperatingIncomeCagr", `${horizon}营业利润CAGR`, "OperatingIncome"),
    trend("NetIncomeCagr", `${horizon}净利润CAGR`, "NetIncome"),
    trend("CashFlowCagr", `${horizon}经营现金流净额CAGR`, "OperatingCashFlow"),
  ];
}

export function buildCompanyFinancialDashboard(
  company: CompanyFinancialContext,
  financials: FinancialYearItems[],
): CompanyFinancialDashboard {
  const normalizedFinancials = [...financials].sort((a, b) => b.year - a.year).slice(0, 5);
  const byYear = new Map(normalizedFinancials.map((row) => [row.year, row]));
  const ctx: MetricContext = { financials: normalizedFinancials, byYear };
  const template = classifyFinancialTemplate(company);
  const metrics = getMetrics(template);
  const latestYear = normalizedFinancials[0]?.year ?? null;
  const displayYears = latestYear ? Array.from({ length: 5 }, (_, index) => latestYear - index) : [];

  const cards = latestYear
    ? metrics.map((metric) => ({
        key: metric.key,
        label: metric.zhLabel,
        value: formatMetricValue(metric.compute(latestYear, ctx), metric.kind),
        hint: metric.hint,
        sourceType: metric.sourceType,
      }))
    : metrics.map((metric) => ({
        key: metric.key,
        label: metric.zhLabel,
        value: "—",
        hint: metric.hint,
        sourceType: "missing" as const,
      }));

  const rows = metrics.map((metric) => ({
    key: metric.key,
    zhLabel: metric.zhLabel,
    enLabel: metric.enLabel,
    sourceType: metric.sourceType,
    values: Object.fromEntries(
      displayYears.map((year) => [year, formatMetricValue(metric.compute(year, ctx), metric.kind)]),
    ),
  }));

  return {
    template,
    templateLabel: templateLabel(template),
    latestYear,
    displayYears,
    cards,
    rows,
    longTermTrends: buildLongTermTrends(template, latestYear, ctx),
  };
}
