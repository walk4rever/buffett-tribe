import { formatMoneyInYi } from "@/lib/currency";
import {
  calculateFreeCashFlow,
  calculateInvestedCapital,
  calculateReturnOnAverageBalance,
  calculateROIC,
} from "@/lib/financial-math";
import { FINANCIAL_DATA_START_YEAR } from "@/lib/financial-period";
import {
  extractCurrencyCode,
} from "@/lib/fx-rates-core";
import { normalizeFinancialItems } from "@/lib/financial-normalization";
import type { SectorModelType13 } from "@/lib/sector-classification";
import {
  getDefaultFinancialModel,
  resolveFinancialModel,
  type FinancialModelModifier,
  type FinancialModelResolution,
  type FinancialTemplate,
} from "@/lib/financial-model";

export type { FinancialTemplate } from "@/lib/financial-model";

export type FinancialYearItems = {
  year: number;
  periodEnd: Date;
  items: Record<string, string>;
  itemUnits?: Record<string, string | null | undefined>;
};

export type FinancialDashboardCurrencyContext = {
  reportingCurrency: string | null;
  tradingCurrency: string | null;
  fxRates: ReadonlyMap<string, number>;
};

export type CompanyFinancialContext = {
  sector: string | null;
  metadata: unknown;
  sectorModelType?: SectorModelType13 | null;
};

type MetricKind = "money" | "percent" | "number" | "multiple";

export type FinancialDashboardInterimColumn = {
  year: number;
  periodType: string;
  periodEnd: Date;
  label: string;
};

export type FinancialDashboardRow = {
  key: string;
  zhLabel: string;
  enLabel: string;
  hint: string;
  kind: MetricKind;
  values: Record<number, string>;
  rawValues: Record<number, number | null>;
  interimValue?: string;
  interimRawValue?: number | null;
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
  financialModel: FinancialModelResolution;
  templateNote: string;
  latestYear: number | null;
  displayYears: number[];
  trendYears: number[];
  trends: FinancialDashboardTrend[];
  rows: FinancialDashboardRow[];
  currency: string | null;
  latestInterim?: FinancialDashboardInterimColumn | null;
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
    key: "ShareRepurchaseAmt",
    zhLabel: "股票回购",
    enLabel: "Share Repurchases",
    hint: "回购普通股支付的现金支出",
    kind: "money",
    compute: (year, ctx) => {
      const rep =
        value(ctx, year, "ShareRepurchaseAmt") ??
        value(ctx, year, "PaymentsForRepurchaseOfCommonStock");
      return rep == null ? null : Math.abs(rep);
    },
  },
  {
    key: "DividendsPaid",
    zhLabel: "现金分红",
    enLabel: "Cash Dividends Paid",
    hint: "分配股利支付的现金支出",
    kind: "money",
    compute: (year, ctx) => {
      const div = value(ctx, year, "DividendsPaid");
      return div == null ? null : Math.abs(div);
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
    zhLabel: "账面权益资产比",
    enLabel: "Book Equity / Assets",
    hint: "股东权益 / 总资产；账面比例，不等同于监管资本充足率 (CET1)",
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
  {
    key: "CostOfRevenue",
    zhLabel: "营业成本",
    enLabel: "Cost of Revenue",
    hint: "主营业务与销售成本",
    kind: "money",
    compute: (year, ctx) => value(ctx, year, "CostOfRevenue"),
  },
  {
    key: "CashAndCashEquivalents",
    zhLabel: "现金及等价物",
    enLabel: "Cash & Equivalents",
    hint: "期末现金及现金等价物余额",
    kind: "money",
    compute: (year, ctx) => value(ctx, year, "CashAndCashEquivalents"),
  },
  {
    key: "NetInterestIncome",
    zhLabel: "净利息收入",
    enLabel: "Net Interest Income",
    hint: "利息收入扣除利息支出的净额",
    kind: "money",
    compute: (year, ctx) => value(ctx, year, "NetInterestIncome"),
  },
  {
    key: "NonInterestIncome",
    zhLabel: "非利息收入",
    enLabel: "Non-Interest Income",
    hint: "手续费、佣金及投资收益等非利息营业收入",
    kind: "money",
    compute: (year, ctx) => value(ctx, year, "NonInterestIncome"),
  },
  {
    key: "NetFeeAndCommissionIncome",
    zhLabel: "手续费及佣金净收入",
    enLabel: "Net Fee and Commission Income",
    hint: "财报披露的手续费及佣金净收入",
    kind: "money",
    compute: (year, ctx) => value(ctx, year, "NetFeeAndCommissionIncome"),
  },
  {
    key: "InvestmentManagementFeeIncome",
    zhLabel: "资产管理费收入",
    enLabel: "Investment Management Fee Income",
    hint: "财报披露的资产管理业务费收入，不由 AUM 或总营收估算",
    kind: "money",
    compute: (year, ctx) => value(ctx, year, "InvestmentManagementFeeIncome"),
  },
  {
    key: "AssetsUnderManagement",
    zhLabel: "管理资产规模",
    enLabel: "Assets Under Management",
    hint: "期末客户管理资产，不包含仅提供投资建议的资产",
    kind: "money",
    compute: (year, ctx) => value(ctx, year, "AssetsUnderManagement"),
  },
  {
    key: "NetClientFlows",
    zhLabel: "客户资产净流量",
    enLabel: "Net Client Flows",
    hint: "报告期客户净申购流量，不由 AUM 变动推算",
    kind: "money",
    compute: (year, ctx) => value(ctx, year, "NetClientFlows"),
  },
  {
    key: "NetLoans",
    zhLabel: "贷款净额",
    enLabel: "Net Loans",
    hint: "发放贷款及垫款净额（扣除减值准备）",
    kind: "money",
    compute: (year, ctx) => value(ctx, year, "NetLoans"),
  },
  {
    key: "TotalDeposits",
    zhLabel: "客户存款",
    enLabel: "Total Deposits",
    hint: "吸收客户存款总额",
    kind: "money",
    compute: (year, ctx) => value(ctx, year, "TotalDeposits"),
  },
  {
    key: "NetPremiumsEarned",
    zhLabel: "净已赚保费",
    enLabel: "Net Premiums Earned",
    hint: "已赚保费扣除分出保费后的金额",
    kind: "money",
    compute: (year, ctx) => value(ctx, year, "NetPremiumsEarned"),
  },
  {
    key: "PolicyClaimsAndBenefits",
    zhLabel: "赔付及保单利益",
    enLabel: "Claims and Benefits",
    hint: "保险赔付、保单利益及相关损失",
    kind: "money",
    compute: (year, ctx) => value(ctx, year, "PolicyClaimsAndBenefits"),
  },
  {
    key: "ClaimsRatio",
    zhLabel: "赔付率",
    enLabel: "Claims Ratio",
    hint: "赔付及保单利益绝对值 / 净已赚保费",
    kind: "percent",
    compute: (year, ctx) => {
      const premiums = value(ctx, year, "NetPremiumsEarned");
      const claims = value(ctx, year, "PolicyClaimsAndBenefits");
      if (premiums == null || premiums <= 0 || claims == null) return null;
      return Math.abs(claims) / premiums;
    },
  },
  {
    key: "ContractLiabilities",
    zhLabel: "合同负债 / 预收款",
    enLabel: "Contract Liabilities",
    hint: "预售房款与客户合同负债",
    kind: "money",
    compute: (year, ctx) => value(ctx, year, "ContractLiabilities"),
  },
  {
    key: "InvestmentProperty",
    zhLabel: "投资性物业",
    enLabel: "Investment Property",
    hint: "为赚取租金或资本增值而持有的物业资产",
    kind: "money",
    compute: (year, ctx) => value(ctx, year, "InvestmentProperty"),
  },
  {
    key: "Inventory",
    zhLabel: "存货 / 开发成本",
    enLabel: "Inventory",
    hint: "存货总额（含拟开发土地与在建开发成本）",
    kind: "money",
    compute: (year, ctx) => value(ctx, year, "Inventory"),
  },
  {
    key: "ROIC",
    zhLabel: "ROIC",
    enLabel: "Return on Invested Capital",
    hint: "NOPAT / 期初期末平均投入资本；投入资本 ≤ 0 时保护为 N/A",
    kind: "percent",
    compute: (year, ctx) => {
      const opInc = value(ctx, year, "OperatingIncome");
      const tax = value(ctx, year, "IncomeTaxExpense");
      const ebt = value(ctx, year, "TotalProfit") ?? value(ctx, year, "PretaxIncome");
      const effectiveTaxRate = tax != null && ebt != null && ebt > 0 ? tax / ebt : null;
      const currentIC = calculateInvestedCapital({
        totalEquity: value(ctx, year, "ShareholdersEquity") ?? value(ctx, year, "TotalEquity"),
        totalDebt: value(ctx, year, "TotalDebt"),
        shortTermDebt: value(ctx, year, "ShortTermDebt"),
        longTermDebt: value(ctx, year, "LongTermDebt"),
        cashAndEquivalents: value(ctx, year, "CashAndCashEquivalents"),
      });
      const prevIC = calculateInvestedCapital({
        totalEquity: value(ctx, year - 1, "ShareholdersEquity") ?? value(ctx, year - 1, "TotalEquity"),
        totalDebt: value(ctx, year - 1, "TotalDebt"),
        shortTermDebt: value(ctx, year - 1, "ShortTermDebt"),
        longTermDebt: value(ctx, year - 1, "LongTermDebt"),
        cashAndEquivalents: value(ctx, year - 1, "CashAndCashEquivalents"),
      });
      return calculateROIC({
        operatingIncome: opInc,
        effectiveTaxRate,
        currentInvestedCapital: currentIC,
        previousInvestedCapital: prevIC,
      });
    },
  },
  {
    key: "ProvisionForCreditLosses",
    zhLabel: "信用减值损失",
    enLabel: "Provision for Credit Losses",
    hint: "贷款及金融资产减值损失计提（拨备支出）",
    kind: "money",
    compute: (year, ctx) => {
      const prov = value(ctx, year, "ProvisionForCreditLosses");
      return prov == null ? null : Math.abs(prov);
    },
  },
  {
    key: "TotalInvestments",
    zhLabel: "投资资产组合",
    enLabel: "Total Investments",
    hint: "持有至到期、交易性金融资产与长期股权投资总额",
    kind: "money",
    compute: (year, ctx) => value(ctx, year, "TotalInvestments"),
  },
  {
    key: "InvestmentIncome",
    zhLabel: "投资收益",
    enLabel: "Investment Income",
    hint: "利息、股息收益及金融工具公允价值变动损益",
    kind: "money",
    compute: (year, ctx) =>
      value(ctx, year, "InvestmentIncome") ?? value(ctx, year, "NetInvestmentIncome"),
  },
  {
    key: "InsuranceContractLiabilities",
    zhLabel: "保单准备金负债",
    enLabel: "Insurance Contract Liabilities",
    hint: "未到期责任准备金与寿险/长期健康险责任准备金（核心浮存金池）",
    kind: "money",
    compute: (year, ctx) => value(ctx, year, "InsuranceContractLiabilities"),
  },
  {
    key: "RnDExpense",
    zhLabel: "研发费用",
    enLabel: "R&D Expense",
    hint: "年度研发投入支出",
    kind: "money",
    compute: (year, ctx) => {
      const rnd =
        value(ctx, year, "RnDExpense") ??
        value(ctx, year, "ResearchAndDevelopmentExpense");
      return rnd == null ? null : Math.abs(rnd);
    },
  },
  {
    key: "RnDToRevenue",
    zhLabel: "研发费用率",
    enLabel: "R&D / Revenue",
    hint: "研发费用 / 营收",
    kind: "percent",
    compute: (year, ctx) => {
      const revenue = value(ctx, year, "Revenue");
      const rnd =
        value(ctx, year, "RnDExpense") ??
        value(ctx, year, "ResearchAndDevelopmentExpense");
      if (revenue == null || revenue <= 0 || rnd == null) return null;
      return Math.abs(rnd) / revenue;
    },
  },
  {
    key: "NetDebtRatio",
    zhLabel: "净负债率",
    enLabel: "Net Debt Ratio",
    hint: "(有息负债 - 货币资金) / 净资产；衡量杠杆与偿债安全边际",
    kind: "percent",
    compute: (year, ctx) => {
      const equity =
        value(ctx, year, "ShareholdersEquity") ??
        value(ctx, year, "TotalEquity") ??
        value(ctx, year, "TotalStockholdersEquity");
      if (equity == null || equity <= 0) return null;
      const cash = value(ctx, year, "CashAndCashEquivalents") ?? 0;
      const shortDebt = value(ctx, year, "ShortTermDebt") ?? 0;
      const longDebt = value(ctx, year, "LongTermDebt") ?? 0;
      const totalDebt =
        value(ctx, year, "TotalDebt") ?? (shortDebt + longDebt > 0 ? shortDebt + longDebt : null);
      if (totalDebt == null) return null;
      return (totalDebt - cash) / equity;
    },
  },
];

const operatingKeys = [
  "Revenue",
  "RevenueGrowth",
  "CostOfRevenue",
  "OperatingIncome",
  "OperatingMargin",
  "NetIncome",
  "NetIncomeGrowth",
  "GrossMargin",
  "NetMargin",
  "ROE",
  "OperatingCashFlow",
  "CapEx",
  "FreeCashFlow",
  "FCFMargin",
  "RnDExpense",
  "RnDToRevenue",
  "ContractLiabilities",
  "Inventory",
  "CashAndCashEquivalents",
  "ShareRepurchaseAmt",
  "DividendsPaid",
  "CashConversion",
  "CapExToRevenue",
  "AssetTurnover",
  "LiabilitiesToAssets",
];

const profiles: Record<FinancialTemplate, TemplateProfile> = {
  industrial: {
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
    note: "ROE/ROA按平均余额计算；权益/资产为账面比例（非监管 CET1 资本充足率）；负债主要由客户存款构成；营收由净利息与非利息收入驱动；贷款与存款反映信贷资产负债结构。",
    rowKeys: [
      "Revenue",
      "NetInterestIncome",
      "NonInterestIncome",
      "NetFeeAndCommissionIncome",
      "ProvisionForCreditLosses",
      "InvestmentIncome",
      "NetIncome",
      "NetIncomeGrowth",
      "EPSDiluted",
      "ROE",
      "ROA",
      "NetLoans",
      "TotalDeposits",
      "TotalAssets",
      "AssetGrowth",
      "TotalLiabilities",
      "ShareholdersEquity",
      "EquityToAssets",
      "DividendsPaid",
      "ShareRepurchaseAmt",
    ],
    trendKeys: ["NetIncomeGrowth", "EPSDiluted", "ROE", "ROA", "AssetGrowth", "EquityToAssets"],
  },
  insurance: {
    note: "ROE/ROA按平均余额计算；净已赚保费反映承保规模；浮存金与投资收益反映投资端运作与资产负债久期匹配。",
    rowKeys: [
      "NetPremiumsEarned",
      "PolicyClaimsAndBenefits",
      "ClaimsRatio",
      "InvestmentIncome",
      "NetIncome",
      "NetIncomeGrowth",
      "EPSDiluted",
      "ROE",
      "ROA",
      "TotalInvestments",
      "InsuranceContractLiabilities",
      "TotalAssets",
      "AssetGrowth",
      "TotalLiabilities",
      "ShareholdersEquity",
      "EquityToAssets",
      "DividendsPaid",
      "ShareRepurchaseAmt",
    ],
    trendKeys: ["ClaimsRatio", "NetIncomeGrowth", "EPSDiluted", "ROE", "ROA", "AssetGrowth", "EquityToAssets"],
  },
  financial_services: {
    note: "",
    rowKeys: [
      "Revenue",
      "RevenueGrowth",
      "AssetsUnderManagement",
      "NetClientFlows",
      "InvestmentManagementFeeIncome",
      "NetFeeAndCommissionIncome",
      "InvestmentIncome",
      "NetIncome",
      "NetIncomeGrowth",
      "NetMargin",
      "EPSDiluted",
      "ROE",
      "TotalInvestments",
      "TotalAssets",
      "TotalLiabilities",
      "ShareholdersEquity",
      "EquityToAssets",
      "DividendsPaid",
      "ShareRepurchaseAmt",
    ],
    trendKeys: [
      "RevenueGrowth",
      "AssetsUnderManagement",
      "NetClientFlows",
      "InvestmentManagementFeeIncome",
      "NetFeeAndCommissionIncome",
      "NetIncomeGrowth",
      "NetMargin",
      "ROE",
      "EquityToAssets",
    ],
  },
  real_estate: {
    note: "房地产与 REITs：持有型物业核心关注物业租金回报、资产净值与分红；开发商模式重点关注预售合同负债、存货储备与净负债率。",
    rowKeys: [
      "Revenue",
      "RevenueGrowth",
      "OperatingIncome",
      "OperatingMargin",
      "NetIncome",
      "NetIncomeGrowth",
      "ROE",
      "OperatingCashFlow",
      "ContractLiabilities",
      "InvestmentProperty",
      "Inventory",
      "TotalAssets",
      "TotalLiabilities",
      "LiabilitiesToAssets",
      "NetDebtRatio",
      "ShareholdersEquity",
      "DividendsPaid",
      "ShareRepurchaseAmt",
    ],
    trendKeys: [
      "RevenueGrowth",
      "NetIncomeGrowth",
      "ROE",
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
      "TotalInvestments",
      "InvestmentIncome",
      "InsuranceContractLiabilities",
      "TotalAssets",
      "TotalLiabilities",
      "LiabilitiesToAssets",
      "ShareholdersEquity",
      "DividendsPaid",
      "ShareRepurchaseAmt",
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

type ModifierProfile = {
  note: string;
  rowKeys?: string[];
  trendKeys?: string[];
};

const modifierProfiles: Partial<Record<FinancialModelModifier, ModifierProfile>> = {
  consumer_brand: {
    note: "行业观察：关注定价权、毛利率与需求韧性。",
  },
  healthcare: {
    note: "行业观察：研发投入、管线与专利周期会影响利润可比性。",
  },
  software_platform: {
    note: "行业观察：成熟盈利与早期增长阶段的估值口径不同。",
  },
  semiconductor_hardware: {
    note: "行业观察：需结合产能利用率与行业周期解读当期盈利。",
  },
  energy_materials: {
    note: "行业观察：利润与现金流受商品价格影响，单年表现不代表周期中枢。",
  },
  utilities: {
    note: "行业观察：关注监管资产基数、准许回报率与长期现金分红稳定性。",
  },
  telecommunications: {
    note: "行业观察：关注用户规模、网络基础设施资本开支强度与自由现金流转化率。",
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

function normalizeFinancialYears(
  financials: FinancialYearItems[],
  currencyContext: FinancialDashboardCurrencyContext | undefined,
) {
  if (!currencyContext) return financials;

  const knownItemCurrencies = new Set<string>();
  for (const financial of financials) {
    for (const unit of Object.values(financial.itemUnits ?? {})) {
      const currencyCode = extractCurrencyCode(unit);
      if (currencyCode) knownItemCurrencies.add(currencyCode);
    }
  }
  if (currencyContext.reportingCurrency) {
    knownItemCurrencies.add(currencyContext.reportingCurrency);
  }

  const normalizedLineItems = new Set(
    metrics
      .filter((metric) => metric.kind === "money" || metric.key === "EPSDiluted")
      .map((metric) => metric.key),
  );

  return financials.map((financial) => {
    const values = Object.fromEntries(
      [...normalizedLineItems].map((lineItem) => [
        lineItem,
        num(financial.items, lineItem),
      ]),
    );
    const normalizedValues = normalizeFinancialItems(
      values,
      financial.itemUnits ?? {},
      { ...currencyContext, knownItemCurrencies },
    );
    const items = { ...financial.items };

    for (const [lineItem, value] of Object.entries(normalizedValues)) {
      if (value == null) {
        delete items[lineItem];
      } else {
        items[lineItem] = String(value);
      }
    }

    return { ...financial, items };
  });
}

const ANNUAL_ONLY_METRIC_KEYS = new Set([
  "RevenueGrowth",
  "NetIncomeGrowth",
  "AssetGrowth",
  "ROE",
  "ROA",
  "ROIC",
  "AssetTurnover",
]);

export function buildCompanyFinancialDashboard(
  company: CompanyFinancialContext,
  financials: FinancialYearItems[],
  currency: string | null = null,
  currencyContext?: FinancialDashboardCurrencyContext,
  latestInterim?: {
    year?: number;
    periodType: string;
    periodEnd: Date;
    items: Record<string, string>;
    itemUnits?: Record<string, string | null | undefined>;
  } | null,
): CompanyFinancialDashboard {
  const normalizedFinancials = uniqueByYear(
    normalizeFinancialYears(financials, currencyContext),
  );
  const trendYears = normalizedFinancials.map((row) => row.year).sort((a, b) => a - b);
  const displayYears = normalizedFinancials.slice(0, 5).map((row) => row.year);
  const byYear = new Map(normalizedFinancials.map((row) => [row.year, row]));
  const ctx: MetricContext = { byYear };

  let interimColumn: FinancialDashboardInterimColumn | null = null;
  let interimCtx: MetricContext | null = null;
  const INTERIM_SYNTHETIC_YEAR = 9999;

  if (latestInterim && Object.keys(latestInterim.items).length > 0) {
    const interimYear = latestInterim.year ?? latestInterim.periodEnd.getUTCFullYear();
    const [normalizedInterim] = normalizeFinancialYears(
      [
        {
          year: interimYear,
          periodEnd: latestInterim.periodEnd,
          items: latestInterim.items,
          itemUnits: latestInterim.itemUnits,
        },
      ],
      currencyContext,
    );
    if (normalizedInterim) {
      interimColumn = {
        year: interimYear,
        periodType: latestInterim.periodType,
        periodEnd: latestInterim.periodEnd,
        label: `${interimYear} ${latestInterim.periodType} (YTD)`,
      };
      const mapWithInterim = new Map(byYear);
      mapWithInterim.set(INTERIM_SYNTHETIC_YEAR, {
        ...normalizedInterim,
        year: INTERIM_SYNTHETIC_YEAR,
      });
      interimCtx = { byYear: mapWithInterim };
    }
  }
  const meta = normalizeMeta(company.metadata);
  const sectorModelReason =
    meta.sectorModel && typeof meta.sectorModel === "object" && "reason" in meta.sectorModel
      ? String((meta.sectorModel as { reason?: unknown }).reason ?? "")
      : null;
  const companyName =
    typeof meta.nameZh === "string"
      ? meta.nameZh
      : typeof meta.nameEnShort === "string"
        ? meta.nameEnShort
        : null;
  const financialModel =
    resolveFinancialModel(company.sectorModelType, {
      sector: company.sector,
      industry: typeof meta.industry === "string" ? meta.industry : null,
      sic: meta.sic,
      name: companyName,
      reason: sectorModelReason,
    }) ?? getDefaultFinancialModel();
  const template = financialModel.template;
  const profile = profiles[template];
  let rowKeys = profile.rowKeys;
  let trendKeys = profile.trendKeys;
  let baseTemplateNote = profile.note;

  if (template === "financial_services") {
    if (financialModel.subModel === "broker_exchange") {
      rowKeys = rowKeys.filter(
        (k) =>
          k !== "AssetsUnderManagement" &&
          k !== "NetClientFlows" &&
          k !== "InvestmentManagementFeeIncome",
      );
      trendKeys = trendKeys.filter(
        (k) =>
          k !== "AssetsUnderManagement" &&
          k !== "NetClientFlows" &&
          k !== "InvestmentManagementFeeIncome",
      );
      baseTemplateNote =
        "券商与交易所聚焦经纪/手续费佣金、自营投资收益与经营杠杆；不适用 AUM 资产管理规模考核。";
    } else if (financialModel.subModel === "asset_mgmt") {
      baseTemplateNote =
        "资产管理与财富机构关注 AUM 资产规模、客户净流入与费率稳定性；ROE/ROA按平均余额。";
    }
  } else if (template === "insurance") {
    if (financialModel.subModel === "life_health") {
      rowKeys = rowKeys.filter((k) => k !== "ClaimsRatio");
      trendKeys = trendKeys.filter((k) => k !== "ClaimsRatio");
      baseTemplateNote =
        "人身险核心受准备金计提与长期投资收益驱动；侧重资产负债久期匹配与浮存金长期投资回报，不适用单一财产险赔付率考核。";
    } else if (financialModel.subModel === "property_casualty") {
      baseTemplateNote =
        "财产险注重承保质量与赔付率；关注理赔成本控制、承保利润率与短期再保险风控。";
    }
  } else if (template === "real_estate") {
    if (financialModel.subModel === "developer") {
      rowKeys = [
        "Revenue",
        "RevenueGrowth",
        "OperatingIncome",
        "OperatingMargin",
        "NetIncome",
        "NetIncomeGrowth",
        "ROE",
        "OperatingCashFlow",
        "ContractLiabilities",
        "Inventory",
        "InvestmentProperty",
        "TotalAssets",
        "TotalLiabilities",
        "LiabilitiesToAssets",
        "NetDebtRatio",
        "ShareholdersEquity",
        "DividendsPaid",
        "ShareRepurchaseAmt",
      ];
      trendKeys = ["RevenueGrowth", "NetIncomeGrowth", "LiabilitiesToAssets", "ROE"];
      baseTemplateNote =
        "地产开发商核心关注预售合同负债、存货土地储备与资产负债率；受结算与拿地节奏影响，单年经营现金流波动较大。";
    } else if (financialModel.subModel === "reit_property") {
      rowKeys = [
        "Revenue",
        "RevenueGrowth",
        "OperatingIncome",
        "OperatingMargin",
        "InvestmentProperty",
        "NetIncome",
        "NetIncomeGrowth",
        "OperatingCashFlow",
        "DividendsPaid",
        "ShareRepurchaseAmt",
        "TotalAssets",
        "TotalLiabilities",
        "LiabilitiesToAssets",
        "NetDebtRatio",
        "ShareholdersEquity",
        "ROE",
      ];
      trendKeys = ["RevenueGrowth", "NetIncomeGrowth", "LiabilitiesToAssets", "ROE"];
      baseTemplateNote =
        "商业不动产与 REITs 核心关注物业租金回报、可分配现金流与资产净值（NAV）表现。";
    }
  }

  const modifierProfile = financialModel.modifiers[0]
    ? modifierProfiles[financialModel.modifiers[0]]
    : undefined;
  if (modifierProfile?.rowKeys) rowKeys = modifierProfile.rowKeys;
  if (modifierProfile?.trendKeys) trendKeys = modifierProfile.trendKeys;
  const templateNote = [baseTemplateNote, modifierProfile?.note]
    .filter(Boolean)
    .join(" ");
  const latestYear = normalizedFinancials[0]?.year ?? null;

  const rows = rowKeys.flatMap((key) => {
    const metric = getMetric(key);
    if (!metric) return [];

    const rawValues = displayYears.map((year) => [year, metric.compute(year, ctx)] as const);
    const interimRawValue =
      interimCtx && !ANNUAL_ONLY_METRIC_KEYS.has(metric.key)
        ? metric.compute(INTERIM_SYNTHETIC_YEAR, interimCtx)
        : null;

    if (rawValues.every(([, metricValue]) => metricValue == null) && interimRawValue == null) {
      return [];
    }

    return [{
      key: metric.key,
      zhLabel: metric.zhLabel,
      enLabel: metric.enLabel,
      hint: metric.hint,
      kind: metric.kind,
      rawValues: Object.fromEntries(rawValues),
      values: Object.fromEntries(
        rawValues.map(([year, metricValue]) => [
          year,
          formatMetricValue(metricValue, metric.kind, currency),
        ]),
      ),
      ...(interimColumn
        ? {
            interimRawValue,
            interimValue: formatMetricValue(interimRawValue, metric.kind, currency),
          }
        : {}),
    }];
  });

  const trends = trendKeys.flatMap((key) => {
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
    financialModel,
    templateNote,
    latestYear,
    displayYears,
    trendYears,
    trends,
    rows,
    currency,
    latestInterim: interimColumn,
  };
}

