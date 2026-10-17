import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { pool } from "../db.js";
import { findEntity } from "./find-entity.js";

export interface FinancialItemDef {
  key: string;
  nameZh: string;
  nameEn: string;
  statement: "income_statement" | "balance_sheet" | "cash_flow" | "metric";
}

export const FINANCIAL_ITEMS: Record<string, FinancialItemDef> = {
  // ── 利润表 ──
  Revenue: { key: "Revenue", nameZh: "营业收入", nameEn: "Revenue", statement: "income_statement" },
  CostOfRevenue: { key: "CostOfRevenue", nameZh: "营业成本", nameEn: "Cost of Revenue", statement: "income_statement" },
  GrossProfit: { key: "GrossProfit", nameZh: "毛利润", nameEn: "Gross Profit", statement: "income_statement" },
  SellingExpense: { key: "SellingExpense", nameZh: "销售费用", nameEn: "Selling Expense", statement: "income_statement" },
  AdministrativeExpense: { key: "AdministrativeExpense", nameZh: "管理费用", nameEn: "Administrative Expense", statement: "income_statement" },
  RnDExpense: { key: "RnDExpense", nameZh: "研发费用", nameEn: "R&D Expense", statement: "income_statement" },
  OperatingIncome: { key: "OperatingIncome", nameZh: "营业利润", nameEn: "Operating Income", statement: "income_statement" },
  TotalProfit: { key: "TotalProfit", nameZh: "利润总额", nameEn: "Total Profit", statement: "income_statement" },
  NetIncome: { key: "NetIncome", nameZh: "净利润", nameEn: "Net Income", statement: "income_statement" },
  EPSDiluted: { key: "EPSDiluted", nameZh: "稀释每股收益", nameEn: "Diluted EPS", statement: "income_statement" },

  // ── 现金流量表 ──
  OperatingCashFlow: { key: "OperatingCashFlow", nameZh: "经营活动现金流", nameEn: "Operating Cash Flow", statement: "cash_flow" },
  CapEx: { key: "CapEx", nameZh: "资本开支", nameEn: "Capital Expenditure (CapEx)", statement: "cash_flow" },
  FreeCashFlow: { key: "FreeCashFlow", nameZh: "自由现金流 (FCF)", nameEn: "Free Cash Flow (OCF - CapEx)", statement: "cash_flow" },
  ShareBasedCompensation: { key: "ShareBasedCompensation", nameZh: "股权激励费用 (SBC)", nameEn: "Stock/Share-Based Compensation", statement: "cash_flow" },
  FCF_Ex_SBC: { key: "FCF_Ex_SBC", nameZh: "扣除SBC后的真自由现金流", nameEn: "FCF ex-SBC (FCF - SBC)", statement: "cash_flow" },
  InvestingCashFlow: { key: "InvestingCashFlow", nameZh: "投资活动现金流", nameEn: "Investing Cash Flow", statement: "cash_flow" },
  FinancingCashFlow: { key: "FinancingCashFlow", nameZh: "筹资活动现金流", nameEn: "Financing Cash Flow", statement: "cash_flow" },
  DividendsPaid: { key: "DividendsPaid", nameZh: "现金分红", nameEn: "Dividends Paid", statement: "cash_flow" },
  ShareRepurchaseAmt: { key: "ShareRepurchaseAmt", nameZh: "股份回购", nameEn: "Share Repurchase", statement: "cash_flow" },
  PurchaseSaleOfBusinessNet: { key: "PurchaseSaleOfBusinessNet", nameZh: "外延并购净支出 (M&A)", nameEn: "Net M&A Cash Outflow", statement: "cash_flow" },
  NetChangeInCash: { key: "NetChangeInCash", nameZh: "现金净增加额", nameEn: "Net Change in Cash", statement: "cash_flow" },

  // ── 资产负债表 ──
  CashAndCashEquivalents: { key: "CashAndCashEquivalents", nameZh: "现金及现金等价物", nameEn: "Cash & Cash Equivalents", statement: "balance_sheet" },
  ShortTermInvestments: { key: "ShortTermInvestments", nameZh: "短期投资", nameEn: "Short-Term Investments", statement: "balance_sheet" },
  AccountsReceivable: { key: "AccountsReceivable", nameZh: "应收账款", nameEn: "Accounts Receivable", statement: "balance_sheet" },
  Inventory: { key: "Inventory", nameZh: "存货", nameEn: "Inventory", statement: "balance_sheet" },
  TotalCurrentAssets: { key: "TotalCurrentAssets", nameZh: "流动资产合计", nameEn: "Total Current Assets", statement: "balance_sheet" },
  PropertyPlantEquipmentNet: { key: "PropertyPlantEquipmentNet", nameZh: "固定资产净额", nameEn: "PP&E Net", statement: "balance_sheet" },
  IntangibleAssets: { key: "IntangibleAssets", nameZh: "无形资产", nameEn: "Intangible Assets", statement: "balance_sheet" },
  Goodwill: { key: "Goodwill", nameZh: "商誉", nameEn: "Goodwill", statement: "balance_sheet" },
  TotalAssets: { key: "TotalAssets", nameZh: "资产总计", nameEn: "Total Assets", statement: "balance_sheet" },
  AccountsPayable: { key: "AccountsPayable", nameZh: "应付账款", nameEn: "Accounts Payable", statement: "balance_sheet" },
  ShortTermDebt: { key: "ShortTermDebt", nameZh: "短期借款", nameEn: "Short-Term Debt", statement: "balance_sheet" },
  LongTermDebt: { key: "LongTermDebt", nameZh: "长期借款", nameEn: "Long-Term Debt", statement: "balance_sheet" },
  TotalDebt: { key: "TotalDebt", nameZh: "总有息负债", nameEn: "Total Debt", statement: "balance_sheet" },
  TotalCurrentLiabilities: { key: "TotalCurrentLiabilities", nameZh: "流动负债合计", nameEn: "Total Current Liabilities", statement: "balance_sheet" },
  TotalLiabilities: { key: "TotalLiabilities", nameZh: "负债总计", nameEn: "Total Liabilities", statement: "balance_sheet" },
  ShareholdersEquity: { key: "ShareholdersEquity", nameZh: "股东权益合计", nameEn: "Shareholders' Equity", statement: "balance_sheet" },
  CommonStockSharesOutstanding: { key: "CommonStockSharesOutstanding", nameZh: "期末流通股数", nameEn: "Common Shares Outstanding", statement: "balance_sheet" },
  WeightedAverageSharesDiluted: { key: "WeightedAverageSharesDiluted", nameZh: "稀释加权平均股数", nameEn: "Diluted Weighted Avg Shares", statement: "income_statement" },

  // ── 衍生比率指标 ──
  GrossMargin: { key: "GrossMargin", nameZh: "毛利率", nameEn: "Gross Margin", statement: "metric" },
  OperatingMargin: { key: "OperatingMargin", nameZh: "营业利润率", nameEn: "Operating Margin", statement: "metric" },
  NetMargin: { key: "NetMargin", nameZh: "净利率", nameEn: "Net Profit Margin", statement: "metric" },
  FCFMargin: { key: "FCFMargin", nameZh: "自由现金流率 (FCF Margin)", nameEn: "FCF Margin", statement: "metric" },
  ROE: { key: "ROE", nameZh: "净资产收益率 (ROE)", nameEn: "Return on Equity", statement: "metric" },
};

const ALIASES: Record<string, string> = {
  // 利润表
  "营业收入": "Revenue",
  "营收": "Revenue",
  "收入": "Revenue",
  "revenue": "Revenue",
  "sales": "Revenue",
  "turnover": "Revenue",
  "营业成本": "CostOfRevenue",
  "成本": "CostOfRevenue",
  "cogs": "CostOfRevenue",
  "costofrevenue": "CostOfRevenue",
  "毛利润": "GrossProfit",
  "毛利": "GrossProfit",
  "grossprofit": "GrossProfit",
  "研发费用": "RnDExpense",
  "研发支出": "RnDExpense",
  "研发": "RnDExpense",
  "rnd": "RnDExpense",
  "r&d": "RnDExpense",
  "rndexpense": "RnDExpense",
  "销售费用": "SellingExpense",
  "管理费用": "AdministrativeExpense",
  "营业利润": "OperatingIncome",
  "经营利润": "OperatingIncome",
  "operatingincome": "OperatingIncome",
  "ebit": "OperatingIncome",
  "净利润": "NetIncome",
  "净利": "NetIncome",
  "netincome": "NetIncome",
  "利润": "NetIncome",
  "eps": "EPSDiluted",
  "每股收益": "EPSDiluted",
  "稀释eps": "EPSDiluted",

  // 现金流量表
  "经营活动现金流": "OperatingCashFlow",
  "经营现金流": "OperatingCashFlow",
  "ocf": "OperatingCashFlow",
  "operatingcashflow": "OperatingCashFlow",
  "资本开支": "CapEx",
  "资本支出": "CapEx",
  "capex": "CapEx",
  "自由现金流": "FreeCashFlow",
  "fcf": "FreeCashFlow",
  "freecashflow": "FreeCashFlow",
  "sbc": "ShareBasedCompensation",
  "股权激励": "ShareBasedCompensation",
  "股票薪酬": "ShareBasedCompensation",
  "sharebasedcompensation": "ShareBasedCompensation",
  "stockbasedcompensation": "ShareBasedCompensation",
  "fcf_ex_sbc": "FCF_Ex_SBC",
  "真自由现金流": "FCF_Ex_SBC",
  "扣除sbc自由现金流": "FCF_Ex_SBC",
  "扣除sbc后的自由现金流": "FCF_Ex_SBC",
  "投资活动现金流": "InvestingCashFlow",
  "筹资活动现金流": "FinancingCashFlow",
  "回购": "ShareRepurchaseAmt",
  "股份回购": "ShareRepurchaseAmt",
  "分红": "DividendsPaid",
  "现金分红": "DividendsPaid",
  "并购": "PurchaseSaleOfBusinessNet",
  "外延并购": "PurchaseSaleOfBusinessNet",
  "收并购净现金流": "PurchaseSaleOfBusinessNet",
  "收购": "PurchaseSaleOfBusinessNet",
  "m&a": "PurchaseSaleOfBusinessNet",
  "acquisitions": "PurchaseSaleOfBusinessNet",

  // 资产负债表
  "总资产": "TotalAssets",
  "资产总额": "TotalAssets",
  "totalassets": "TotalAssets",
  "流动资产": "TotalCurrentAssets",
  "总负债": "TotalLiabilities",
  "负债总额": "TotalLiabilities",
  "totalliabilities": "TotalLiabilities",
  "流动负债": "TotalCurrentLiabilities",
  "股东权益": "ShareholdersEquity",
  "净资产": "ShareholdersEquity",
  "equity": "ShareholdersEquity",
  "shareholdersequity": "ShareholdersEquity",
  "有息负债": "TotalDebt",
  "总负债有息": "TotalDebt",
  "totaldebt": "TotalDebt",
  "长期借款": "LongTermDebt",
  "短期借款": "ShortTermDebt",
  "现金": "CashAndCashEquivalents",
  "现金及等价物": "CashAndCashEquivalents",
  "cash": "CashAndCashEquivalents",
  "存货": "Inventory",
  "inventory": "Inventory",
  "应收账款": "AccountsReceivable",
  "应付账款": "AccountsPayable",
  "固定资产": "PropertyPlantEquipmentNet",
  "商誉": "Goodwill",
  "股数": "CommonStockSharesOutstanding",
  "总股本": "CommonStockSharesOutstanding",
  "期末股数": "CommonStockSharesOutstanding",
  "流通股数": "CommonStockSharesOutstanding",
  "shares": "CommonStockSharesOutstanding",
  "加权股数": "WeightedAverageSharesDiluted",

  // 衍生比率
  "毛利率": "GrossMargin",
  "grossmargin": "GrossMargin",
  "营业利润率": "OperatingMargin",
  "经营利润率": "OperatingMargin",
  "operatingmargin": "OperatingMargin",
  "净利率": "NetMargin",
  "净利润率": "NetMargin",
  "netmargin": "NetMargin",
  "roe": "ROE",
  "净资产收益率": "ROE",
  "自由现金流率": "FCFMargin",
  "fcfmargin": "FCFMargin",
};

const SPLIT_FACTOR_CANDIDATES = [
  1.5, 2, 3, 4, 5, 6, 7, 8, 10, 15, 20, 25, 50,
  0.5, 0.25, 0.2, 0.125, 0.1, 0.05,
];

function detectNumericSplitFactor(
  currShares: number,
  nextShares: number,
  currEps?: number | null,
  nextEps?: number | null,
): number | null {
  if (!currShares || !nextShares || currShares <= 0 || nextShares <= 0) return null;
  const ratio = nextShares / currShares;
  if (ratio >= 0.78 && ratio <= 1.28) return null;

  let bestCandidate: number | null = null;
  let minError = Infinity;
  for (const c of SPLIT_FACTOR_CANDIDATES) {
    const err = Math.abs(ratio - c) / c;
    if (err < 0.14 && err < minError) {
      bestCandidate = c;
      minError = err;
    }
  }
  if (bestCandidate == null) return null;

  if (currEps != null && nextEps != null && currEps !== 0 && nextEps !== 0) {
    const epsRatio = currEps / nextEps;
    if (bestCandidate > 1.4 && epsRatio < 0.3) return null;
    if (bestCandidate < 0.7 && epsRatio > 3.0) return null;
  }
  return bestCandidate;
}

/**
 * Two-stage stock split normalization on numeric year maps for pi-gateway Agent tool.
 */
export function normalizeNumericYearsStockSplits(
  dataByYear: Map<number, Record<string, number>>,
): void {
  const sortedYears = [...dataByYear.keys()].sort((a, b) => a - b);
  if (sortedYears.length === 0) return;

  const refSharesByYear = new Map<number, number>();
  for (const yr of sortedYears) {
    const m = dataByYear.get(yr)!;
    const wDiluted = m["WeightedAverageSharesDiluted"];
    const wBasic = m["WeightedAverageShares"];
    if (wDiluted && wDiluted > 0) {
      refSharesByYear.set(yr, wDiluted);
    } else if (wBasic && wBasic > 0) {
      refSharesByYear.set(yr, wBasic);
    } else if (m["NetIncome"] && m["EPSDiluted"] && m["NetIncome"] * m["EPSDiluted"] > 0) {
      refSharesByYear.set(yr, Math.round(m["NetIncome"] / m["EPSDiluted"]));
    }
  }

  const confirmedFactors = new Set<number>();

  // Stage 1: Income statement backwards normalization
  for (let i = sortedYears.length - 2; i >= 0; i--) {
    const currYr = sortedYears[i];
    const nextYr = sortedYears[i + 1];
    const currRef = refSharesByYear.get(currYr);
    const nextRef = refSharesByYear.get(nextYr);
    const currMap = dataByYear.get(currYr)!;
    const nextMap = dataByYear.get(nextYr)!;

    if (currRef && nextRef) {
      const factor = detectNumericSplitFactor(
        currRef,
        nextRef,
        currMap["EPSDiluted"] ?? currMap["EPSBasic"],
        nextMap["EPSDiluted"] ?? nextMap["EPSBasic"],
      );
      if (factor != null && factor !== 1) {
        confirmedFactors.add(factor);
        for (let j = 0; j <= i; j++) {
          const targetYr = sortedYears[j];
          const targetMap = dataByYear.get(targetYr)!;
          for (const shKey of ["WeightedAverageSharesDiluted", "WeightedAverageShares"]) {
            if (targetMap[shKey] != null) targetMap[shKey] = Math.round(targetMap[shKey] * factor);
          }
          for (const epsKey of ["EPSDiluted", "EPSBasic", "DividendPerShare"]) {
            if (targetMap[epsKey] != null) targetMap[epsKey] = Number((targetMap[epsKey] / factor).toFixed(4));
          }
          const prevRef = refSharesByYear.get(targetYr);
          if (prevRef != null) refSharesByYear.set(targetYr, Math.round(prevRef * factor));
        }
      }
    }
  }

  const allValidFactors = new Set<number>(confirmedFactors);
  const integerSplitFactors = [2, 3, 4, 5, 6, 7, 8, 10, 15, 20];
  for (const f of confirmedFactors) {
    for (const c of integerSplitFactors) {
      allValidFactors.add(f * c);
    }
  }

  // Stage 2: Balance sheet CommonStockSharesOutstanding alignment
  for (let k = sortedYears.length - 1; k >= 0; k--) {
    const yr = sortedYears[k];
    const targetMap = dataByYear.get(yr)!;
    const periodEndShares = targetMap["CommonStockSharesOutstanding"];
    if (!periodEndShares || periodEndShares <= 0) continue;

    let comparisonShares: number | undefined = refSharesByYear.get(yr);
    if ((!comparisonShares || comparisonShares <= 0) && k < sortedYears.length - 1) {
      comparisonShares = dataByYear.get(sortedYears[k + 1])?.["CommonStockSharesOutstanding"];
    }
    if (!comparisonShares || comparisonShares <= 0) continue;

    const ratio = comparisonShares / periodEndShares;
    if (ratio >= 0.82 && ratio <= 1.22) continue;

    let matchedFactor: number | null = null;
    let minErr = Infinity;
    for (const f of allValidFactors) {
      const err = Math.abs(ratio - f) / f;
      if (err < 0.16 && err < minErr) {
        matchedFactor = f;
        minErr = err;
      }
    }
    if (matchedFactor == null) {
      for (const candidate of SPLIT_FACTOR_CANDIDATES) {
        if (candidate >= 2.0 || candidate <= 0.5) {
          const err = Math.abs(ratio - candidate) / candidate;
          if (err < 0.14 && err < minErr) {
            matchedFactor = candidate;
            minErr = err;
          }
        }
      }
    }
    if (matchedFactor != null && matchedFactor !== 1) {
      targetMap["CommonStockSharesOutstanding"] = Math.round(periodEndShares * matchedFactor);
      if (!refSharesByYear.has(yr)) {
        for (const epsKey of ["EPSDiluted", "EPSBasic", "DividendPerShare"]) {
          if (targetMap[epsKey] != null) targetMap[epsKey] = Number((targetMap[epsKey] / matchedFactor).toFixed(4));
        }
      }
    }
  }
}

export function resolveFinancialLineItem(input: string): string | null {
  const normalized = input.trim();
  const lower = normalized.toLowerCase();
  if (FINANCIAL_ITEMS[normalized]) return normalized;
  if (ALIASES[lower]) return ALIASES[lower];
  if (ALIASES[normalized]) return ALIASES[normalized];

  // Try case-insensitive lookup
  for (const [key, item] of Object.entries(FINANCIAL_ITEMS)) {
    if (key.toLowerCase() === lower || item.nameZh.toLowerCase() === lower || item.nameEn.toLowerCase() === lower) {
      return key;
    }
  }
  return null;
}

export type DbFactRow = {
  line_item: string;
  period_end: string;
  period_type?: string;
  value: string | number;
  unit: string | null;
};

export function formatFinancialNumber(val: number | null, unit: string | null, isRatio = false): string {
  if (val == null || !Number.isFinite(val)) return "—";
  if (isRatio) {
    return `${(val * 100).toFixed(1)}%`;
  }
  const abs = Math.abs(val);
  const sign = val < 0 ? "-" : "";

  // For shares or per-share metrics
  if (unit === "shares") {
    if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)} 亿股`;
    if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)} 百万股`;
    return `${sign}${abs.toLocaleString()}`;
  }
  if (unit === "USD/share" || unit === "CNY/share" || unit === "HKD/share" || unit?.endsWith("/shares")) {
    return `${sign}${abs.toFixed(2)}`;
  }

  // Large financial amounts: format in Yi (100M) or standard billions
  if (abs >= 1e8) {
    const inYi = abs / 1e8;
    return `${sign}${inYi >= 100 ? inYi.toFixed(0) : inYi.toFixed(1)} 亿`;
  }
  if (abs >= 1e4) {
    return `${sign}${(abs / 1e4).toFixed(1)} 万`;
  }
  return `${sign}${abs.toFixed(2)}`;
}

export function buildFinancialsMarkdown(
  companyLabel: string,
  reportingCurrency: string,
  years: number[],
  dataByYear: Map<number, Record<string, number>>,
  requestedKeys: string[],
  latestInterim?: { label: string; items: Record<string, number> } | null,
): string {
  if (years.length === 0 && !latestInterim) {
    return `### ${companyLabel} 财务报表数据\n\n未找到该公司的历史年度财务报表数据（可能尚未入库或回填中）。`;
  }

  const sortedYears = [...years].sort((a, b) => a - b);
  const colHeaders = [...sortedYears.map(String), ...(latestInterim ? [latestInterim.label] : [])];
  const header = `| 财务科目 / 核心指标 | ${colHeaders.join(" | ")} |`;
  const divider = `| :--- | ${colHeaders.map(() => "---:").join(" | ")} |`;

  const rows: string[] = [];

  for (const key of requestedKeys) {
    const meta = FINANCIAL_ITEMS[key] ?? {
      key,
      nameZh: key,
      nameEn: key,
      statement: "income_statement",
    };
    const isRatio = meta.statement === "metric";
    const itemUnit =
      key === "CommonStockSharesOutstanding" || key === "WeightedAverageSharesDiluted" || key === "WeightedAverageShares"
        ? "shares"
        : key === "EPSDiluted" || key === "EPSBasic"
          ? `${reportingCurrency || "USD"}/shares`
          : reportingCurrency;

    const values = sortedYears.map((yr) => {
      const yearMap = dataByYear.get(yr);
      const val = yearMap ? yearMap[key] ?? null : null;
      return formatFinancialNumber(val, itemUnit, isRatio);
    });
    if (latestInterim) {
      const interimVal = latestInterim.items[key] ?? null;
      values.push(formatFinancialNumber(interimVal, itemUnit, isRatio));
    }

    const label = `${meta.nameZh} (${meta.nameEn})`;
    rows.push(`| **${label}** | ${values.join(" | ")} |`);
  }

  const rangeLabel =
    sortedYears.length > 0
      ? `FY${sortedYears[0]}–${sortedYears[sortedYears.length - 1]}${latestInterim ? ` + ${latestInterim.label}` : ""}`
      : latestInterim?.label ?? "";

  const noteLines = [
    `### ${companyLabel} 历年财务报表数据 (${rangeLabel})`,
    `- **主表币种**: ${reportingCurrency || "USD / 原始币种"}（金额单位除特别标注外均为：亿）`,
    `- **数据范围**: ${sortedYears.length > 0 ? `覆盖近 ${sortedYears.length} 年法定年报三大报表（经标准会计规则与拆股同源复权归一化）` : "次新股/最新未结转季报快照 (YTD)"}`,
    ``,
    header,
    divider,
    ...rows,
  ];

  return noteLines.join("\n");
}

function computeDerivedMetricsForMap(map: Record<string, number>) {
  const ocf = map["OperatingCashFlow"] ?? null;
  const capex = map["CapEx"] ?? null;
  const rev = map["Revenue"] ?? null;
  const net = map["NetIncome"] ?? null;
  const opIncome = map["OperatingIncome"] ?? null;
  const gross = map["GrossProfit"] ?? null;
  const equity = map["ShareholdersEquity"] ?? null;
  const sbc = map["ShareBasedCompensation"] ?? map["StockBasedCompensation"] ?? null;

  if (ocf != null && capex != null) {
    map["FreeCashFlow"] = ocf - Math.abs(capex);
  }
  if (map["FreeCashFlow"] != null && sbc != null) {
    map["FCF_Ex_SBC"] = map["FreeCashFlow"] - sbc;
  }
  if (rev != null && rev > 0) {
    if (gross != null) map["GrossMargin"] = gross / rev;
    if (opIncome != null) map["OperatingMargin"] = opIncome / rev;
    if (net != null) map["NetMargin"] = net / rev;
    if (map["FreeCashFlow"] != null) map["FCFMargin"] = map["FreeCashFlow"] / rev;
  }
  if (net != null && equity != null && equity > 0) {
    map["ROE"] = net / equity;
  }
}

export const getCompanyFinancialsTool = defineTool({
  name: "get_company_financials",
  label: "Get Company Financials (Three Statements & Metrics)",
  description:
    "Fetch normalized multi-year financial statements (Income Statement, Balance Sheet, Cash Flow) and calculated metrics (Free Cash Flow, FCF ex-SBC, ROE, Margins) for a company. Supports querying specific line items like R&D expense, SBC, OCF, CapEx, FCF, Revenue, or Net Income across FY2020-2025. Use this whenever the user asks for exact financial figures, historical financial trends, capital expenditure, R&D spending, or cash flow decomposition.",
  promptSnippet: "get_company_financials(company, years?, statement?, lineItems?) → multi-year financial statement tables and key metrics",
  parameters: Type.Object({
    company: Type.String({
      description: "Company ticker (e.g. AMZN, AAPL, 600519, 00700) or name in Chinese/English (e.g. 亚马逊, 苹果, 腾讯)",
    }),
    years: Type.Optional(Type.Number({
      description: "Number of recent fiscal years to fetch (default: 5, up to 10)",
    })),
    statement: Type.Optional(Type.String({
      description: "Filter by financial statement: 'income_statement' | 'balance_sheet' | 'cash_flow' | 'all' (default: 'all')",
    })),
    lineItems: Type.Optional(Type.Array(Type.String(), {
      description: "Specific financial line items to retrieve (e.g. ['RnDExpense', 'FreeCashFlow', 'OperatingCashFlow', 'CapEx', 'ShareBasedCompensation'] or Chinese aliases like ['研发费用', '自由现金流', 'SBC'])",
    })),
  }),
  async execute(_toolCallId, params, signal) {
    const { company, years: inputYears, statement, lineItems: inputLineItems } = params;

    let entity;
    try {
      entity = await findEntity(company);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: `DB error: ${msg}` }], details: null };
    }

    if (!entity) {
      return {
        content: [{ type: "text" as const, text: `未找到与 "${company}" 匹配的公司实体。请检查代码或公司名称。` }],
        details: { count: 0 },
      };
    }

    if (signal?.aborted) {
      return { content: [{ type: "text" as const, text: "Cancelled." }], details: null };
    }

    const maxYears = Math.min(Math.max(inputYears ?? 5, 1), 10);

    // Query Financial rows for this entity (or family entities with same ticker)
    const sql = `
      SELECT f."lineItem" AS line_item,
             f."periodEnd" AS period_end,
             f."periodType" AS period_type,
             f.value::text AS value,
             f.unit
      FROM "Financial" f
      JOIN "Entity" e ON f."entityId" = e.id
      WHERE (f."entityId" = $1 OR UPPER(e.ticker) = UPPER($2))
        AND f."periodType" = 'FY'
        AND f."periodEnd" >= '2020-01-01'
      ORDER BY f."periodEnd" DESC, f."lineItem" ASC
    `;

    let rows: DbFactRow[] = [];
    try {
      const r = await pool.query<DbFactRow>(sql, [entity.id, entity.ticker ?? ""]);
      rows = r.rows;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: `查询财务数据失败: ${msg}` }], details: null };
    }

    // Also query latest interim snapshot (periodType <> 'FY' where periodEnd > max_fy_date)
    const maxFyDate = rows.length > 0 ? rows[0].period_end : null;
    const interimSql = `
      SELECT f."lineItem" AS line_item,
             f."periodEnd" AS period_end,
             f."periodType" AS period_type,
             f.value::text AS value,
             f.unit
      FROM "Financial" f
      JOIN "Entity" e ON f."entityId" = e.id
      WHERE (f."entityId" = $1 OR UPPER(e.ticker) = UPPER($2))
        AND f."periodType" <> 'FY'
        ${maxFyDate ? `AND f."periodEnd" > $3` : ""}
      ORDER BY f."periodEnd" DESC, f."lineItem" ASC
      LIMIT 200
    `;

    let interimRows: DbFactRow[] = [];
    try {
      const ir = await pool.query<DbFactRow>(
        interimSql,
        maxFyDate ? [entity.id, entity.ticker ?? "", maxFyDate] : [entity.id, entity.ticker ?? ""],
      );
      interimRows = ir.rows;
    } catch {
      interimRows = [];
    }

    if (rows.length === 0 && interimRows.length === 0) {
      return {
        content: [{
          type: "text" as const,
          text: `未在数据库中找到 ${entity.name ?? company} (${entity.ticker ?? "N/A"}) 的年度或季度财务报表事实数据（可能尚未回填）。请使用 search_filings 检索年报/招股书原文。`,
        }],
        details: { count: 0 },
      };
    }

    // Group values by year and lineItem
    const dataByYear = new Map<number, Record<string, number>>();
    let reportingCurrency = "USD";

    for (const row of rows) {
      const d = new Date(row.period_end);
      const yr = d.getUTCFullYear();
      if (!dataByYear.has(yr)) {
        dataByYear.set(yr, {});
      }
      const numVal = Number(row.value);
      if (Number.isFinite(numVal)) {
        dataByYear.get(yr)![row.line_item] = numVal;
      }
      if (row.unit && ["USD", "CNY", "HKD", "EUR", "JPY", "INR", "CHF", "CAD", "AUD"].includes(row.unit)) {
        reportingCurrency = row.unit;
      }
    }

    // Apply two-stage stock split normalization across FY series
    normalizeNumericYearsStockSplits(dataByYear);

    // Compute derived metrics for each FY year
    for (const map of dataByYear.values()) {
      computeDerivedMetricsForMap(map);
    }

    // Build latestInterim snapshot if available
    let latestInterim: { label: string; items: Record<string, number> } | null = null;
    if (interimRows.length > 0) {
      const targetPeriodEnd = interimRows[0].period_end;
      const targetPeriodEndKey = new Date(targetPeriodEnd).toISOString().slice(0, 10);
      const targetPeriodType = interimRows[0].period_type ?? "Q";
      const interimYear = new Date(targetPeriodEnd).getUTCFullYear();
      const interimItems: Record<string, number> = {};
      for (const r of interimRows) {
        const rowPeriodEndKey = new Date(r.period_end).toISOString().slice(0, 10);
        if (rowPeriodEndKey !== targetPeriodEndKey || r.period_type !== targetPeriodType) continue;
        const numVal = Number(r.value);
        if (Number.isFinite(numVal) && !(r.line_item in interimItems)) {
          interimItems[r.line_item] = numVal;
        }
        if (r.unit && ["USD", "CNY", "HKD", "EUR", "JPY", "INR", "CHF", "CAD", "AUD"].includes(r.unit)) {
          reportingCurrency = r.unit;
        }
      }
      computeDerivedMetricsForMap(interimItems);
      // Do not annualize ROE on interim YTD snapshot
      delete interimItems["ROE"];
      latestInterim = {
        label: `${interimYear} ${targetPeriodType} (YTD)`,
        items: interimItems,
      };
    }

    const availableYears = [...dataByYear.keys()].sort((a, b) => b - a).slice(0, maxYears);

    // Determine target line items
    let targetKeys: string[] = [];

    if (inputLineItems && inputLineItems.length > 0) {
      const resolvedList: string[] = [];
      const missingList: string[] = [];

      for (const raw of inputLineItems) {
        const resolved = resolveFinancialLineItem(raw);
        if (resolved) {
          resolvedList.push(resolved);
        } else {
          missingList.push(raw);
        }
      }
      targetKeys = Array.from(new Set(resolvedList));

      // If user specifically asked for FCF ex-SBC or SBC, ensure FCF and SBC are included
      if (targetKeys.includes("FCF_Ex_SBC")) {
        if (!targetKeys.includes("FreeCashFlow")) targetKeys.unshift("FreeCashFlow");
        if (!targetKeys.includes("OperatingCashFlow")) targetKeys.unshift("OperatingCashFlow");
        if (!targetKeys.includes("CapEx")) targetKeys.unshift("CapEx");
      }
    } else if (statement && statement !== "all") {
      targetKeys = Object.values(FINANCIAL_ITEMS)
        .filter((item) => item.statement === statement)
        .map((item) => item.key);
    } else {
      // Default core summary set
      targetKeys = [
        "Revenue",
        "GrossProfit",
        "RnDExpense",
        "OperatingIncome",
        "NetIncome",
        "EPSDiluted",
        "OperatingCashFlow",
        "CapEx",
        "FreeCashFlow",
        "ShareBasedCompensation",
        "FCF_Ex_SBC",
        "TotalAssets",
        "TotalDebt",
        "ShareholdersEquity",
        "ROE",
        "FCFMargin",
      ];
    }

    // Filter to keys that have data in at least one year OR latestInterim OR were specifically requested by user
    const finalKeys = targetKeys.filter((k) => {
      if (inputLineItems && inputLineItems.length > 0) return true;
      return availableYears.some((yr) => dataByYear.get(yr)?.[k] != null) || latestInterim?.items[k] != null;
    });

    const companyLabel = entity.ticker ? `${entity.name ?? company} (${entity.ticker})` : entity.name ?? company;
    const tableMd = buildFinancialsMarkdown(
      companyLabel,
      reportingCurrency,
      availableYears,
      dataByYear,
      finalKeys,
      latestInterim,
    );

    // If SBC or RnD was requested but not populated, add an intelligent hint
    const hints: string[] = [];
    const hasSbcData = availableYears.some((yr) => dataByYear.get(yr)?.["ShareBasedCompensation"] != null);
    const hasRndData = availableYears.some((yr) => dataByYear.get(yr)?.["RnDExpense"] != null);

    if (inputLineItems?.some((i) => i.toLowerCase().includes("sbc") || i.includes("激励")) && !hasSbcData) {
      hints.push(
        `- **关于股权激励 (SBC)**: 在部分美国科技公司（如亚马逊 AMZN）的合并报表主表中，SBC 作为经营活动现金流附注的非现金调节项列示，主表标准化若未独立分离，可通过 \`search_filings(company="${entity.ticker ?? company}", section="financial", keyword="Stock-based compensation")\` 直接查得精确数值。`,
      );
    }
    if (inputLineItems?.some((i) => i.toLowerCase().includes("rnd") || i.includes("研发")) && !hasRndData) {
      hints.push(
        `- **关于研发费用 (R&D)**: 亚马逊 (AMZN) 会计准则将研发归入“技术与内容费用 (Technology and content)”，若主表标准化为独立 R&D 列，可通过 \`search_filings(company="${entity.ticker ?? company}", section="financial", keyword="Technology and content")\` 获取。`,
      );
    }

    const fullText = hints.length > 0 ? `${tableMd}\n\n**提示与说明**:\n${hints.join("\n")}` : tableMd;

    return {
      content: [{ type: "text" as const, text: fullText }],
      details: { count: finalKeys.length },
    };
  },
});
