/**
 * eval-golden-18.ts
 *
 * Buffett-Tribe Golden Benchmark Penetration Evaluator (18 Core Orthogonal + 5 Industrial Modifiers = 23 Flagships).
 *
 * Architecture:
 *   - Core 18 Matrix (tier: "core_18"): 3 Markets (US, CN, HK) × 6 Templates (industrial, bank, insurance, financial_services, real_estate, conglomerate)
 *   - Modifier Extension Pack (tier: "modifier_5"): 5 Specialized Industrial Modifiers (healthcare, semiconductor_hardware, energy_materials, utilities, telecommunications)
 *
 * 3-Layer Strict Penetration Audit (Zero False-Green Discipline):
 *   Layer 1 (Dataset & Ground-Truth):
 *     - D1: Official Annual Report Ground-Truth Verification (FY2024 exact figures within <=0.5% tolerance)
 *     - D2: Multi-Year Statutory Fact Coverage (>=5 annual years, required facts verified across recent years)
 *     - D3: Cross-Market Currency & FX Normalization Audit (HKD trading vs CNY/USD reporting conversion)
 *     - D4: All-Market Share Count Anti-Pollution Audit (US/CN/HK ShareCapital vs CommonStockSharesOutstanding)
 *     - D5: 4-Quarter Completeness & Sum Reconciliation (Q1+Q2+Q3+Q4 === FY within <=0.1% tolerance)
 *   Layer 2 (Processing Logic & Financial Model):
 *     - L1: 100% Exact Resolution of Template, SubModel, Modifier, and ValuationAnchor
 *     - L2: Real Average-Balance DuPont 3-Factor Identity & Dashboard ROE Closed-Loop (error <=0.1%)
 *     - L3: Invested Capital (IC <= 0) & ROIC Safety Fuse (live negative-IC years + boundary verification)
 *   Layer 3 (Page & UI 6-Tab End-to-End Verification):
 *     - Tab 1 (Value Line) & Tab 6 (Business Profile): Finite series, split normalization, REIT FCF shielding
 *     - Tab 2 (Financial Dashboard): Full FX context, requiredDashboardRows whitelist + forbiddenDashboardRows blacklist
 *     - Tab 3 (Competitive Advantage): Multi-year ROE & DuPont consistency
 *     - Tab 4 (Capital Allocation): Industrial OCF/CapEx/FCF waterfall vs Financial 5-step Net Income allocation waterfall
 *     - Tab 5 (Valuation Analysis): PE-Band & PB-Band corridor series (pbMin > 0) and PB-ROE 5Y TSR simulator verification
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/eval-golden-18.ts
 *   npx tsx --env-file=.env.local scripts/eval-golden-18.ts --core-only
 *   npx tsx --env-file=.env.local scripts/eval-golden-18.ts --ticker AAPL
 *   npx tsx --env-file=.env.local scripts/eval-golden-18.ts --template bank
 *   npx tsx --env-file=.env.local scripts/eval-golden-18.ts --market cn
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import db from "../src/lib/prisma";
import {
  getCompanyFinancials,
  getFinancialsCurrency,
} from "../src/lib/company-data";
import {
  buildCompanyFinancialDashboard,
  type FinancialYearItems,
} from "../src/lib/company-financial-dashboard";
import {
  calculateFreeCashFlow,
  calculateInvestedCapital,
  calculateReturnOnAverageBalance,
  calculateROIC,
  normalizeAnnualsStockSplits,
} from "../src/lib/financial-math";
import {
  isPePrimaryValuationAnchor,
  resolveFinancialModel,
  type FinancialModelModifier,
  type FinancialSubModel,
  type FinancialTemplate,
  type FinancialValuationAnchor,
} from "../src/lib/financial-model";
import { getLatestFxRates } from "../src/lib/fx-rates";
import {
  convertCurrency,
  currenciesNeededForConversion,
  extractCurrencyCode,
  tradingCurrencyForMarket,
} from "../src/lib/fx-rates-core";
import {
  computeCapitalAllocationStats,
  type CapitalAllocationAnnualInput,
} from "../src/lib/capital-allocation-metrics";
import {
  buildHistoricalPbSeries,
  buildHistoricalPeSeries,
  computeHistoricalPbMetrics,
  computeHistoricalPeMetrics,
} from "../src/lib/valuation-analysis-metrics";

export interface GroundTruthMetricSpec {
  value: number;
  toleranceRatio?: number; // defaults to 0.005 (0.5%)
}

export interface GoldenGroundTruthSpec {
  fiscalYear: number;
  sourceReport: string;
  dataCurrency: string; // currency unit of raw values stored in Financial table
  metrics: Record<string, GroundTruthMetricSpec>;
}

export interface GoldenCompanySpec {
  ticker: string;
  name: string;
  market: "us" | "cn" | "hk";
  tier: "core_18" | "modifier_5";
  expectedTemplate: FinancialTemplate;
  expectedSubModel?: FinancialSubModel | null;
  expectedModifier?: FinancialModelModifier | null;
  expectedValuationAnchor: FinancialValuationAnchor;
  expectedReportingCurrency: string;
  keyVerificationPoints: string;
  requiredFacts: string[];
  requiredDashboardRows: string[];
  forbiddenDashboardRows: string[];
  groundTruth: GoldenGroundTruthSpec;
  checkQuarterly?: boolean;
}

export const GOLDEN_18_MATRIX: GoldenCompanySpec[] = [
  // ===========================================================================
  // 1. US Market (6 Templates)
  // ===========================================================================
  {
    ticker: "AAPL",
    name: "Apple Inc.",
    market: "us",
    tier: "core_18",
    expectedTemplate: "industrial",
    expectedModifier: "consumer_brand",
    expectedValuationAnchor: "earnings_quality",
    expectedReportingCurrency: "USD",
    keyVerificationPoints: "高回购低净资产、毛利恒等式补齐、研发与合同负债透出、工商业FCF瀑布流",
    requiredFacts: ["Revenue", "NetIncome", "OperatingIncome", "OperatingCashFlow", "CapEx", "TotalAssets", "ShareholdersEquity"],
    requiredDashboardRows: [
      "Revenue",
      "GrossMargin",
      "OperatingIncome",
      "NetIncome",
      "ROE",
      "OperatingCashFlow",
      "CapEx",
      "FreeCashFlow",
      "RnDExpense",
      "ContractLiabilities",
      "ShareRepurchaseAmt",
      "DividendsPaid",
    ],
    forbiddenDashboardRows: ["NetInterestIncome", "NetLoans", "TotalDeposits", "ClaimsRatio", "AssetsUnderManagement"],
    groundTruth: {
      fiscalYear: 2024,
      sourceReport: "Apple Inc. FY2024 Form 10-K Consolidated Financial Statements",
      dataCurrency: "USD",
      metrics: {
        Revenue: { value: 391035000000, toleranceRatio: 0.002 },
        NetIncome: { value: 93736000000, toleranceRatio: 0.002 },
        OperatingCashFlow: { value: 118254000000, toleranceRatio: 0.005 },
        TotalAssets: { value: 364980000000, toleranceRatio: 0.005 },
        ShareholdersEquity: { value: 56950000000, toleranceRatio: 0.005 },
        CommonStockSharesOutstanding: { value: 15116786000, toleranceRatio: 0.005 },
      },
    },
  },
  {
    ticker: "JPM",
    name: "JPMorgan Chase & Co.",
    market: "us",
    tier: "core_18",
    expectedTemplate: "bank",
    expectedSubModel: null,
    expectedValuationAnchor: "pb_roe",
    expectedReportingCurrency: "USD",
    keyVerificationPoints: "全能商业银行标杆、净利息与非利息收入、信贷减值拨备、存贷款结构、屏蔽毛利与工业FCF",
    requiredFacts: ["Revenue", "NetInterestIncome", "NonInterestIncome", "ProvisionForCreditLosses", "NetIncome", "NetLoans", "TotalDeposits", "TotalAssets", "ShareholdersEquity"],
    requiredDashboardRows: [
      "Revenue",
      "NetInterestIncome",
      "NonInterestIncome",
      "ProvisionForCreditLosses",
      "NetIncome",
      "ROE",
      "ROA",
      "NetLoans",
      "TotalDeposits",
      "TotalAssets",
      "ShareholdersEquity",
      "EquityToAssets",
      "DividendsPaid",
      "ShareRepurchaseAmt",
    ],
    forbiddenDashboardRows: ["GrossMargin", "CostOfRevenue", "CapEx", "FreeCashFlow", "Inventory", "ClaimsRatio"],
    groundTruth: {
      fiscalYear: 2024,
      sourceReport: "JPMorgan Chase & Co. FY2024 Form 10-K",
      dataCurrency: "USD",
      metrics: {
        Revenue: { value: 177556000000, toleranceRatio: 0.005 },
        NetInterestIncome: { value: 92583000000, toleranceRatio: 0.005 },
        NetIncome: { value: 56868000000, toleranceRatio: 0.005 },
        TotalDeposits: { value: 2406032000000, toleranceRatio: 0.005 },
        TotalAssets: { value: 4002814000000, toleranceRatio: 0.005 },
        ShareholdersEquity: { value: 344758000000, toleranceRatio: 0.005 },
      },
    },
  },
  {
    ticker: "PGR",
    name: "Progressive Corp",
    market: "us",
    tier: "core_18",
    expectedTemplate: "insurance",
    expectedSubModel: "property_casualty",
    expectedValuationAnchor: "embedded_value_pb",
    expectedReportingCurrency: "USD",
    keyVerificationPoints: "美股纯财产险(P&C)标杆、已赚保费与投资收益核验、严格屏蔽传统存货/毛利/工业FCF",
    requiredFacts: ["NetPremiumsEarned", "InvestmentIncome", "NetIncome", "TotalAssets", "TotalLiabilities", "ShareholdersEquity"],
    requiredDashboardRows: [
      "NetPremiumsEarned",
      "InvestmentIncome",
      "NetIncome",
      "ROE",
      "ROA",
      "TotalAssets",
      "TotalLiabilities",
      "ShareholdersEquity",
      "EquityToAssets",
      "DividendsPaid",
    ],
    forbiddenDashboardRows: ["GrossMargin", "CostOfRevenue", "Inventory", "CapEx", "FreeCashFlow", "NetLoans"],
    groundTruth: {
      fiscalYear: 2024,
      sourceReport: "The Progressive Corporation FY2024 Form 10-K",
      dataCurrency: "USD",
      metrics: {
        Revenue: { value: 75372000000, toleranceRatio: 0.005 },
        NetPremiumsEarned: { value: 70799000000, toleranceRatio: 0.005 },
        NetIncome: { value: 8463000000, toleranceRatio: 0.005 },
        TotalAssets: { value: 105745000000, toleranceRatio: 0.005 },
        ShareholdersEquity: { value: 25591000000, toleranceRatio: 0.005 },
      },
    },
  },
  {
    ticker: "BX",
    name: "Blackstone Inc.",
    market: "us",
    tier: "core_18",
    expectedTemplate: "financial_services",
    expectedSubModel: "asset_mgmt",
    expectedValuationAnchor: "fee_earnings",
    expectedReportingCurrency: "USD",
    keyVerificationPoints: "轻资产另类资管旗舰、费用收益锚定、高分红回报、严禁套用银行存贷或保险赔付率",
    requiredFacts: ["Revenue", "NetIncome", "TotalAssets", "TotalLiabilities", "ShareholdersEquity", "DividendsPaid"],
    requiredDashboardRows: [
      "Revenue",
      "NetIncome",
      "NetMargin",
      "EPSDiluted",
      "ROE",
      "TotalAssets",
      "TotalLiabilities",
      "ShareholdersEquity",
      "EquityToAssets",
      "DividendsPaid",
    ],
    forbiddenDashboardRows: ["GrossMargin", "CostOfRevenue", "NetInterestIncome", "NetLoans", "ClaimsRatio", "CapEx", "FreeCashFlow"],
    groundTruth: {
      fiscalYear: 2024,
      sourceReport: "Blackstone Inc. FY2024 Form 10-K",
      dataCurrency: "USD",
      metrics: {
        Revenue: { value: 13229968000, toleranceRatio: 0.005 },
        NetIncome: { value: 2776508000, toleranceRatio: 0.005 },
        TotalAssets: { value: 43469875000, toleranceRatio: 0.005 },
        ShareholdersEquity: { value: 8212321000, toleranceRatio: 0.005 },
      },
    },
  },
  {
    ticker: "SPG",
    name: "Simon Property Group",
    market: "us",
    tier: "core_18",
    expectedTemplate: "real_estate",
    expectedSubModel: "reit_property",
    expectedValuationAnchor: "nav_ffo",
    expectedReportingCurrency: "USD",
    keyVerificationPoints: "商业持有型REITs标杆、巨额投资性物业、看板与价值线双重屏蔽受折旧扭曲的传统工业FCF/CapEx",
    requiredFacts: ["Revenue", "OperatingIncome", "NetIncome", "OperatingCashFlow", "InvestmentProperty", "TotalAssets", "ShareholdersEquity"],
    requiredDashboardRows: [
      "Revenue",
      "OperatingIncome",
      "InvestmentProperty",
      "NetIncome",
      "OperatingCashFlow",
      "TotalAssets",
      "TotalLiabilities",
      "NetDebtRatio",
      "ShareholdersEquity",
      "ROE",
    ],
    forbiddenDashboardRows: ["FreeCashFlow", "CapEx", "FCFMargin", "GrossMargin", "NetInterestIncome", "NetLoans", "ClaimsRatio", "AssetsUnderManagement"],
    groundTruth: {
      fiscalYear: 2024,
      sourceReport: "Simon Property Group, Inc. FY2024 Form 10-K",
      dataCurrency: "USD",
      metrics: {
        Revenue: { value: 5963798000, toleranceRatio: 0.005 },
        NetIncome: { value: 2367559000, toleranceRatio: 0.005 },
        InvestmentProperty: { value: 40242392000, toleranceRatio: 0.005 },
        TotalAssets: { value: 32405691000, toleranceRatio: 0.005 },
        ShareholdersEquity: { value: 2941925000, toleranceRatio: 0.005 },
      },
    },
  },
  {
    ticker: "BRK-B",
    name: "Berkshire Hathaway Inc.",
    market: "us",
    tier: "core_18",
    expectedTemplate: "conglomerate",
    expectedSubModel: null,
    expectedValuationAnchor: "sotp",
    expectedReportingCurrency: "USD",
    keyVerificationPoints: "巴菲特多元控股实业旗舰、保险浮存金负债+实业自由现金流并表、SOTP与PB通道估值",
    requiredFacts: ["Revenue", "NetIncome", "OperatingCashFlow", "CapEx", "InsuranceContractLiabilities", "TotalAssets", "TotalLiabilities", "ShareholdersEquity"],
    requiredDashboardRows: [
      "Revenue",
      "NetIncome",
      "ROE",
      "OperatingCashFlow",
      "CapEx",
      "FreeCashFlow",
      "InsuranceContractLiabilities",
      "TotalAssets",
      "TotalLiabilities",
      "ShareholdersEquity",
      "ShareRepurchaseAmt",
    ],
    forbiddenDashboardRows: ["GrossMargin", "NetLoans", "TotalDeposits", "ClaimsRatio", "AssetsUnderManagement"],
    groundTruth: {
      fiscalYear: 2024,
      sourceReport: "Berkshire Hathaway Inc. FY2024 Form 10-K",
      dataCurrency: "USD",
      metrics: {
        Revenue: { value: 371433000000, toleranceRatio: 0.005 },
        NetIncome: { value: 88995000000, toleranceRatio: 0.005 },
        OperatingCashFlow: { value: 30592000000, toleranceRatio: 0.005 },
        TotalAssets: { value: 1153881000000, toleranceRatio: 0.005 },
        ShareholdersEquity: { value: 649368000000, toleranceRatio: 0.005 },
      },
    },
  },

  // ===========================================================================
  // 2. CN Market (6 Templates)
  // ===========================================================================
  {
    ticker: "600519.SS",
    name: "贵州茅台",
    market: "cn",
    tier: "core_18",
    expectedTemplate: "industrial",
    expectedModifier: "consumer_brand",
    expectedValuationAnchor: "earnings_quality",
    expectedReportingCurrency: "CNY",
    keyVerificationPoints: "超高毛利消费品牌、经销商预收合同负债与基酒存货壁垒、平均余额杜邦恒等式、Q1-Q4单季加总0误差",
    requiredFacts: ["Revenue", "GrossProfit", "OperatingIncome", "NetIncome", "OperatingCashFlow", "ContractLiabilities", "Inventory", "TotalAssets", "ShareholdersEquity"],
    requiredDashboardRows: [
      "Revenue",
      "CostOfRevenue",
      "GrossMargin",
      "OperatingIncome",
      "NetIncome",
      "ROE",
      "OperatingCashFlow",
      "CapEx",
      "FreeCashFlow",
      "ContractLiabilities",
      "Inventory",
      "DividendsPaid",
    ],
    forbiddenDashboardRows: ["NetInterestIncome", "NetLoans", "TotalDeposits", "ClaimsRatio", "AssetsUnderManagement"],
    checkQuarterly: true,
    groundTruth: {
      fiscalYear: 2024,
      sourceReport: "贵州茅台 2024 年年度报告合并财务报表",
      dataCurrency: "CNY",
      metrics: {
        Revenue: { value: 170899152276.34, toleranceRatio: 0.002 },
        NetIncome: { value: 86228146421.62, toleranceRatio: 0.002 },
        OperatingCashFlow: { value: 92463692168.43, toleranceRatio: 0.005 },
        ContractLiabilities: { value: 9592453014.66, toleranceRatio: 0.005 },
        TotalAssets: { value: 298944579918.7, toleranceRatio: 0.005 },
        ShareholdersEquity: { value: 233105984399.47, toleranceRatio: 0.005 },
        CommonStockSharesOutstanding: { value: 1256197800, toleranceRatio: 0.001 },
      },
    },
  },
  {
    ticker: "600036.SS",
    name: "招商银行",
    market: "cn",
    tier: "core_18",
    expectedTemplate: "bank",
    expectedSubModel: null,
    expectedValuationAnchor: "pb_roe",
    expectedReportingCurrency: "CNY",
    keyVerificationPoints: "零售银行标杆、净利息收入+财富手续费佣金+信贷拨备全透出、PB-ROE推演器与金融瀑布流",
    requiredFacts: ["Revenue", "NetInterestIncome", "NonInterestIncome", "NetFeeAndCommissionIncome", "ProvisionForCreditLosses", "NetIncome", "NetLoans", "TotalDeposits", "TotalAssets", "ShareholdersEquity"],
    requiredDashboardRows: [
      "Revenue",
      "NetInterestIncome",
      "NonInterestIncome",
      "NetFeeAndCommissionIncome",
      "ProvisionForCreditLosses",
      "NetIncome",
      "ROE",
      "ROA",
      "NetLoans",
      "TotalDeposits",
      "TotalAssets",
      "ShareholdersEquity",
      "EquityToAssets",
      "DividendsPaid",
    ],
    forbiddenDashboardRows: ["GrossMargin", "CostOfRevenue", "CapEx", "FreeCashFlow", "Inventory", "ClaimsRatio"],
    checkQuarterly: true,
    groundTruth: {
      fiscalYear: 2024,
      sourceReport: "招商银行 2024 年年度报告",
      dataCurrency: "CNY",
      metrics: {
        Revenue: { value: 337488000000, toleranceRatio: 0.005 },
        NetInterestIncome: { value: 211277000000, toleranceRatio: 0.005 },
        NetIncome: { value: 148391000000, toleranceRatio: 0.005 },
        TotalDeposits: { value: 9195329000000, toleranceRatio: 0.005 },
        TotalAssets: { value: 12152036000000, toleranceRatio: 0.005 },
        ShareholdersEquity: { value: 1226014000000, toleranceRatio: 0.005 },
        CommonStockSharesOutstanding: { value: 25220000000, toleranceRatio: 0.005 },
      },
    },
  },
  {
    ticker: "601318.SS",
    name: "中国平安",
    market: "cn",
    tier: "core_18",
    expectedTemplate: "insurance",
    expectedSubModel: "life_health",
    expectedValuationAnchor: "embedded_value_pb",
    expectedReportingCurrency: "CNY",
    keyVerificationPoints: "人身险与综合金控标杆、IFRS17营业收入+给付+投资收益双引擎、严格屏蔽财险单一赔付率(ClaimsRatio)",
    requiredFacts: ["Revenue", "PolicyClaimsAndBenefits", "InvestmentIncome", "NetIncome", "TotalAssets", "TotalLiabilities", "ShareholdersEquity"],
    requiredDashboardRows: [
      "NetPremiumsEarned",
      "PolicyClaimsAndBenefits",
      "InvestmentIncome",
      "NetIncome",
      "ROE",
      "ROA",
      "TotalAssets",
      "TotalLiabilities",
      "ShareholdersEquity",
      "EquityToAssets",
      "DividendsPaid",
    ],
    forbiddenDashboardRows: ["ClaimsRatio", "GrossMargin", "CostOfRevenue", "Inventory", "CapEx", "FreeCashFlow"],
    checkQuarterly: true,
    groundTruth: {
      fiscalYear: 2024,
      sourceReport: "中国平安 2024 年年度报告",
      dataCurrency: "CNY",
      metrics: {
        Revenue: { value: 1028925000000, toleranceRatio: 0.005 },
        NetIncome: { value: 126607000000, toleranceRatio: 0.005 },
        TotalAssets: { value: 12957827000000, toleranceRatio: 0.005 },
        ShareholdersEquity: { value: 928600000000, toleranceRatio: 0.005 },
        CommonStockSharesOutstanding: { value: 18210000000, toleranceRatio: 0.005 },
      },
    },
  },
  {
    ticker: "000776.SZ",
    name: "广发证券",
    market: "cn",
    tier: "core_18",
    expectedTemplate: "financial_services",
    expectedSubModel: "broker_exchange",
    expectedValuationAnchor: "fee_earnings",
    expectedReportingCurrency: "CNY",
    keyVerificationPoints: "综合券商投行、手续费佣金+自营投资收益支柱、严禁强套资管AUM、真实负IC年份触发ROIC安全熔断",
    requiredFacts: ["Revenue", "NetFeeAndCommissionIncome", "InvestmentIncome", "NetIncome", "TotalAssets", "TotalLiabilities", "ShareholdersEquity"],
    requiredDashboardRows: [
      "Revenue",
      "NetFeeAndCommissionIncome",
      "InvestmentIncome",
      "NetIncome",
      "NetMargin",
      "ROE",
      "TotalAssets",
      "TotalLiabilities",
      "ShareholdersEquity",
      "EquityToAssets",
      "DividendsPaid",
    ],
    forbiddenDashboardRows: ["AssetsUnderManagement", "NetClientFlows", "InvestmentManagementFeeIncome", "GrossMargin", "NetInterestIncome", "NetLoans", "ClaimsRatio"],
    checkQuarterly: true,
    groundTruth: {
      fiscalYear: 2024,
      sourceReport: "广发证券 2024 年年度报告",
      dataCurrency: "CNY",
      metrics: {
        Revenue: { value: 26422056649.42, toleranceRatio: 0.005 },
        NetIncome: { value: 9636829949.09, toleranceRatio: 0.005 },
        TotalAssets: { value: 758745107933.09, toleranceRatio: 0.005 },
        ShareholdersEquity: { value: 147601915206.29, toleranceRatio: 0.005 },
        CommonStockSharesOutstanding: { value: 7621087664, toleranceRatio: 0.005 },
      },
    },
  },
  {
    ticker: "000069.SZ",
    name: "华侨城 A",
    market: "cn",
    tier: "core_18",
    expectedTemplate: "real_estate",
    expectedSubModel: "developer",
    expectedValuationAnchor: "nav_ffo",
    expectedReportingCurrency: "CNY",
    keyVerificationPoints: "地产开发商模式、预售合同负债+存货土储+投资性物业+净负债率、屏蔽工业FCF与持有型REITs FFO",
    requiredFacts: ["Revenue", "NetIncome", "ContractLiabilities", "Inventory", "InvestmentProperty", "TotalAssets", "TotalLiabilities", "ShareholdersEquity"],
    requiredDashboardRows: [
      "Revenue",
      "OperatingIncome",
      "NetIncome",
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
    ],
    forbiddenDashboardRows: ["FreeCashFlow", "CapEx", "FCFMargin", "GrossMargin", "NetInterestIncome", "NetLoans", "ClaimsRatio", "AssetsUnderManagement"],
    checkQuarterly: true,
    groundTruth: {
      fiscalYear: 2024,
      sourceReport: "华侨城A 2024 年年度报告",
      dataCurrency: "CNY",
      metrics: {
        Revenue: { value: 54407299587.95, toleranceRatio: 0.005 },
        NetIncome: { value: -8662299644.25, toleranceRatio: 0.005 },
        ContractLiabilities: { value: 29446044084.97, toleranceRatio: 0.005 },
        InvestmentProperty: { value: 18790048027.22, toleranceRatio: 0.005 },
        TotalAssets: { value: 324197559545.06, toleranceRatio: 0.005 },
        ShareholdersEquity: { value: 53188671102.26, toleranceRatio: 0.005 },
        CommonStockSharesOutstanding: { value: 8037758053, toleranceRatio: 0.005 },
      },
    },
  },
  {
    ticker: "000009.SZ",
    name: "中国宝安",
    market: "cn",
    tier: "core_18",
    expectedTemplate: "conglomerate",
    expectedSubModel: null,
    expectedValuationAnchor: "sotp",
    expectedReportingCurrency: "CNY",
    keyVerificationPoints: "A股多元实业控股（新材料+医药并表）、投资收益与跨板块合并现金流、SOTP估值锚定",
    requiredFacts: ["Revenue", "OperatingIncome", "NetIncome", "OperatingCashFlow", "CapEx", "InvestmentIncome", "TotalAssets", "TotalLiabilities", "ShareholdersEquity"],
    requiredDashboardRows: [
      "Revenue",
      "OperatingIncome",
      "NetIncome",
      "ROE",
      "OperatingCashFlow",
      "CapEx",
      "FreeCashFlow",
      "InvestmentIncome",
      "TotalAssets",
      "TotalLiabilities",
      "ShareholdersEquity",
      "DividendsPaid",
    ],
    forbiddenDashboardRows: ["GrossMargin", "NetLoans", "TotalDeposits", "ClaimsRatio", "AssetsUnderManagement"],
    checkQuarterly: true,
    groundTruth: {
      fiscalYear: 2024,
      sourceReport: "中国宝安 2024 年年度报告",
      dataCurrency: "CNY",
      metrics: {
        Revenue: { value: 20227883804.41, toleranceRatio: 0.005 },
        NetIncome: { value: 172625210.4, toleranceRatio: 0.005 },
        OperatingCashFlow: { value: 1662423468.08, toleranceRatio: 0.005 },
        TotalAssets: { value: 53774802564.92, toleranceRatio: 0.005 },
        ShareholdersEquity: { value: 9914702465.97, toleranceRatio: 0.005 },
        CommonStockSharesOutstanding: { value: 2579213965, toleranceRatio: 0.005 },
      },
    },
  },

  // ===========================================================================
  // 3. HK Market (6 Templates)
  // ===========================================================================
  {
    ticker: "0700.HK",
    name: "腾讯控股",
    market: "hk",
    tier: "core_18",
    expectedTemplate: "industrial",
    expectedModifier: "software_platform",
    expectedValuationAnchor: "growth_cashflow",
    expectedReportingCurrency: "CNY",
    keyVerificationPoints: "港币(HKD)股价与人民币(CNY)财报跨币折算核验、软件平台增长与现金流锚定、回购+分红双轮驱动、Q1-Q4单季自洽",
    requiredFacts: ["Revenue", "GrossProfit", "OperatingIncome", "NetIncome", "OperatingCashFlow", "CapEx", "TotalAssets", "ShareholdersEquity"],
    requiredDashboardRows: [
      "Revenue",
      "CostOfRevenue",
      "GrossMargin",
      "OperatingIncome",
      "NetIncome",
      "ROE",
      "OperatingCashFlow",
      "CapEx",
      "FreeCashFlow",
      "ShareRepurchaseAmt",
      "DividendsPaid",
    ],
    forbiddenDashboardRows: ["NetInterestIncome", "NetLoans", "TotalDeposits", "ClaimsRatio", "AssetsUnderManagement"],
    checkQuarterly: true,
    groundTruth: {
      fiscalYear: 2024,
      sourceReport: "腾讯控股 2024 年年度报告 Consolidated Income Statement & Balance Sheet",
      dataCurrency: "CNY",
      metrics: {
        Revenue: { value: 652498000000, toleranceRatio: 0.005 },
        NetIncome: { value: 194073000000, toleranceRatio: 0.005 },
        OperatingCashFlow: { value: 258521000000, toleranceRatio: 0.005 },
        TotalAssets: { value: 1780995000000, toleranceRatio: 0.005 },
        ShareholdersEquity: { value: 973548000000, toleranceRatio: 0.005 },
      },
    },
  },
  {
    ticker: "2388.HK",
    name: "中银香港",
    market: "hk",
    tier: "core_18",
    expectedTemplate: "bank",
    expectedSubModel: null,
    expectedValuationAnchor: "pb_roe",
    expectedReportingCurrency: "HKD",
    keyVerificationPoints: "港股成熟商业银行标杆、净利息+手续费佣金+客户存款、HKD币种自洽、PB-ROE估值通道",
    requiredFacts: ["Revenue", "NetInterestIncome", "NonInterestIncome", "NetFeeAndCommissionIncome", "NetIncome", "TotalDeposits", "TotalAssets", "ShareholdersEquity"],
    requiredDashboardRows: [
      "Revenue",
      "NetInterestIncome",
      "NonInterestIncome",
      "NetFeeAndCommissionIncome",
      "InvestmentIncome",
      "NetIncome",
      "ROE",
      "ROA",
      "TotalDeposits",
      "TotalAssets",
      "ShareholdersEquity",
      "EquityToAssets",
      "DividendsPaid",
    ],
    forbiddenDashboardRows: ["GrossMargin", "CostOfRevenue", "CapEx", "FreeCashFlow", "Inventory", "ClaimsRatio"],
    groundTruth: {
      fiscalYear: 2024,
      sourceReport: "中银香港 2024 年年度报告",
      dataCurrency: "HKD",
      metrics: {
        Revenue: { value: 65983128120, toleranceRatio: 0.005 },
        NetInterestIncome: { value: 48463377360, toleranceRatio: 0.005 },
        NetIncome: { value: 35405287320, toleranceRatio: 0.005 },
        TotalDeposits: { value: 2512726196400, toleranceRatio: 0.005 },
        TotalAssets: { value: 3884189584320, toleranceRatio: 0.005 },
        ShareholdersEquity: { value: 313664564640, toleranceRatio: 0.005 },
      },
    },
  },
  {
    ticker: "1299.HK",
    name: "友邦保险",
    market: "hk",
    tier: "core_18",
    expectedTemplate: "insurance",
    expectedSubModel: "life_health",
    expectedValuationAnchor: "embedded_value_pb",
    expectedReportingCurrency: "USD",
    keyVerificationPoints: "跨国纯寿险巨头、万亿级投资组合与保单准备金负债透出、严格屏蔽财险赔付率、跨币种(USD法定/CNY入库/HKD交易)折算",
    requiredFacts: ["NetPremiumsEarned", "PolicyClaimsAndBenefits", "InvestmentIncome", "TotalInvestments", "InsuranceContractLiabilities", "NetIncome", "TotalAssets", "ShareholdersEquity"],
    requiredDashboardRows: [
      "NetPremiumsEarned",
      "PolicyClaimsAndBenefits",
      "InvestmentIncome",
      "TotalInvestments",
      "InsuranceContractLiabilities",
      "NetIncome",
      "ROE",
      "ROA",
      "TotalAssets",
      "ShareholdersEquity",
      "EquityToAssets",
      "DividendsPaid",
      "ShareRepurchaseAmt",
    ],
    forbiddenDashboardRows: ["ClaimsRatio", "GrossMargin", "CostOfRevenue", "Inventory", "CapEx", "FreeCashFlow"],
    groundTruth: {
      fiscalYear: 2024,
      sourceReport: "友邦保险 2024 年年度报告 (AkShare CNY 入库口径)",
      dataCurrency: "CNY",
      metrics: {
        Revenue: { value: 221704632800, toleranceRatio: 0.005 },
        NetPremiumsEarned: { value: 135896702000, toleranceRatio: 0.005 },
        NetIncome: { value: 49139902400, toleranceRatio: 0.005 },
        TotalAssets: { value: 2195725533600, toleranceRatio: 0.005 },
        ShareholdersEquity: { value: 291058316000, toleranceRatio: 0.005 },
      },
    },
  },
  {
    ticker: "0388.HK",
    name: "香港交易所",
    market: "hk",
    tier: "core_18",
    expectedTemplate: "financial_services",
    expectedSubModel: "broker_exchange",
    expectedValuationAnchor: "fee_earnings",
    expectedReportingCurrency: "HKD",
    keyVerificationPoints: "特许垄断交易平台、超高净利率与90%+派息率、严禁强套资管AUM考核、HKD币种自洽",
    requiredFacts: ["Revenue", "NetIncome", "TotalInvestments", "TotalAssets", "TotalLiabilities", "ShareholdersEquity", "DividendsPaid"],
    requiredDashboardRows: [
      "Revenue",
      "NetIncome",
      "NetMargin",
      "EPSDiluted",
      "ROE",
      "TotalInvestments",
      "TotalAssets",
      "TotalLiabilities",
      "ShareholdersEquity",
      "EquityToAssets",
      "DividendsPaid",
    ],
    forbiddenDashboardRows: ["AssetsUnderManagement", "NetClientFlows", "InvestmentManagementFeeIncome", "GrossMargin", "NetInterestIncome", "NetLoans", "ClaimsRatio"],
    groundTruth: {
      fiscalYear: 2024,
      sourceReport: "香港交易所 2024 年年度报告",
      dataCurrency: "HKD",
      metrics: {
        Revenue: { value: 20719218960, toleranceRatio: 0.005 },
        NetIncome: { value: 12084822000, toleranceRatio: 0.005 },
        TotalAssets: { value: 353403719160, toleranceRatio: 0.005 },
        ShareholdersEquity: { value: 49869106080, toleranceRatio: 0.005 },
      },
    },
  },
  {
    ticker: "0016.HK",
    name: "新鸿基地产",
    market: "hk",
    tier: "core_18",
    expectedTemplate: "real_estate",
    expectedSubModel: "developer",
    expectedValuationAnchor: "nav_ffo",
    expectedReportingCurrency: "HKD",
    keyVerificationPoints: "港股龙头地产旗舰（物业发展+租金）、预售合同负债与存货储备、屏蔽受扭曲的工业FCF/CapEx",
    requiredFacts: ["Revenue", "OperatingIncome", "NetIncome", "OperatingCashFlow", "ContractLiabilities", "Inventory", "TotalAssets", "ShareholdersEquity"],
    requiredDashboardRows: [
      "Revenue",
      "OperatingIncome",
      "NetIncome",
      "ROE",
      "OperatingCashFlow",
      "ContractLiabilities",
      "Inventory",
      "TotalAssets",
      "TotalLiabilities",
      "LiabilitiesToAssets",
      "ShareholdersEquity",
      "DividendsPaid",
    ],
    forbiddenDashboardRows: ["FreeCashFlow", "CapEx", "FCFMargin", "GrossMargin", "NetInterestIncome", "NetLoans", "ClaimsRatio", "AssetsUnderManagement"],
    groundTruth: {
      fiscalYear: 2024,
      sourceReport: "新鸿基地产 FY2024 年度报告",
      dataCurrency: "HKD",
      metrics: {
        Revenue: { value: 65262096080, toleranceRatio: 0.005 },
        NetIncome: { value: 17382903280, toleranceRatio: 0.005 },
        ContractLiabilities: { value: 10245745680, toleranceRatio: 0.005 },
        TotalAssets: { value: 746658031920, toleranceRatio: 0.005 },
        ShareholdersEquity: { value: 553738471560, toleranceRatio: 0.005 },
      },
    },
  },
  {
    ticker: "0001.HK",
    name: "长和",
    market: "hk",
    tier: "core_18",
    expectedTemplate: "conglomerate",
    expectedSubModel: null,
    expectedValuationAnchor: "sotp",
    expectedReportingCurrency: "HKD",
    keyVerificationPoints: "李嘉诚全球多元控股旗舰（港口+零售+基建+电讯）、跨分部自由现金流与投资资产组合、SOTP估值通道",
    requiredFacts: ["Revenue", "OperatingIncome", "NetIncome", "OperatingCashFlow", "CapEx", "TotalInvestments", "InvestmentIncome", "TotalAssets", "ShareholdersEquity"],
    requiredDashboardRows: [
      "Revenue",
      "OperatingIncome",
      "NetIncome",
      "ROE",
      "OperatingCashFlow",
      "CapEx",
      "FreeCashFlow",
      "TotalInvestments",
      "InvestmentIncome",
      "TotalAssets",
      "TotalLiabilities",
      "ShareholdersEquity",
      "DividendsPaid",
      "ShareRepurchaseAmt",
    ],
    forbiddenDashboardRows: ["GrossMargin", "NetLoans", "TotalDeposits", "ClaimsRatio", "AssetsUnderManagement"],
    groundTruth: {
      fiscalYear: 2024,
      sourceReport: "长和 2024 年年度报告",
      dataCurrency: "HKD",
      metrics: {
        Revenue: { value: 260542280040, toleranceRatio: 0.005 },
        NetIncome: { value: 15824171520, toleranceRatio: 0.005 },
        OperatingCashFlow: { value: 50217297120, toleranceRatio: 0.005 },
        TotalAssets: { value: 1030258393680, toleranceRatio: 0.005 },
        ShareholdersEquity: { value: 495167478600, toleranceRatio: 0.005 },
      },
    },
  },
];

/**
 * 5 Specialized Industrial Modifiers Extension Suite
 * Covers the 5 non-default industrial valuation anchors previously omitted by the 18-company grid:
 *   1. healthcare -> pipeline_earnings (LLY)
 *   2. semiconductor_hardware -> cycle_adjusted_earnings (NVDA, also tests 10:1 stock split normalization)
 *   3. energy_materials -> normalized_earnings (601899.SS 紫金矿业)
 *   4. utilities -> regulated_assets (600900.SS 长江电力)
 *   5. telecommunications -> cashflow_yield (0941.HK 中国移动, also tests HKD/CNY cross-currency & quarterly sum)
 */
export const GOLDEN_MODIFIER_EXTENSION: GoldenCompanySpec[] = [
  {
    ticker: "MRK",
    name: "Merck & Co.",
    market: "us",
    tier: "modifier_5",
    expectedTemplate: "industrial",
    expectedModifier: "healthcare",
    expectedValuationAnchor: "pipeline_earnings",
    expectedReportingCurrency: "USD",
    keyVerificationPoints: "创新药旗舰(默沙东)、healthcare修饰符与管线盈利锚(pipeline_earnings)、超高毛利与高研发强度(R&D/Rev ~28%)",
    requiredFacts: ["Revenue", "GrossProfit", "NetIncome", "OperatingCashFlow", "CapEx", "RnDExpense", "TotalAssets", "ShareholdersEquity"],
    requiredDashboardRows: [
      "Revenue",
      "GrossMargin",
      "NetIncome",
      "ROE",
      "OperatingCashFlow",
      "CapEx",
      "FreeCashFlow",
      "RnDExpense",
      "RnDToRevenue",
      "Inventory",
      "DividendsPaid",
    ],
    forbiddenDashboardRows: ["NetInterestIncome", "NetLoans", "TotalDeposits", "ClaimsRatio", "AssetsUnderManagement"],
    groundTruth: {
      fiscalYear: 2024,
      sourceReport: "Merck & Co., Inc. FY2024 Form 10-K",
      dataCurrency: "USD",
      metrics: {
        Revenue: { value: 64168000000, toleranceRatio: 0.005 },
        NetIncome: { value: 17117000000, toleranceRatio: 0.005 },
        OperatingCashFlow: { value: 21468000000, toleranceRatio: 0.005 },
        RnDExpense: { value: 17938000000, toleranceRatio: 0.005 },
        CapEx: { value: 3372000000, toleranceRatio: 0.005 },
        TotalAssets: { value: 117106000000, toleranceRatio: 0.005 },
        ShareholdersEquity: { value: 46313000000, toleranceRatio: 0.005 },
      },
    },
  },
  {
    ticker: "NVDA",
    name: "NVIDIA Corp.",
    market: "us",
    tier: "modifier_5",
    expectedTemplate: "industrial",
    expectedModifier: "semiconductor_hardware",
    expectedValuationAnchor: "cycle_adjusted_earnings",
    expectedReportingCurrency: "USD",
    keyVerificationPoints: "半导体硬件旗舰、周期调整盈利锚(cycle_adjusted_earnings)、10拆1拆股历史股数与EPS自动平滑",
    requiredFacts: ["Revenue", "GrossProfit", "OperatingIncome", "NetIncome", "OperatingCashFlow", "CapEx", "RnDExpense", "TotalAssets", "ShareholdersEquity"],
    requiredDashboardRows: [
      "Revenue",
      "GrossMargin",
      "OperatingIncome",
      "NetIncome",
      "ROE",
      "OperatingCashFlow",
      "CapEx",
      "FreeCashFlow",
      "RnDExpense",
      "RnDToRevenue",
      "ShareRepurchaseAmt",
      "DividendsPaid",
    ],
    forbiddenDashboardRows: ["NetInterestIncome", "NetLoans", "TotalDeposits", "ClaimsRatio", "AssetsUnderManagement"],
    groundTruth: {
      fiscalYear: 2024,
      sourceReport: "NVIDIA Corporation FY2024 Form 10-K",
      dataCurrency: "USD",
      metrics: {
        Revenue: { value: 60922000000, toleranceRatio: 0.005 },
        NetIncome: { value: 29760000000, toleranceRatio: 0.005 },
        OperatingCashFlow: { value: 28090000000, toleranceRatio: 0.005 },
        TotalAssets: { value: 65728000000, toleranceRatio: 0.005 },
        ShareholdersEquity: { value: 42978000000, toleranceRatio: 0.005 },
      },
    },
  },
  {
    ticker: "601899.SS",
    name: "紫金矿业",
    market: "cn",
    tier: "modifier_5",
    expectedTemplate: "industrial",
    expectedModifier: "energy_materials",
    expectedValuationAnchor: "normalized_earnings",
    expectedReportingCurrency: "CNY",
    keyVerificationPoints: "强周期资源矿业标杆、周期中枢盈利锚(normalized_earnings)与PB-ROE估值走廊切换、Q1-Q4单季自洽",
    requiredFacts: ["Revenue", "OperatingIncome", "NetIncome", "OperatingCashFlow", "CapEx", "TotalAssets", "ShareholdersEquity"],
    requiredDashboardRows: [
      "Revenue",
      "GrossMargin",
      "OperatingIncome",
      "NetIncome",
      "ROE",
      "OperatingCashFlow",
      "CapEx",
      "FreeCashFlow",
      "Inventory",
      "DividendsPaid",
    ],
    forbiddenDashboardRows: ["NetInterestIncome", "NetLoans", "TotalDeposits", "ClaimsRatio", "AssetsUnderManagement"],
    checkQuarterly: true,
    groundTruth: {
      fiscalYear: 2024,
      sourceReport: "紫金矿业 2024 年年度报告",
      dataCurrency: "CNY",
      metrics: {
        Revenue: { value: 303639957153, toleranceRatio: 0.005 },
        NetIncome: { value: 32050602437, toleranceRatio: 0.005 },
        OperatingCashFlow: { value: 48860346839, toleranceRatio: 0.005 },
        TotalAssets: { value: 396610730026, toleranceRatio: 0.005 },
        ShareholdersEquity: { value: 139785524982, toleranceRatio: 0.005 },
      },
    },
  },
  {
    ticker: "600900.SS",
    name: "长江电力",
    market: "cn",
    tier: "modifier_5",
    expectedTemplate: "industrial",
    expectedModifier: "utilities",
    expectedValuationAnchor: "regulated_assets",
    expectedReportingCurrency: "CNY",
    keyVerificationPoints: "水电公用事业标杆、监管资产与核准回报锚(regulated_assets)、充沛经营现金流与高分红、Q1-Q4单季自洽",
    requiredFacts: ["Revenue", "OperatingIncome", "NetIncome", "OperatingCashFlow", "CapEx", "TotalAssets", "ShareholdersEquity", "DividendsPaid"],
    requiredDashboardRows: [
      "Revenue",
      "GrossMargin",
      "OperatingIncome",
      "NetIncome",
      "ROE",
      "OperatingCashFlow",
      "CapEx",
      "FreeCashFlow",
      "DividendsPaid",
      "LiabilitiesToAssets",
    ],
    forbiddenDashboardRows: ["NetInterestIncome", "NetLoans", "TotalDeposits", "ClaimsRatio", "AssetsUnderManagement"],
    checkQuarterly: true,
    groundTruth: {
      fiscalYear: 2024,
      sourceReport: "长江电力 2024 年年度报告",
      dataCurrency: "CNY",
      metrics: {
        Revenue: { value: 84491870566.52, toleranceRatio: 0.005 },
        NetIncome: { value: 32496172808.65, toleranceRatio: 0.005 },
        OperatingCashFlow: { value: 59648468284.22, toleranceRatio: 0.005 },
        TotalAssets: { value: 566585128973.81, toleranceRatio: 0.005 },
        ShareholdersEquity: { value: 210348910895.97, toleranceRatio: 0.005 },
      },
    },
  },
  {
    ticker: "0941.HK",
    name: "中国移动",
    market: "hk",
    tier: "modifier_5",
    expectedTemplate: "industrial",
    expectedModifier: "telecommunications",
    expectedValuationAnchor: "cashflow_yield",
    expectedReportingCurrency: "CNY",
    keyVerificationPoints: "电信运营商旗舰、现金流收益率锚(cashflow_yield)、HKD股价与CNY财报跨币折算、Q1-Q4单季自洽",
    requiredFacts: ["Revenue", "OperatingIncome", "NetIncome", "OperatingCashFlow", "CapEx", "TotalAssets", "ShareholdersEquity", "DividendsPaid"],
    requiredDashboardRows: [
      "Revenue",
      "OperatingIncome",
      "NetIncome",
      "ROE",
      "OperatingCashFlow",
      "CapEx",
      "FreeCashFlow",
      "FCFMargin",
      "DividendsPaid",
    ],
    forbiddenDashboardRows: ["NetInterestIncome", "NetLoans", "TotalDeposits", "ClaimsRatio", "AssetsUnderManagement"],
    checkQuarterly: true,
    groundTruth: {
      fiscalYear: 2024,
      sourceReport: "中国移动 2024 年年度报告",
      dataCurrency: "CNY",
      metrics: {
        Revenue: { value: 889468000000, toleranceRatio: 0.005 },
        NetIncome: { value: 138373000000, toleranceRatio: 0.005 },
        OperatingCashFlow: { value: 315741000000, toleranceRatio: 0.005 },
        TotalAssets: { value: 2108127000000, toleranceRatio: 0.005 },
        ShareholdersEquity: { value: 1392032000000, toleranceRatio: 0.005 },
      },
    },
  },
];

export const GOLDEN_23_SUITE: GoldenCompanySpec[] = [
  ...GOLDEN_18_MATRIX,
  ...GOLDEN_MODIFIER_EXTENSION,
];

export interface AuditFinding {
  layer: "Dataset" | "Logic" | "UI";
  severity: "P0" | "P1" | "P2";
  code: string;
  message: string;
}

export interface CompanyAuditReport {
  ticker: string;
  name: string;
  market: "us" | "cn" | "hk";
  tier: "core_18" | "modifier_5";
  template: FinancialTemplate;
  subModel: string | null;
  modifier: string | null;
  valuationAnchor: FinancialValuationAnchor;
  status: "PASS" | "WARN" | "FAIL";
  findings: AuditFinding[];
  summary: {
    layer1Pass: boolean;
    layer2Pass: boolean;
    layer3Pass: boolean;
    factsCount: number;
    annualYears: number[];
    groundTruthMatched: number;
    groundTruthTotal: number;
  };
}

function getNumericFact(fin: FinancialYearItems | undefined, key: string): number | null {
  if (!fin) return null;
  const raw =
    fin.items[key] ??
    (key === "ShareholdersEquity"
      ? fin.items["TotalStockholdersEquity"] ?? fin.items["TotalEquity"]
      : key === "TotalStockholdersEquity"
        ? fin.items["ShareholdersEquity"] ?? fin.items["TotalEquity"]
        : key === "ContractLiabilities"
          ? fin.items["AdvancesFromCustomers"]
          : key === "RnDExpense"
            ? fin.items["ResearchAndDevelopmentExpense"]
            : key === "InvestmentIncome"
              ? fin.items["NetInvestmentIncome"]
              : undefined);
  if (raw == null || String(raw).trim() === "") return null;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
}

/**
 * Deterministic verification of L3 ROIC & Invested Capital safety boundaries.
 * Ensures L3 is always actively verified even for companies whose historical IC > 0.
 */
export function verifyRoicSafetyBoundaries(): AuditFinding[] {
  const findings: AuditFinding[] = [];

  // 1. Negative IC must fuse to null
  const negIcRoic = calculateROIC({
    operatingIncome: 50_000_000_000,
    currentInvestedCapital: -10_000_000_000,
    effectiveTaxRate: 0.21,
  });
  if (negIcRoic !== null) {
    findings.push({
      layer: "Logic",
      severity: "P0",
      code: "ROIC_SAFETY_FUSE_FAILED",
      message: `当 IC < 0 时 calculateROIC 未熔断返回 null，实际返回: ${negIcRoic}`,
    });
  }

  // 2. Zero IC must fuse to null
  const zeroIcRoic = calculateROIC({
    operatingIncome: 50_000_000_000,
    currentInvestedCapital: 0,
    effectiveTaxRate: 0.21,
  });
  if (zeroIcRoic !== null) {
    findings.push({
      layer: "Logic",
      severity: "P0",
      code: "ROIC_ZERO_IC_FUSE_FAILED",
      message: `当 IC = 0 时 calculateROIC 未熔断返回 null，实际返回: ${zeroIcRoic}`,
    });
  }

  // 3. Missing debt must not manufacture 0 debt in calculateInvestedCapital
  const missingDebtIc = calculateInvestedCapital({
    totalEquity: 100_000_000,
    cashAndEquivalents: 50_000_000,
  });
  if (missingDebtIc !== null) {
    findings.push({
      layer: "Logic",
      severity: "P0",
      code: "IC_MISSING_DEBT_POLLUTION",
      message: `缺失有息债务时 calculateInvestedCapital 未返回 null，而是伪造了零债务: ${missingDebtIc}`,
    });
  }

  return findings;
}

export async function runGoldenAudit(): Promise<{ reports: CompanyAuditReport[]; allPassed: boolean }> {
  const args = process.argv.slice(2);
  const coreOnly = args.includes("--core-only");
  const tickerArg = args.indexOf("--ticker") !== -1 ? args[args.indexOf("--ticker") + 1]?.toUpperCase() : null;
  const templateArg = args.indexOf("--template") !== -1 ? args[args.indexOf("--template") + 1]?.toLowerCase() : null;
  const marketArg = args.indexOf("--market") !== -1 ? args[args.indexOf("--market") + 1]?.toLowerCase() : null;

  const baseSuite = coreOnly ? GOLDEN_18_MATRIX : GOLDEN_23_SUITE;
  const targetMatrix = baseSuite.filter((spec) => {
    if (tickerArg && spec.ticker.toUpperCase() !== tickerArg && !spec.ticker.toUpperCase().startsWith(tickerArg)) return false;
    if (templateArg && spec.expectedTemplate.toLowerCase() !== templateArg) return false;
    if (marketArg && spec.market.toLowerCase() !== marketArg) return false;
    return true;
  });

  console.log("================================================================================");
  console.log(`🚀 黄金测试集：${coreOnly ? "18 核心正交标杆" : "23 标杆 (18 正交核心 + 5 工业修饰符扩展)"} 全链路穿透审计`);
  console.log("   数据集与官方真值 (Layer 1) → 模型与杜邦/ROIC逻辑 (Layer 2) → 6 大 Tab 真实渲染 (Layer 3)");
  console.log("================================================================================\n");

  const globalBoundaryFindings = verifyRoicSafetyBoundaries();
  const reports: CompanyAuditReport[] = [];
  let suiteLiveNegativeIcTriggered = 0;

  for (const spec of targetMatrix) {
    console.log(`[${reports.length + 1}/${targetMatrix.length}] 正在穿透审计 ${spec.market.toUpperCase()} | ${spec.ticker} (${spec.name})...`);
    const findings: AuditFinding[] = [...globalBoundaryFindings];
    const code = spec.ticker.replace(/\.(SS|SZ|HK)$/, "");

    // 1. Locate entity in DB
    const entity = await db.entity.findFirst({
      where: {
        OR: [
          { ticker: spec.ticker },
          { ticker: spec.ticker.replace("-", ".") },
          { ticker: code },
          { code: spec.ticker },
          { code: code },
        ],
        type: { not: "master" },
      },
      include: {
        _count: { select: { financials: true } },
      },
    });

    if (!entity || entity._count.financials === 0) {
      findings.push({
        layer: "Dataset",
        severity: "P0",
        code: !entity ? "ENTITY_NOT_FOUND" : "NO_FINANCIALS",
        message: !entity
          ? `数据库未找到实体记录: ${spec.ticker}`
          : `数据库中无任何财务事实记录 (finCount = 0)`,
      });
      reports.push({
        ticker: spec.ticker,
        name: spec.name,
        market: spec.market,
        tier: spec.tier,
        template: spec.expectedTemplate,
        subModel: spec.expectedSubModel ?? null,
        modifier: spec.expectedModifier ?? null,
        valuationAnchor: spec.expectedValuationAnchor,
        status: "FAIL",
        findings,
        summary: {
          layer1Pass: false,
          layer2Pass: false,
          layer3Pass: false,
          factsCount: 0,
          annualYears: [],
          groundTruthMatched: 0,
          groundTruthTotal: Object.keys(spec.groundTruth.metrics).length,
        },
      });
      continue;
    }

    const finCount = entity._count.financials;
    const rawFinList = await getCompanyFinancials(entity.id, 10);
    const financialsCurrency = await getFinancialsCurrency(entity.id);
    const annualYears = rawFinList.map((f) => f.year).sort((a, b) => a - b);

    // =========================================================================
    // LAYER 1: 数据集与官方年报真值审计 (Dataset & Ground-Truth Layer)
    // =========================================================================

    // D1. 官方年报真值核验 (Ground-Truth Verification - P0)
    const gtSpec = spec.groundTruth;
    const gtFin = rawFinList.find((f) => f.year === gtSpec.fiscalYear);
    let gtMatched = 0;
    const gtEntries = Object.entries(gtSpec.metrics);

    if (!gtFin) {
      findings.push({
        layer: "Dataset",
        severity: "P0",
        code: "GROUND_TRUTH_YEAR_MISSING",
        message: `未找到真值基准财年 FY${gtSpec.fiscalYear} 的年报记录 (可用财年: ${annualYears.join(", ")})`,
      });
    } else {
      for (const [metricKey, expected] of gtEntries) {
        const actualVal = getNumericFact(gtFin, metricKey);
        const tol = expected.toleranceRatio ?? 0.005;
        if (actualVal == null) {
          findings.push({
            layer: "Dataset",
            severity: "P0",
            code: "GROUND_TRUTH_FACT_MISSING",
            message: `FY${gtSpec.fiscalYear} 缺失真值台账科目 ${metricKey} (期望: ${expected.value.toLocaleString()} ${gtSpec.dataCurrency})`,
          });
        } else {
          const diffRatio = Math.abs(actualVal - expected.value) / Math.max(1, Math.abs(expected.value));
          if (diffRatio > tol) {
            findings.push({
              layer: "Dataset",
              severity: "P0",
              code: "GROUND_TRUTH_MISMATCH",
              message: `FY${gtSpec.fiscalYear} 科目 ${metricKey} 偏离官方年报真值: 库内=${actualVal.toLocaleString()} vs 真值=${expected.value.toLocaleString()} (偏差 ${(diffRatio * 100).toFixed(3)}% > 容差 ${(tol * 100).toFixed(2)}%)`,
            });
          } else {
            gtMatched++;
          }
        }
      }
    }

    // D2. 近 5 年年报完整性与连续多期必需科目覆盖度 (P0)
    if (rawFinList.length < 5) {
      findings.push({
        layer: "Dataset",
        severity: "P0",
        code: "INSUFFICIENT_ANNUAL_YEARS",
        message: `可用年报少于 5 年 (实际: ${rawFinList.length} 年: ${annualYears.join(", ")})`,
      });
    }

    const recentCheckYears = [2024, 2023, 2022].filter((y) => annualYears.includes(y));
    for (const checkYr of recentCheckYears) {
      const finYr = rawFinList.find((f) => f.year === checkYr);
      for (const factKey of spec.requiredFacts) {
        if (getNumericFact(finYr, factKey) == null) {
          findings.push({
            layer: "Dataset",
            severity: "P0",
            code: "MISSING_REQUIRED_FACT",
            message: `FY${checkYr} 缺少模板必需财务科目: ${factKey}`,
          });
        }
      }
    }

    // D3. 币种登记与跨市场汇率对齐审计 (P0)
    if (entity.reportingCurrency !== spec.expectedReportingCurrency) {
      findings.push({
        layer: "Dataset",
        severity: "P0",
        code: "CURRENCY_MISMATCH",
        message: `报表法定币种错误: 期望 ${spec.expectedReportingCurrency}, 实际登记为 ${entity.reportingCurrency}`,
      });
    }

    const tradingCurrency = tradingCurrencyForMarket(spec.market);
    const itemCurrencies = new Set(
      rawFinList.flatMap((f) =>
        Object.values(f.itemUnits ?? {})
          .map(extractCurrencyCode)
          .filter((c): c is string => c != null),
      ),
    );
    if (financialsCurrency) itemCurrencies.add(financialsCurrency);
    const fxNeeded = currenciesNeededForConversion(
      [...itemCurrencies].map((c) => ({
        reportingCurrency: c,
        tradingCurrency,
      })),
    );
    const fxRates = await getLatestFxRates(fxNeeded);

    if (gtSpec.dataCurrency !== tradingCurrency) {
      const convertedSample = convertCurrency(1000, gtSpec.dataCurrency, tradingCurrency, fxRates);
      if (convertedSample == null || !Number.isFinite(convertedSample) || Math.abs(convertedSample - 1000) < 1) {
        findings.push({
          layer: "Dataset",
          severity: "P0",
          code: "CROSS_CURRENCY_FX_INVALID",
          message: `跨币种折算失效 (${gtSpec.dataCurrency} -> ${tradingCurrency}): 1000 折算结果为 ${convertedSample}`,
        });
      }
    }

    // D4. 全市场股数防污染审计 (US / CN / HK 全覆盖 - P0)
    if (gtFin) {
      const sharesNum = getNumericFact(gtFin, "CommonStockSharesOutstanding");
      const capitalNum =
        getNumericFact(gtFin, "ShareCapital") ?? getNumericFact(gtFin, "CommonStockValue");

      if (sharesNum != null) {
        if (capitalNum != null && Math.abs(sharesNum - capitalNum) < 1 && spec.market === "us") {
          findings.push({
            layer: "Dataset",
            severity: "P0",
            code: "SHARE_COUNT_POLLUTED_BY_CAPITAL",
            message: `股数直接等于实收资本金额 (${sharesNum})`,
          });
        }
        const shareUnit = gtFin.itemUnits?.["CommonStockSharesOutstanding"];
        if (shareUnit && /CNY|RMB|USD|HKD/i.test(shareUnit)) {
          findings.push({
            layer: "Dataset",
            severity: "P0",
            code: "SHARE_UNIT_POLLUTED_BY_CURRENCY",
            message: `股数单位被错误标记为货币: ${shareUnit}`,
          });
        }
        if (sharesNum <= 0 || sharesNum > 500_000_000_000) {
          findings.push({
            layer: "Dataset",
            severity: "P0",
            code: "SHARE_COUNT_OUT_OF_BOUNDS",
            message: `股数超出合理正数边界 (${sharesNum})`,
          });
        }
      }
    }

    // D5. 离散单季 Q1~Q4 完备性与做差自洽审计 (误差 <= 0.1% - P0)
    if (spec.checkQuarterly) {
      const qYear = gtSpec.fiscalYear;
      const quarterlyRecords = await db.financial.findMany({
        where: {
          entityId: entity.id,
          periodType: { in: ["Q1", "Q2", "Q3", "Q4"] },
          periodEnd: {
            gte: new Date(`${qYear}-01-01`),
            lte: new Date(`${qYear}-12-31`),
          },
          lineItem: { in: ["Revenue", "NetIncome"] },
        },
      });

      const byItemQuarters: Record<string, Set<string>> = {
        Revenue: new Set(),
        NetIncome: new Set(),
      };
      const qSums: Record<string, number> = { Revenue: 0, NetIncome: 0 };

      for (const qr of quarterlyRecords) {
        if (qr.value != null && (qr.lineItem === "Revenue" || qr.lineItem === "NetIncome")) {
          byItemQuarters[qr.lineItem].add(qr.periodType);
          qSums[qr.lineItem] += Number(qr.value);
        }
      }

      for (const testKey of ["Revenue", "NetIncome"] as const) {
        const presentQuarters = [...byItemQuarters[testKey]].sort();
        if (presentQuarters.length !== 4) {
          findings.push({
            layer: "Dataset",
            severity: "P0",
            code: "QUARTERLY_RECORDS_INCOMPLETE",
            message: `FY${qYear} ${testKey} 离散单季不完整，必须齐备 Q1~Q4 四个季度，实际仅有: [${presentQuarters.join(", ")}]`,
          });
          continue;
        }

        const fyVal = getNumericFact(gtFin, testKey);
        const qSumVal = qSums[testKey];
        if (fyVal != null && Math.abs(fyVal) > 1000) {
          const diffRatio = Math.abs(qSumVal - fyVal) / Math.abs(fyVal);
          if (diffRatio > 0.001) {
            findings.push({
              layer: "Dataset",
              severity: "P0",
              code: "QUARTERLY_SUM_MISMATCH",
              message: `FY${qYear} ${testKey} 四季之和与全年 FY 误差 ${(diffRatio * 100).toFixed(4)}% > 0.1% (FY=${fyVal.toLocaleString()}, Q1-Q4=${qSumVal.toLocaleString()})`,
            });
          }
        }
      }
    }

    // =========================================================================
    // LAYER 2: 处理逻辑与计算模型审计 (Processing Logic Layer)
    // =========================================================================

    const meta = (entity.metadata as Record<string, unknown> | null) ?? {};
    const sectorModelReason =
      meta.sectorModel && typeof meta.sectorModel === "object" && "reason" in meta.sectorModel
        ? String((meta.sectorModel as { reason?: unknown }).reason ?? "")
        : null;
    const companyName =
      typeof meta.nameZh === "string"
        ? meta.nameZh
        : typeof meta.nameEnShort === "string"
          ? meta.nameEnShort
          : entity.canonicalName;

    // L1. 模板、子模型、行业修饰符与核心估值锚 100% 精准判定 (P0)
    const resolvedModel = resolveFinancialModel(entity.sectorModelType, {
      sector: entity.sector,
      industry: typeof meta.industry === "string" ? meta.industry : null,
      sic: typeof meta.sic === "string" ? meta.sic : undefined,
      name: companyName,
      reason: sectorModelReason,
    });

    if (!resolvedModel) {
      findings.push({
        layer: "Logic",
        severity: "P0",
        code: "MODEL_RESOLUTION_FAILED",
        message: `无法解析商业模式模型 (sectorModelType=${entity.sectorModelType})`,
      });
    } else {
      if (resolvedModel.template !== spec.expectedTemplate) {
        findings.push({
          layer: "Logic",
          severity: "P0",
          code: "TEMPLATE_MISMATCH",
          message: `财务模板判定错误: 期望 ${spec.expectedTemplate}, 实际解析为 ${resolvedModel.template}`,
        });
      }
      if (spec.expectedSubModel !== undefined && resolvedModel.subModel !== spec.expectedSubModel) {
        findings.push({
          layer: "Logic",
          severity: "P0",
          code: "SUBMODEL_MISMATCH",
          message: `子模型判定错误: 期望 ${spec.expectedSubModel}, 实际推断为 ${resolvedModel.subModel}`,
        });
      }
      if (spec.expectedModifier && !resolvedModel.modifiers.includes(spec.expectedModifier)) {
        findings.push({
          layer: "Logic",
          severity: "P0",
          code: "MODIFIER_MISMATCH",
          message: `行业修饰符判定错误: 期望包含 ${spec.expectedModifier}, 实际为 [${resolvedModel.modifiers.join(", ")}]`,
        });
      }
      if (resolvedModel.valuationAnchor !== spec.expectedValuationAnchor) {
        findings.push({
          layer: "Logic",
          severity: "P0",
          code: "VALUATION_ANCHOR_MISMATCH",
          message: `核心估值锚判定错误: 期望 ${spec.expectedValuationAnchor}, 实际为 ${resolvedModel.valuationAnchor}`,
        });
      }
    }

    // Build production-identical financial dashboard with full FX context
    const dashboard = buildCompanyFinancialDashboard(
      {
        sector: entity.sector,
        metadata: entity.metadata,
        sectorModelType: entity.sectorModelType,
      },
      rawFinList,
      tradingCurrency,
      {
        reportingCurrency: financialsCurrency,
        tradingCurrency,
        fxRates,
      },
    );

    // L2. 平均余额杜邦三因子恒等式与看板真实 ROE 闭环核验 (P0)
    if (spec.expectedTemplate === "industrial") {
      const dashRoeRow = dashboard.rows.find((r) => r.key === "ROE");
      const finByYear = new Map(rawFinList.map((f) => [f.year, f]));

      let dupontCheckedPeriods = 0;
      for (const year of dashboard.displayYears) {
        const curr = finByYear.get(year);
        const prev = finByYear.get(year - 1);
        if (!curr || !prev) continue;

        const netIncome = getNumericFact(curr, "NetIncome");
        const revenue = getNumericFact(curr, "Revenue");
        const currAssets = getNumericFact(curr, "TotalAssets");
        const prevAssets = getNumericFact(prev, "TotalAssets");
        const currEquity = getNumericFact(curr, "ShareholdersEquity");
        const prevEquity = getNumericFact(prev, "ShareholdersEquity");

        if (
          netIncome != null &&
          revenue != null &&
          revenue > 0 &&
          currAssets != null &&
          prevAssets != null &&
          currEquity != null &&
          prevEquity != null
        ) {
          const avgAssets = (prevAssets + currAssets) / 2;
          const avgEquity = (prevEquity + currEquity) / 2;
          if (avgAssets > 0 && avgEquity > 0) {
            const avgBalanceRoe = calculateReturnOnAverageBalance(netIncome, prevEquity, currEquity);
            const netMargin = netIncome / revenue;
            const avgAssetTurnover = revenue / avgAssets;
            const avgEquityMultiplier = avgAssets / avgEquity;
            const dupontRoe = netMargin * avgAssetTurnover * avgEquityMultiplier;

            dupontCheckedPeriods++;
            if (avgBalanceRoe == null || Math.abs(dupontRoe - avgBalanceRoe) > 0.001) {
              findings.push({
                layer: "Logic",
                severity: "P0",
                code: "DUPONT_IDENTITY_VIOLATION",
                message: `FY${year} 平均余额杜邦三项乘积 (${dupontRoe.toFixed(4)}) 与平均余额 ROE (${avgBalanceRoe}) 误差超限`,
              });
              break;
            }

            // Cross-check against rendered dashboard ROE (when same currency)
            const dashRoeVal = dashRoeRow?.rawValues[year];
            if (
              gtSpec.dataCurrency === tradingCurrency &&
              dashRoeVal != null &&
              Math.abs(dupontRoe - dashRoeVal) > 0.001
            ) {
              findings.push({
                layer: "Logic",
                severity: "P0",
                code: "DUPONT_DASHBOARD_ROE_DESYNC",
                message: `FY${year} 杜邦 ROE (${dupontRoe.toFixed(4)}) 与看板实际渲染 ROE (${dashRoeVal.toFixed(4)}) 不一致`,
              });
              break;
            }
          }
        }
      }

      if (dupontCheckedPeriods === 0) {
        findings.push({
          layer: "Logic",
          severity: "P0",
          code: "DUPONT_NOT_EVALUATED",
          message: `未能找到任何连续财年完成平均余额杜邦闭环核验`,
        });
      }
    }

    // L3. 库内真实年份 IC <= 0 熔断扫描 (P0)
    for (const fin of rawFinList) {
      const equity = getNumericFact(fin, "ShareholdersEquity");
      const totalDebt = getNumericFact(fin, "TotalDebt");
      const shortDebt = getNumericFact(fin, "ShortTermDebt");
      const longDebt = getNumericFact(fin, "LongTermDebt");
      const cash = getNumericFact(fin, "CashAndCashEquivalents");
      const opInc = getNumericFact(fin, "OperatingIncome");

      const ic = calculateInvestedCapital({
        totalEquity: equity,
        totalDebt,
        shortTermDebt: shortDebt,
        longTermDebt: longDebt,
        cashAndEquivalents: cash,
      });

      if (ic != null && ic <= 0) {
        suiteLiveNegativeIcTriggered++;
        const roic = calculateROIC({
          operatingIncome: opInc ?? 1_000_000,
          currentInvestedCapital: ic,
          effectiveTaxRate: 0.25,
        });

        if (roic !== null) {
          findings.push({
            layer: "Logic",
            severity: "P0",
            code: "ROIC_SAFETY_FUSE_FAILED",
            message: `FY${fin.year} 投入资本非正 (IC=${ic}) 时，ROIC 未熔断返回 null，实际返回: ${roic}`,
          });
          break;
        }
      }
    }

    // =========================================================================
    // LAYER 3: 页面 6 大 Tab 端到端渲染验收 (Page & UI Layer)
    // =========================================================================

    // Prepare chronological annuals for Tab 1 / Tab 4 / Tab 5 verification
    const sortedAscFins = [...rawFinList].sort((a, b) => a.year - b.year);
    const rawAnnualSeries = sortedAscFins.map((f, idx) => {
      const prev = idx > 0 ? sortedAscFins[idx - 1] : undefined;
      const ni = getNumericFact(f, "NetIncome");
      const ocf = getNumericFact(f, "OperatingCashFlow");
      const capEx = getNumericFact(f, "CapEx");
      const eq = getNumericFact(f, "ShareholdersEquity");
      const prevEq = getNumericFact(prev, "ShareholdersEquity");
      const disclosedEps =
        getNumericFact(f, "EPSDiluted") ?? getNumericFact(f, "EPSBasic");
      const shs =
        getNumericFact(f, "CommonStockSharesOutstanding") ??
        getNumericFact(f, "WeightedAverageSharesDiluted") ??
        getNumericFact(f, "WeightedAverageShares") ??
        (ni != null && disclosedEps != null && Math.abs(disclosedEps) > 0.0001
          ? Math.round(Math.abs(ni / disclosedEps))
          : null);
      const eps =
        disclosedEps ??
        (ni != null && shs != null && shs > 0 ? ni / shs : null);
      const roeFrac = calculateReturnOnAverageBalance(ni, prevEq, eq);
      return {
        year: f.year,
        disclosedAt: `${f.year + 1}-04-30`,
        netIncome: ni,
        operatingCashFlow: ocf,
        capEx,
        freeCashFlow: calculateFreeCashFlow(ocf, capEx),
        shareholdersEquity: eq,
        shares: shs,
        sharesSource: "disclosed_period_end" as const,
        eps,
        roe: roeFrac != null ? Number((roeFrac * 100).toFixed(2)) : null,
        repurchaseAmt: getNumericFact(f, "ShareRepurchaseAmt"),
        dividendsPaid: getNumericFact(f, "DividendsPaid"),
      };
    });

    const splitNormalizedAnnuals = normalizeAnnualsStockSplits(rawAnnualSeries);

    // Tab 1: 价值线 (Value Line) 检验
    for (const ann of splitNormalizedAnnuals) {
      if (
        (ann.eps != null && (!Number.isFinite(ann.eps) || Number.isNaN(ann.eps))) ||
        (ann.roe != null && (!Number.isFinite(ann.roe) || Number.isNaN(ann.roe))) ||
        (ann.shareholdersEquity != null && !Number.isFinite(ann.shareholdersEquity))
      ) {
        findings.push({
          layer: "UI",
          severity: "P0",
          code: "VALUE_LINE_NAN_BREAKAGE",
          message: `Tab 1 价值线序列在 FY${ann.year} 出现 NaN 或非有限值`,
        });
        break;
      }
    }

    // Tab 2: 财务看板 (Financial Dashboard) 正向必现行 + 反向禁用行 + 脏字符核验
    const activeRowKeys = new Set(dashboard.rows.map((r) => r.key));

    if (dashboard.templateNote && /尚未接入|未接入|待后续接入/.test(dashboard.templateNote)) {
      findings.push({
        layer: "UI",
        severity: "P0",
        code: "DEPRECATED_PLACEHOLDER_BANNER",
        message: `Tab 2 看板包含废弃开发占位文案: "${dashboard.templateNote}"`,
      });
    }

    for (const reqKey of spec.requiredDashboardRows) {
      if (!activeRowKeys.has(reqKey)) {
        findings.push({
          layer: "UI",
          severity: "P0",
          code: "REQUIRED_ROW_MISSING",
          message: `Tab 2 看板缺失该模板必需渲染的高价值科目行: ${reqKey}`,
        });
      }
    }

    for (const forbiddenKey of spec.forbiddenDashboardRows) {
      if (activeRowKeys.has(forbiddenKey)) {
        findings.push({
          layer: "UI",
          severity: "P0",
          code: "FORBIDDEN_ROW_LEAKAGE",
          message: `Tab 2 看板跨界泄漏了不适用本行业模板的科目行: ${forbiddenKey}`,
        });
      }
    }

    for (const row of dashboard.rows) {
      for (const [y, strVal] of Object.entries(row.values)) {
        if (typeof strVal === "string" && (strVal.includes("NaN") || strVal.includes("undefined"))) {
          findings.push({
            layer: "UI",
            severity: "P0",
            code: "DASHBOARD_NAN_STRING_LEAKAGE",
            message: `Tab 2 看板科目 ${row.key} 在 ${y} 年渲染了脏字符串: "${strVal}"`,
          });
          break;
        }
      }
    }

    // Tab 4: 资本配置 (Capital Allocation) 双模式总账瀑布流验收
    const capAllocInput: CapitalAllocationAnnualInput[] = splitNormalizedAnnuals.map((a) => ({
      year: a.year,
      netIncome: a.netIncome,
      operatingCashFlow: a.operatingCashFlow,
      capEx: a.capEx,
      repurchaseAmt: a.repurchaseAmt,
      dividendsPaid: a.dividendsPaid,
      shares: a.shares,
      sharesSource: a.sharesSource,
      roe: a.roe,
    }));
    const capStats = computeCapitalAllocationStats(capAllocInput);

    if (!capStats || capStats.periodCount < 3) {
      findings.push({
        layer: "UI",
        severity: "P0",
        code: "CAPITAL_ALLOCATION_INSUFFICIENT",
        message: `Tab 4 资本配置统计生成失败或有效年份不足 3 期`,
      });
    } else if (resolvedModel?.showIndustrialCashFlow) {
      // 工商业/多元控股：验证 OCF - CapEx = FCF 瀑布流
      if (capStats.cumOcf == null || capStats.cumNetIncome == null) {
        findings.push({
          layer: "UI",
          severity: "P0",
          code: "INDUSTRIAL_WATERFALL_BROKEN",
          message: `Tab 4 工商业资本配置缺少累计经营现金流或累计净利润`,
        });
      }
    } else {
      // 金融与非工商业 (bank, insurance, financial_services, real_estate)：验证 5 步净利润资本分配瀑布流
      if (
        capStats.cumNetIncome == null ||
        capStats.shareholderReturnAmt == null ||
        capStats.retainedEarnings == null
      ) {
        findings.push({
          layer: "UI",
          severity: "P0",
          code: "FINANCIAL_WATERFALL_BROKEN",
          message: `Tab 4 金融资本配置 5 步瀑布流断链 (cumNetIncome=${capStats.cumNetIncome}, retained=${capStats.retainedEarnings}, return=${capStats.shareholderReturnAmt})`,
        });
      } else {
        const waterfallDiff = Math.abs(
          capStats.cumNetIncome - (capStats.retainedEarnings + capStats.shareholderReturnAmt),
        );
        if (waterfallDiff > 1) {
          findings.push({
            layer: "UI",
            severity: "P0",
            code: "FINANCIAL_WATERFALL_IDENTITY_ERROR",
            message: `Tab 4 金融资本分配总账不守恒: 累计净利 (${capStats.cumNetIncome}) != 留存扩表 (${capStats.retainedEarnings}) + 股东回报 (${capStats.shareholderReturnAmt})`,
          });
        }
      }
    }

    // Tab 5: 估值分析 (Valuation Analysis) PE-Band / PB-Band 走廊与 PB-ROE 5Y 推演器验证
    const candidatePriceTickers = [
      ...new Set(
        [
          spec.ticker,
          entity.ticker,
          code,
          `${code}.HK`,
          `${code.replace(/^0+/, "").padStart(4, "0")}.HK`,
          `${code}.SS`,
          `${code}.SZ`,
        ].filter((t): t is string => Boolean(t)),
      ),
    ];
    const stockPricesDesc = await db.stockPrice.findMany({
      where: {
        ticker: {
          in: candidatePriceTickers,
        },
        date: { gte: new Date("2021-01-01T00:00:00.000Z") },
      },
      orderBy: { date: "desc" },
      take: 800,
    });
    const stockPrices = stockPricesDesc.reverse();

    const priceSeries = stockPrices.map((p) => ({
      date: p.date.toISOString().slice(0, 10),
      close: Number(p.close),
    }));

    const usesPeAnchor = resolvedModel
      ? isPePrimaryValuationAnchor(resolvedModel.valuationAnchor)
      : true;

    const fxFactor =
      gtSpec.dataCurrency !== tradingCurrency
        ? convertCurrency(1, gtSpec.dataCurrency, tradingCurrency, fxRates) ?? 1
        : 1;

    if (priceSeries.length > 0) {
      const latestClose = priceSeries.at(-1)?.close ?? null;
      const latestEpsFx =
        splitNormalizedAnnuals.at(-1)?.eps != null
          ? splitNormalizedAnnuals.at(-1)!.eps! * fxFactor
          : null;
      // Dual-class scale alignment (e.g. BRK-B price ~$515 vs 10-K Class A EPS ~$61,904 -> 1/1500)
      const shareClassScale =
        latestClose != null &&
        latestEpsFx != null &&
        latestEpsFx > 0 &&
        latestClose / latestEpsFx < 0.05
          ? 1 / 1500
          : 1;

      if (usesPeAnchor) {
        const annualEpsList = splitNormalizedAnnuals.map((a) => ({
          year: a.year,
          eps: a.eps != null ? a.eps * fxFactor * shareClassScale : null,
          disclosedAt: a.disclosedAt,
        }));
        const peSeries = buildHistoricalPeSeries(priceSeries, annualEpsList);
        const peMetrics = computeHistoricalPeMetrics(
          peSeries,
          peSeries.at(-1)?.pe ?? null,
        );
        if (peSeries.length === 0 || peMetrics.peMin == null || peMetrics.peMin <= 0) {
          findings.push({
            layer: "UI",
            severity: "P0",
            code: "VALUATION_PE_BAND_INVALID",
            message: `Tab 5 历史 P/E 估值走廊未生成有效点位或下限非正 (points=${peSeries.length}, peMin=${peMetrics.peMin})`,
          });
        }
      } else {
        const annualBpsList = splitNormalizedAnnuals.map((a) => {
          const bpsRaw =
            a.shareholdersEquity != null && a.shares != null && a.shares > 0
              ? (a.shareholdersEquity / a.shares) * fxFactor * shareClassScale
              : null;
          return {
            year: a.year,
            bps: bpsRaw,
            disclosedAt: a.disclosedAt,
          };
        });
        const pbSeries = buildHistoricalPbSeries(priceSeries, annualBpsList);
        const pbMetrics = computeHistoricalPbMetrics(
          pbSeries,
          pbSeries.at(-1)?.pb ?? null,
        );
        if (pbSeries.length === 0 || pbMetrics.pbMin == null || pbMetrics.pbMin <= 0) {
          findings.push({
            layer: "UI",
            severity: "P0",
            code: "VALUATION_PB_BAND_INVALID",
            message: `Tab 5 非PE估值锚 (${resolvedModel?.valuationAnchor}) 的历史 P/B 走廊未生成有效点位或下限非正 (points=${pbSeries.length}, pbMin=${pbMetrics.pbMin})`,
          });
        }
      }
    } else {
      findings.push({
        layer: "Dataset",
        severity: "P0",
        code: "MISSING_STOCK_PRICES",
        message: `库内缺少该标的历史行情数据，无法渲染 Tab 1 价值线与 Tab 5 估值走廊`,
      });
    }

    // Strict Gatekeeping: ANY P0 or P1 finding fails the audit
    const blockingFindings = findings.filter((f) => f.severity === "P0" || f.severity === "P1");
    const status = blockingFindings.length > 0 ? "FAIL" : findings.length > 0 ? "WARN" : "PASS";

    const layer1Pass = findings.filter((f) => f.layer === "Dataset" && (f.severity === "P0" || f.severity === "P1")).length === 0;
    const layer2Pass = findings.filter((f) => f.layer === "Logic" && (f.severity === "P0" || f.severity === "P1")).length === 0;
    const layer3Pass = findings.filter((f) => f.layer === "UI" && (f.severity === "P0" || f.severity === "P1")).length === 0;

    reports.push({
      ticker: spec.ticker,
      name: spec.name,
      market: spec.market,
      tier: spec.tier,
      template: spec.expectedTemplate,
      subModel: spec.expectedSubModel ?? null,
      modifier: spec.expectedModifier ?? null,
      valuationAnchor: spec.expectedValuationAnchor,
      status,
      findings,
      summary: {
        layer1Pass,
        layer2Pass,
        layer3Pass,
        factsCount: finCount,
        annualYears,
        groundTruthMatched: gtMatched,
        groundTruthTotal: gtEntries.length,
      },
    });
  }

  // Print Summary Table
  console.log("--------------------------------------------------------------------------------");
  console.log("📊 黄金测试集全链路穿透审计执行结果总览 (零假绿灯严格门禁)");
  console.log("--------------------------------------------------------------------------------");

  let allPassed = true;
  for (const r of reports) {
    const statusIcon = r.status === "PASS" ? "✅ PASS" : r.status === "WARN" ? "⚠️ WARN" : "❌ FAIL";
    if (r.status === "FAIL") allPassed = false;
    const subOrMod = r.subModel ? ` (${r.subModel})` : r.modifier ? ` [${r.modifier}]` : "";
    console.log(
      `${statusIcon.padEnd(8)} | ${r.market.toUpperCase().padEnd(3)} | ${r.ticker.padEnd(10)} | ${r.name.padEnd(12)} | ${r.template}${subOrMod} | 锚:${r.valuationAnchor} | 真值:${r.summary.groundTruthMatched}/${r.summary.groundTruthTotal} | 事实:${r.summary.factsCount}行 (FY:${r.summary.annualYears.length}) | 缺陷:${r.findings.length}项`,
    );
    for (const f of r.findings) {
      const sevIcon = f.severity === "P0" ? "🔴 P0" : f.severity === "P1" ? "🟡 P1" : "⚪ P2";
      console.log(`     └─ [${f.layer}] ${sevIcon} [${f.code}] ${f.message}`);
    }
  }

  console.log("--------------------------------------------------------------------------------");
  console.log(
    `🛡️ L3 投入资本非正 (IC <= 0) 真实财年触发次数: ${suiteLiveNegativeIcTriggered} 次 + 确定性边界熔断自检通过`,
  );
  console.log("================================================================================\n");
  return { reports, allPassed };
}

// Direct execution
if (process.argv[1]?.endsWith("eval-golden-18.ts")) {
  runGoldenAudit()
    .then(({ allPassed }) => {
      process.exit(allPassed ? 0 : 1);
    })
    .catch((err) => {
      console.error("Fatal audit execution error:", err);
      process.exit(1);
    })
    .finally(() => db.$disconnect());
}
