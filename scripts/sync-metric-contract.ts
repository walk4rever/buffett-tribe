/**
 * Materialize the audited METRICS.md tables into a stable machine-readable
 * contract. Run after changing METRICS.md.
 *
 *   npm run sync:metrics
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  parseMetricContract,
  rolesForMetric,
  type MetricContractArtifact,
  type MetricContractBasis,
  type MetricContractRow,
} from "./lib/metric-contract-registry";
import { requirementForMetric } from "./lib/metric-contract-rules";

const METRICS_PATH = path.join(process.cwd(), "METRICS.md");
const OUTPUT_PATH = path.join(
  process.cwd(),
  "scripts",
  "lib",
  "metric-contract.json",
);

const KEY_BY_NAME: Record<string, string> = {
  营业收入: "revenue",
  营业成本: "cost_of_revenue",
  毛利润: "gross_profit",
  营业利润: "operating_income",
  净利润: "net_income",
  "摊薄 EPS": "eps.diluted",
  "基本 EPS": "eps.basic",
  总资产: "assets.total",
  总负债: "liabilities.total",
  股东权益: "equity.shareholders",
  总权益: "equity.total",
  现金及等价物: "cash_and_equivalents",
  短期有息债务: "debt.short_term",
  长期有息债务: "debt.long_term",
  总有息债务: "debt.total",
  经营现金流: "cash_flow.operating",
  资本开支: "capex",
  现金分红: "dividends_paid",
  股票回购: "share_repurchase",
  并购支出: "acquisitions",
  期末股数: "shares.period_end",
  加权平均稀释股数: "shares.weighted_diluted",
  研发费用: "rnd_expense",
  "合同负债/预收款": "contract_liabilities",
  "存货/开发成本": "inventory",
  投资性物业: "investment_property",
  营收同比: "revenue.growth",
  净利润同比: "net_income.growth",
  总资产同比: "assets.growth",
  毛利率: "gross_margin",
  营业利润率: "operating_margin",
  净利率: "net_margin",
  ROE: "roe",
  ROA: "roa",
  FCF: "free_cash_flow",
  "FCF Margin": "fcf_margin",
  现金转化率: "cash_conversion",
  总资产周转率: "asset_turnover",
  "负债/资产": "liabilities_to_assets",
  "账面权益/资产": "equity_to_assets",
  净负债率: "net_debt_ratio",
  ROIC: "roic",
  "5 年 CAGR": "cagr_5y",
  期末股数变化: "shares.change",
  每股已实施分红: "dividend_per_share",
  完整现金流年度: "capital.flow_coverage",
  累计经营现金流: "capital.cumulative_ocf",
  累计资本开支: "capital.cumulative_capex",
  累计自由现金流: "capital.cumulative_fcf",
  累计并购: "capital.cumulative_acquisitions",
  并购覆盖率: "capital.acquisitions_coverage",
  累计回购: "capital.cumulative_buybacks",
  累计分红: "capital.cumulative_dividends",
  股东回报: "capital.shareholder_return",
  "FCF 扣除分配结余": "capital.fcf_after_distributions",
  净利润减分红回购差额: "capital.retained_difference",
  最新收盘价: "valuation.price_latest",
  市值: "valuation.market_cap",
  当前PE: "valuation.pe_current",
  当前PB: "valuation.pb_current",
  BPS: "valuation.bps",
  历史PE走廊: "valuation.pe_history",
  历史PB走廊: "valuation.pb_history",
  "历史PE/PB中位数": "valuation.multiple_median",
  历史估值分位: "valuation.percentile",
  "参考PE/PB": "valuation.benchmark_multiple",
  FCFYield: "valuation.fcf_yield",
  PE估值走廊: "valuation.pe_band",
  PB估值走廊: "valuation.pb_band",
  PE情景回报: "valuation.pe_scenario",
  "PB-ROE情景回报": "valuation.pb_roe_scenario",
  净利息收入: "bank.net_interest_income",
  贷款净额: "bank.net_loans",
  客户存款: "bank.deposits",
  信用减值损失: "bank.provision",
  NIM: "bank.nim",
  不良贷款: "bank.npl",
  不良贷款率: "bank.npl_ratio",
  贷款损失准备: "bank.loan_loss_allowance",
  拨备覆盖率: "bank.provision_coverage",
  "CET1比率": "bank.cet1",
  净已赚保费: "insurance.net_premiums",
  赔付与保单利益: "insurance.claims",
  赔付率: "insurance.claims_ratio",
  综合成本率: "insurance.combined_ratio",
  投资资产组合: "insurance.investments",
  净投资收益: "insurance.net_investment_income",
  保险合同负债: "insurance.contract_liabilities",
  浮存金: "insurance.float",
  EV: "insurance.ev",
  NBV: "insurance.nbv",
  新业务价值率: "insurance.vnb_margin",
  偿付能力充足率: "insurance.solvency",
  NOI: "real_estate.noi",
  FFO: "real_estate.ffo",
  AFFO: "real_estate.affo",
  "同店NOI增长": "real_estate.same_store_noi_growth",
  出租率: "real_estate.occupancy",
  "FFO/股": "real_estate.ffo_per_share",
  合同负债: "real_estate.contract_liabilities",
  分部收入: "conglomerate.segment_revenue",
  分部经营利润: "conglomerate.segment_profit",
  分部资产: "conglomerate.segment_assets",
  上市投资组合市值: "conglomerate.listed_investments_value",
  保险浮存金: "conglomerate.insurance_float",
  AUM: "financial_services.aum",
  客户净流量: "financial_services.net_client_flows",
  管理费收入: "financial_services.management_fee",
  手续费及佣金净收入: "financial_services.fee_income",
  有效费率: "financial_services.effective_fee_rate",
  消费品牌: "modifier.consumer_brand",
  医药健康: "modifier.healthcare",
  软件平台: "modifier.software_platform",
  半导体硬件: "modifier.semiconductor",
  能源材料: "modifier.energy",
  公用事业: "modifier.utilities",
  电信: "modifier.telecom",
};

function prefixFor(section: MetricContractRow["section"]) {
  const prefixes: Record<MetricContractRow["section"], string> = {
    general_raw: "GR",
    general_derived: "GD",
    capital_allocation: "CA",
    valuation: "VL",
    bank: "BK",
    insurance: "IN",
    real_estate: "RE",
    conglomerate: "CG",
    financial_services: "FS",
    modifier: "MOD",
  };
  return prefixes[section];
}

function basisFor(row: MetricContractRow): MetricContractBasis {
  if (row.section === "general_raw") return "reported" as const;
  if (row.section === "general_derived" || row.section === "capital_allocation") {
    return "derived" as const;
  }
  if (row.name === "最新收盘价") return "reported" as const;
  if (["PE情景回报", "PB-ROE情景回报"].includes(row.name)) {
    return "modeled" as const;
  }
  if (
    [
      "净利息收入",
      "客户存款",
      "净已赚保费",
      "赔付与保单利益",
      "保险合同负债",
      "AUM",
      "客户净流量",
      "管理费收入",
      "手续费及佣金净收入",
      "EV",
      "NBV",
      "FFO",
      "AFFO",
      "出租率",
    ].includes(row.name)
  ) {
    return "reported" as const;
  }
  return "reported_or_derived" as const;
}

function main() {
  const rows = parseMetricContract(
    readFileSync(METRICS_PATH, "utf8"),
  ).filter((row) => row.status !== "排除");
  const counters = new Map<string, number>();
  const seenKeys = new Set<string>();
  const metrics = rows.map((row) => {
    const prefix = prefixFor(row.section);
    const count = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, count);
    const id = `${prefix}-${String(count).padStart(2, "0")}`;
    const key =
      row.section === "real_estate" && row.name === "存货/开发成本"
        ? "real_estate.inventory"
        : (KEY_BY_NAME[row.name] ??
          KEY_BY_NAME[row.name.replace(/\s+/g, "")]);
    if (!key) throw new Error(`Missing stable metric key for ${row.name}`);
    if (seenKeys.has(key)) throw new Error(`Duplicate metric key: ${key}`);
    seenKeys.add(key);
    return {
      ...row,
      id,
      key,
      basis: basisFor(row),
      roles: rolesForMetric(row),
      requirement: requirementForMetric(row),
    };
  });

  const contract: MetricContractArtifact = {
    version: 1,
    source: "METRICS.md",
    metrics,
  };
  const serialized = `${JSON.stringify(contract, null, 2)}\n`;
  if (process.argv.includes("--check")) {
    const current = readFileSync(OUTPUT_PATH, "utf8");
    if (current !== serialized) {
      throw new Error(
        `${OUTPUT_PATH} is stale; run npm run sync:metrics`,
      );
    }
    console.log(`Verified ${metrics.length} metrics in ${OUTPUT_PATH}`);
    return;
  }
  writeFileSync(OUTPUT_PATH, serialized);
  console.log(`Wrote ${metrics.length} metrics to ${OUTPUT_PATH}`);
}

main();
