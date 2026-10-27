import type {
  DataRequirement,
  MetricContractRow,
} from "./metric-contract-registry";

const DIRECT_FIELDS: Record<string, string[][]> = {
  营业收入: [["Revenue"]],
  营业成本: [["CostOfRevenue"]],
  毛利润: [["GrossProfit"]],
  营业利润: [["OperatingIncome"]],
  净利润: [["NetIncome"]],
  摊薄EPS: [["EPSDiluted"]],
  基本EPS: [["EPSBasic"]],
  总资产: [["TotalAssets"]],
  总负债: [["TotalLiabilities"]],
  股东权益: [["ShareholdersEquity"]],
  总权益: [["TotalEquity"]],
  现金及等价物: [["CashAndCashEquivalents"], ["CashEndOfPeriod"]],
  短期有息债务: [["ShortTermDebt"]],
  长期有息债务: [["LongTermDebt"]],
  总有息债务: [
    ["TotalDebt"],
    ["ShortTermDebt", "LongTermDebt"],
    ["LongTermDebt"],
    ["ShortTermDebt"],
  ],
  经营现金流: [["OperatingCashFlow"]],
  资本开支: [["CapEx"]],
  现金分红: [["DividendsPaid"]],
  股票回购: [["ShareRepurchaseAmt"]],
  并购支出: [["PurchaseSaleOfBusinessNet"]],
  期末股数: [["CommonStockSharesOutstanding"]],
  加权平均稀释股数: [
    ["WeightedAverageSharesDiluted"],
    ["WeightedAverageShares"],
    ["NetIncomeCommon", "EPSDiluted"],
    ["NetIncome", "EPSDiluted"],
  ],
  研发费用: [["RnDExpense"]],
  "合同负债/预收款": [["ContractLiabilities"]],
  "存货/开发成本": [["Inventory"]],
  投资性物业: [["InvestmentProperty"]],
  NOI: [["NOI"]],
  FFO: [["FFO"]],
  AFFO: [["AFFO"]],
  同店NOI增长: [["SameStoreNOIGrowth"]],
  出租率: [["Occupancy"]],
  "FFO/股": [["FFOPerShare"]],
  综合成本率: [["CombinedRatio"]],
  EV: [["EV"]],
  NBV: [["NBV"]],
  新业务价值率: [["NewBusinessValueMargin"]],
  偿付能力充足率: [["SolvencyRatio"]],
  浮存金: [["Float"]],
  净利息收入: [["NetInterestIncome"]],
  贷款净额: [["NetLoans"]],
  不良贷款: [["NonPerformingLoans"]],
  贷款损失准备: [["LoanLossAllowance"]],
  客户存款: [["TotalDeposits"]],
  信用减值损失: [["ProvisionForCreditLosses"]],
  净已赚保费: [["NetPremiumsEarned"]],
  赔付与保单利益: [["PolicyClaimsAndBenefits"]],
  投资资产组合: [["TotalInvestments"]],
  净投资收益: [["NetInvestmentIncome"], ["InvestmentIncome"]],
  保险合同负债: [["InsuranceContractLiabilities"]],
  合同负债: [["ContractLiabilities"]],
  AUM: [["AssetsUnderManagement"]],
  客户净流量: [["NetClientFlows"]],
  管理费收入: [["InvestmentManagementFeeIncome"]],
  手续费及佣金净收入: [["NetFeeAndCommissionIncome"], ["OperatingRevenue"]],
};

function normalizeName(name: string) {
  return name.replace(/\s+/g, "");
}

function rawRequirementForMetric(
  row: MetricContractRow,
): DataRequirement {
  const normalized = normalizeName(row.name);
  const directFields = DIRECT_FIELDS[normalized];
  if (directFields) {
    return { alternatives: directFields };
  }

  if (row.section === "general_derived") {
    const requirements: Record<string, DataRequirement> = {
      营收同比: { alternatives: [["Revenue"]], minYears: 2 },
      净利润同比: { alternatives: [["NetIncome"]], minYears: 2 },
      总资产同比: { alternatives: [["TotalAssets"]], minYears: 2 },
      毛利率: { alternatives: [["GrossProfit", "OperatingRevenue"]] },
      营业利润率: { alternatives: [["OperatingIncome", "Revenue"]] },
      净利率: { alternatives: [["NetIncome", "Revenue"]] },
      ROE: {
        alternatives: [
          ["NetIncomeCommon", "ShareholdersCommonEquity"],
          ["NetIncome", "ShareholdersCommonEquity"],
          ["NetIncomeCommon", "ShareholdersEquity"],
        ],
        minYears: 2,
      },
      ROA: { alternatives: [["NetIncome", "TotalAssets"]], minYears: 2 },
      FCF: { alternatives: [["OperatingCashFlow", "CapEx"]] },
      FCFMargin: {
        alternatives: [["OperatingCashFlow", "CapEx", "Revenue"]],
      },
      现金转化率: {
        alternatives: [["OperatingCashFlow", "NetIncome"]],
      },
      总资产周转率: {
        alternatives: [["Revenue", "TotalAssets"]],
        minYears: 2,
      },
      "负债/资产": {
        alternatives: [["TotalLiabilities", "TotalAssets"]],
      },
      "账面权益/资产": {
        alternatives: [["ShareholdersEquity", "TotalAssets"]],
      },
      净负债率: {
        alternatives: [
          ["TotalDebt", "CashAndCashEquivalents", "ShareholdersEquity"],
          [
            "ShortTermDebt",
            "LongTermDebt",
            "CashAndCashEquivalents",
            "ShareholdersEquity",
          ],
          ["LongTermDebt", "CashAndCashEquivalents", "ShareholdersEquity"],
          ["ShortTermDebt", "CashAndCashEquivalents", "ShareholdersEquity"],
        ],
      },
      ROIC: {
        alternatives: [
          [
            "OperatingIncome",
            "ShareholdersEquity",
            "TotalDebt",
            "CashAndCashEquivalents",
          ],
          [
            "OperatingIncome",
            "ShareholdersEquity",
            "ShortTermDebt",
            "LongTermDebt",
            "CashAndCashEquivalents",
          ],
          [
            "OperatingIncome",
            "ShareholdersEquity",
            "LongTermDebt",
            "CashAndCashEquivalents",
          ],
          [
            "OperatingIncome",
            "ShareholdersEquity",
            "ShortTermDebt",
            "CashAndCashEquivalents",
          ],
          [
            "OperatingIncome",
            "ShareholdersEquity",
            "CashAndCashEquivalents",
          ],
        ],
        minYears: 2,
      },
      "5年CAGR": {
        alternatives: [
          ["Revenue"],
          ["NetIncome"],
          ["FreeCashFlow"],
          ["ShareholdersEquity"],
          ["EPSDiluted"],
        ],
        minYears: 5,
      },
      期末股数变化: {
        alternatives: [["CommonStockSharesOutstanding"]],
        minYears: 2,
      },
      每股已实施分红: {
        alternatives: [["DividendsPaid", "CommonStockSharesOutstanding"]],
      },
    };
    return requirements[normalized] ?? { noKnownSchema: true };
  }

  if (row.section === "capital_allocation") {
    const requirements: Record<string, DataRequirement> = {
      完整现金流年度: { alternatives: [["OperatingCashFlow", "CapEx"]] },
      累计经营现金流: { alternatives: [["OperatingCashFlow", "CapEx"]] },
      累计资本开支: { alternatives: [["OperatingCashFlow", "CapEx"]] },
      累计自由现金流: { alternatives: [["OperatingCashFlow", "CapEx"]] },
      累计并购: {
        alternatives: [
          ["OperatingCashFlow", "CapEx", "PurchaseSaleOfBusinessNet"],
        ],
      },
      并购覆盖率: {
        alternatives: [["OperatingCashFlow", "CapEx"]],
      },
      累计回购: {
        alternatives: [
          ["OperatingCashFlow", "CapEx", "ShareRepurchaseAmt"],
        ],
      },
      累计分红: {
        alternatives: [["OperatingCashFlow", "CapEx", "DividendsPaid"]],
      },
      股东回报: {
        alternatives: [
          ["OperatingCashFlow", "CapEx", "DividendsPaid"],
          ["OperatingCashFlow", "CapEx", "ShareRepurchaseAmt"],
        ],
      },
      FCF扣除分配结余: {
        alternatives: [
          ["OperatingCashFlow", "CapEx", "DividendsPaid"],
          ["OperatingCashFlow", "CapEx", "ShareRepurchaseAmt"],
        ],
      },
      净利润减分红回购差额: {
        alternatives: [
          ["NetIncome", "DividendsPaid"],
          ["NetIncome", "ShareRepurchaseAmt"],
        ],
      },
    };
    return requirements[normalized] ?? { noKnownSchema: true };
  }

  if (row.section === "valuation") {
    const requirements: Record<string, DataRequirement> = {
      最新收盘价: { needsPrice: true },
      市值: {
        alternatives: [["CommonStockSharesOutstanding"]],
        needsPrice: true,
      },
      当前PE: { alternatives: [["EPSDiluted"]], needsPrice: true },
      当前PB: {
        alternatives: [
          ["ShareholdersCommonEquity", "CommonStockSharesOutstanding"],
        ],
        needsPrice: true,
      },
      BPS: {
        alternatives: [
          ["ShareholdersCommonEquity", "CommonStockSharesOutstanding"],
        ],
        needsPrice: true,
      },
      历史PE走廊: {
        alternatives: [["EPSDiluted"]],
        needsPrice: true,
        minYears: 2,
      },
      历史PB走廊: {
        alternatives: [
          ["ShareholdersCommonEquity", "CommonStockSharesOutstanding"],
        ],
        needsPrice: true,
        minYears: 2,
      },
      "历史PE/PB中位数": {
        alternatives: [["EPSDiluted"]],
        needsPrice: true,
        minYears: 2,
      },
      历史估值分位: {
        alternatives: [["EPSDiluted"]],
        needsPrice: true,
        minYears: 2,
      },
      "参考PE/PB": {
        alternatives: [["EPSDiluted"]],
        needsPrice: true,
        minYears: 2,
      },
      FCFYield: {
        alternatives: [
          ["OperatingCashFlow", "CapEx", "CommonStockSharesOutstanding"],
        ],
        needsPrice: true,
      },
      PE估值走廊: {
        alternatives: [["EPSDiluted"]],
        needsPrice: true,
        minYears: 2,
      },
      PB估值走廊: {
        alternatives: [
          ["ShareholdersCommonEquity", "CommonStockSharesOutstanding"],
        ],
        needsPrice: true,
        minYears: 2,
      },
      PE情景回报: {
        alternatives: [["EPSDiluted"]],
        needsPrice: true,
        minYears: 2,
      },
      "PB-ROE情景回报": {
        alternatives: [
          [
            "ShareholdersCommonEquity",
            "CommonStockSharesOutstanding",
            "NetIncome",
            "DividendsPaid",
          ],
        ],
        needsPrice: true,
        minYears: 2,
      },
    };
    return requirements[normalized] ?? { noKnownSchema: true };
  }

  const industryRequirements: Record<string, DataRequirement> = {
    NIM: {
      alternatives: [
        ["NIM"],
        ["NetInterestIncome", "EarningAssets"],
      ],
    },
    不良贷款率: {
      alternatives: [
        ["NonPerformingLoanRatio"],
        ["NonPerformingLoans", "GrossLoans"],
      ],
    },
    拨备覆盖率: {
      alternatives: [
        ["ProvisionCoverage"],
        ["LoanLossAllowance", "NonPerformingLoans"],
      ],
    },
    CET1比率: { alternatives: [["CET1Ratio"]] },
    赔付率: {
      alternatives: [["PolicyClaimsAndBenefits", "NetPremiumsEarned"]],
    },
    分部收入: { noKnownSchema: true },
    分部经营利润: { noKnownSchema: true },
    分部资产: { noKnownSchema: true },
    上市投资组合市值: { noKnownSchema: true },
    保险浮存金: { noKnownSchema: true },
    有效费率: {
      alternatives: [["AssetsUnderManagement", "InvestmentManagementFeeIncome"]],
    },
  };
  if (industryRequirements[normalized]) {
    return industryRequirements[normalized];
  }

  if (row.section === "modifier") {
    const requirements: Record<string, DataRequirement> = {
      消费品牌: { alternatives: [["Revenue", "GrossProfit"]] },
      医药健康: { alternatives: [["Revenue", "RnDExpense"]] },
      半导体硬件: {
        alternatives: [["Revenue", "CapEx", "Inventory"]],
      },
      电信: { alternatives: [["Revenue", "CapEx"]] },
      软件平台: { noKnownSchema: true },
      能源材料: { noKnownSchema: true },
      公用事业: { noKnownSchema: true },
    };
    return requirements[normalized] ?? { noKnownSchema: true };
  }

  return { noKnownSchema: true };
}

export function requirementForMetric(
  row: MetricContractRow,
): DataRequirement {
  return {
    coverageYears: 5,
    minCoverageRatio: 0.8,
    ...rawRequirementForMetric(row),
  };
}
