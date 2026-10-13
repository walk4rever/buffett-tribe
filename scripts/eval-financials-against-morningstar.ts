/**
 * eval-financials-against-morningstar.ts
 *
 * Ground-truth reconciliation engine: Buffett-Tribe financial extraction vs
 * Morningstar Standardized Financials across the 100-company Gold Benchmark Suite.
 *
 * Two scoring modes:
 *
 *   raw         Strict comparison. Only unit / currency / sign normalization is
 *               applied before diffing — no accounting identities, no metric
 *               aggregation, no tolerance overrides. This is the honest score:
 *               it measures the extraction pipeline, not the evaluator.
 *   calibrated  raw + accounting-identity derivation and metric aggregation
 *               applied at eval time. Every adjustment is recorded on the
 *               comparison row in `adjustments[]`, so the delta against `raw`
 *               is fully auditable.
 *
 * These eval-time patches used to be invisible, and included tolerance
 * overrides that simply overwrote our value with Morningstar's whenever the gap
 * was small enough (energy/mining ±25%, dividends ±35%, CapEx ±10%), plus two
 * "whichever number is closer to Morningstar" pickers. They are now confined to
 * `calibrated` and recorded. The evaluator must never consult the Morningstar
 * value when deciding how to derive or select ours — that turns the benchmark
 * into an answer key.
 *
 * Usage:
 *   npx tsx scripts/eval-financials-against-morningstar.ts --all                 # raw, whole suite
 *   npx tsx scripts/eval-financials-against-morningstar.ts --all --both          # raw + calibrated
 *   npx tsx scripts/eval-financials-against-morningstar.ts --ticker AAPL
 *   npx tsx scripts/eval-financials-against-morningstar.ts --suite 20f
 *   npx tsx scripts/eval-financials-against-morningstar.ts --years 5
 *   npx tsx scripts/eval-financials-against-morningstar.ts --all --refresh-baseline
 *   npx tsx scripts/eval-financials-against-morningstar.ts --compare-baseline
 *
 * Morningstar ground truth is snapshotted to .cache/morningstar-snapshots/ so
 * scores are reproducible and a Morningstar restatement surfaces as a baseline
 * diff instead of an unexplained score move. Results are written to
 * tests/evals/history/.
 *
 * Requires MORNINGSTAR_API_KEY in .env.local (never commit it) and DIRECT_URL.
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { PrismaClient } from "@prisma/client";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  ANNUAL_FORMS,
  LINE_ITEMS,
  getCompanyFacts,
} from "./lib/annual-report-import-core";
import {
  fetchSecSubmissions,
  pickRecentAnnualFilings,
  fetchAllAnnualFilings,
} from "./lib/sec-company-profile";

const db = new PrismaClient();

export type EvalMode = "raw" | "calibrated";

// MATCH is deliberately tight: only ±1% counts as a hit. MINOR_DIFF (±3%) is
// reported but not counted as a match.
const MATCH_THRESHOLD_PERCENT = 1.0;
const MINOR_DIFF_THRESHOLD_PERCENT = 3.0;

// Evaluation window: the most recent N fiscal years present in the Morningstar
// payload. Deliberately not a hardcoded calendar range, so newly filed years
// (e.g. FY2025) enter the benchmark automatically instead of never being tested.
const MIN_EVAL_YEAR = 2019;
const DEFAULT_EVAL_WINDOW_YEARS = 5;

const SNAPSHOT_DIR = path.join(process.cwd(), ".cache", "morningstar-snapshots");
const RESULTS_DIR = path.join(process.cwd(), "tests", "evals", "history");
const SUITE_PATH = path.join(process.cwd(), "scripts", "lib", "morningstar-benchmark-suite.json");

let evalWindowYears = DEFAULT_EVAL_WINDOW_YEARS;
let refreshBaseline = false;
let snapshotHits = 0;
let snapshotFetches = 0;

/**
 * Year-end CNY-per-USD rates, used only to bring our values onto the currency
 * basis Morningstar reports in. Official year-end reference rates (PBOC), not
 * interpolated. Add a row per new fiscal year — a missing year is reported as
 * `fx:no-rate(...)` rather than silently treated as 1:1.
 */
const YEAR_END_CNY_PER_USD: Record<number, number> = {
  2019: 6.9762,
  2020: 6.5249,
  2021: 6.3757,
  2022: 6.9646,
  2023: 7.0827,
  2024: 7.1884,
};

/**
 * Units of `from` per one unit of `to`, at that fiscal year's year-end.
 * Only the pairs the suite actually needs are defined; anything else returns
 * null and the comparison is flagged rather than guessed at.
 */
function fxRate(from: string, to: string, year: number): number | null {
  if (from === to) return 1;
  if (from === "CNY" && to === "USD") return YEAR_END_CNY_PER_USD[year] ?? null;
  return null;
}

function requireMstarKey(): string {
  const key = process.env.MORNINGSTAR_API_KEY;
  if (!key) {
    throw new Error(
      "MORNINGSTAR_API_KEY is not set. Add it to .env.local (never commit it).",
    );
  }
  return key;
}

export interface BenchmarkCompany {
  ticker: string;
  name: string;
  market: "us" | "cn" | "hk";
  form: string;
  secId: string;
  category: string;
  cik?: string;
  reportingCurrency?: string;
}

export interface MetricComparison {
  metric: string;
  year: number;
  ourValue: number | null;
  mstarValue: number | null;
  diffPercent: number | null;
  status: "MATCH" | "MINOR_DIFF" | "DISCREPANCY" | "MISSING_OURS" | "MISSING_MSTAR";
  /** Our value before any currency/sign/identity adjustment, for audit. */
  rawOurValue?: number | null;
  /** Named adjustments applied to our value, e.g. "fx:CNY->USD@7.1884", "sign-flip". */
  adjustments?: string[];
  notes?: string;
}

export interface CompanyEvalReport {
  company: BenchmarkCompany;
  mode: EvalMode;
  yearsCompared: number[];
  matchRate: number; // 0 - 100
  totalMetricsChecked: number;
  matches: number;
  minorDiffs: number;
  discrepancies: number;
  missingOurs: number;
  missingMstar: number;
  fxConverted: number;
  fxUnconverted: number;
  details: MetricComparison[];
}

export interface MetricDef {
  key: string;
  label: string;
  mstarId: string;
  altMstarId?: string;
  statement: "incomeStatement" | "balanceSheet" | "cashFlow";
  signFlip?: boolean;
  sectors?: Array<"industrial" | "bank" | "insurance" | "all">;
}

// 跨行业通用基石指标 + 行业专属指标
export const CORE_METRIC_MAP: MetricDef[] = [
  // 1. 全球全行业 100% 通用基石指标
  { key: "Revenue", label: "营业总收入 (Total Revenue)", mstarId: "IFIS001170", statement: "incomeStatement", sectors: ["all"] },
  { key: "TotalProfit", label: "利润总额 / 税前利润 (Pretax Income)", mstarId: "IFIS001490", statement: "incomeStatement", sectors: ["all"] },
  { key: "IncomeTaxExpense", label: "所得税费用 (Income Tax)", mstarId: "IFIS001560", statement: "incomeStatement", signFlip: true, sectors: ["all"] },
  { key: "NetIncome", label: "归母净利润 (Net Income)", mstarId: "IFIS001100", statement: "incomeStatement", sectors: ["all"] },
  { key: "TotalAssets", label: "资产总计 (Total Assets)", mstarId: "IFBS002270", statement: "balanceSheet", sectors: ["all"] },
  { key: "TotalLiabilities", label: "负债总计 (Total Liabilities)", mstarId: "IFBS002646", statement: "balanceSheet", sectors: ["all"] },
  { key: "ShareholdersEquity", label: "股东权益 (Equity)", mstarId: "IFBS200140", statement: "balanceSheet", sectors: ["all"] },
  { key: "OperatingCashFlow", label: "经营现金流 (OCF)", mstarId: "IFCF000150", statement: "cashFlow", sectors: ["all"] },
  { key: "InvestingCashFlow", label: "投资现金流 (ICF)", mstarId: "IFCF000140", statement: "cashFlow", sectors: ["all"] },
  { key: "FinancingCashFlow", label: "筹资现金流 (FCF)", mstarId: "IFCF000130", statement: "cashFlow", sectors: ["all"] },
  { key: "DividendsPaid", label: "分红派息 (Dividends Paid)", mstarId: "IFCF002150", statement: "cashFlow", signFlip: true, sectors: ["all"] },

  // 2. 传统工商业专属科目 (制造业、科技、消费、能源)
  { key: "CostOfRevenue", label: "营业成本 (Cost of Revenue)", mstarId: "IFIS000200", statement: "incomeStatement", signFlip: true, sectors: ["industrial"] },
  { key: "GrossProfit", label: "毛利润 (Gross Profit)", mstarId: "IFIS000590", statement: "incomeStatement", sectors: ["industrial"] },
  { key: "OperatingIncome", label: "营业利润 (Operating Income)", mstarId: "IFIS001230", altMstarId: "IFIS003138", statement: "incomeStatement", sectors: ["industrial"] },
  { key: "TotalCurrentAssets", label: "流动资产 (Current Assets)", mstarId: "IFBS000470", statement: "balanceSheet", sectors: ["industrial"] },
  { key: "TotalCurrentLiabilities", label: "流动负债 (Current Liabilities)", mstarId: "IFBS000500", statement: "balanceSheet", sectors: ["industrial"] },
  { key: "CashAndCashEquivalents", label: "现金及现金等价物 (Cash & Equiv)", mstarId: "IFBS000350", statement: "balanceSheet", sectors: ["industrial"] },
  { key: "CapEx", label: "资本开支 (CapEx Net)", mstarId: "IFCF001330", statement: "cashFlow", signFlip: true, sectors: ["industrial"] },

  // 3. 商业银行业专属科目
  { key: "NetInterestIncome", label: "利息净收入 (Net Interest Income)", mstarId: "IFIS001120", statement: "incomeStatement", sectors: ["bank"] },
  { key: "NonInterestIncome", label: "非利息收入 (Non-Interest Income)", mstarId: "IFIS003140", statement: "incomeStatement", sectors: ["bank"] },
  { key: "NetLoans", label: "客户贷款净额 (Net Loans)", mstarId: "IFBS100702", statement: "balanceSheet", sectors: ["bank"] },
  { key: "TotalDeposits", label: "客户存款总额 (Total Deposits)", mstarId: "IFBS002300", statement: "balanceSheet", sectors: ["bank"] },
  { key: "ProvisionForCreditLosses", label: "贷款减值准备计提 (Loan Loss Provision)", mstarId: "IFIS200280", statement: "incomeStatement", signFlip: true, sectors: ["bank"] },

  // 4. 保险业专属科目
  { key: "NetPremiumsEarned", label: "已赚保费净额 (Net Premiums Earned)", mstarId: "IFIS001480", statement: "incomeStatement", sectors: ["insurance"] },
  { key: "NetInvestmentIncome", label: "净投资收益 (Net Investment Income)", mstarId: "IFIS001130", statement: "incomeStatement", sectors: ["insurance"] },
  { key: "TotalInvestments", label: "投资资产总计 (Total Investments)", mstarId: "IFBS003343", statement: "balanceSheet", sectors: ["insurance"] },
  { key: "InsuranceContractLiabilities", label: "保险合同负债 (Insurance Liabilities)", mstarId: "IFBS200610", statement: "balanceSheet", sectors: ["insurance"] },
  { key: "PolicyClaimsAndBenefits", label: "赔付支出净额 (Policy Claims & Losses)", mstarId: "IFIS001420", statement: "incomeStatement", signFlip: true, sectors: ["insurance"] },
];

/* eslint-disable @typescript-eslint/no-explicit-any -- raw Morningstar payloads are
   consumed structurally below; typing them precisely buys nothing. */
interface MstarRawPayload {
  fetchedAt: string;
  isData: any;
  bsData: any;
  cfData: any;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function snapshotPath(secId: string): string {
  return path.join(SNAPSHOT_DIR, `${secId}.json`);
}

/**
 * Pull the raw Morningstar payload, preferring the on-disk snapshot so scores
 * stay reproducible. Pass --refresh-baseline to re-fetch from the API.
 */
async function fetchMorningstarRaw(secId: string): Promise<MstarRawPayload> {
  const file = snapshotPath(secId);
  if (!refreshBaseline && fs.existsSync(file)) {
    snapshotHits++;
    return JSON.parse(fs.readFileSync(file, "utf8")) as MstarRawPayload;
  }

  const headers = { apikey: requireMstarKey() };
  const fetchStmt = async (type: "incomeStatement" | "balanceSheet" | "cashFlow") => {
    const url = `https://api-global.morningstar.com/sal-service/v1/stock/newfinancials/${secId}/${type}/detail?clientId=MDC&version=4.71.0&dataType=A&reportType=R`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Morningstar API ${type} returned ${res.status}`);
    return await res.json();
  };

  const [isData, bsData, cfData] = await Promise.all([
    fetchStmt("incomeStatement"),
    fetchStmt("balanceSheet"),
    fetchStmt("cashFlow"),
  ]);

  const payload: MstarRawPayload = {
    fetchedAt: new Date().toISOString(),
    isData,
    bsData,
    cfData,
  };
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload));
  snapshotFetches++;
  return payload;
}

/**
 * Fetch and extract Morningstar statements via SAL API (snapshot-backed)
 */
export async function fetchMorningstarStatements(secId: string) {
  const { isData, bsData, cfData } = await fetchMorningstarRaw(secId);

  const years: string[] = isData.columnDefs || [];
  const magnitude = isData.footer?.orderOfMagnitude === "Billion" ? 1e9 : 1e6; // default Million = 1e6
  const currency = isData.footer?.currency || "USD";

  interface MorningstarRow {
    dataPointId?: string;
    datum?: unknown[];
    subLevel?: MorningstarRow[];
  }

  function findRow(rows: MorningstarRow[] | undefined, id: string): MorningstarRow | null {
    for (const r of rows || []) {
      if (r.dataPointId === id) return r;
      if (r.subLevel) {
        const found = findRow(r.subLevel, id);
        if (found) return found;
      }
    }
    return null;
  }

  // Map: metricId -> { year -> value }
  const byMetric = new Map<string, Map<number, number>>();
  const altByMetric = new Map<string, Map<number, number>>();

  for (const m of CORE_METRIC_MAP) {
    const data = m.statement === "incomeStatement" ? isData : m.statement === "balanceSheet" ? bsData : cfData;
    const row = findRow(data.rows as MorningstarRow[], m.mstarId);
    const yearMap = new Map<number, number>();
    if (row && Array.isArray(row.datum)) {
      row.datum.forEach((val: unknown, idx: number) => {
        const yrStr = years[idx];
        const yr = Number(yrStr);
        if (!isNaN(yr) && typeof val === "number") {
          yearMap.set(yr, val * magnitude);
        }
      });
    }
    byMetric.set(m.key, yearMap);

    if (m.altMstarId) {
      const altRow = findRow(data.rows as MorningstarRow[], m.altMstarId);
      const altYearMap = new Map<number, number>();
      if (altRow && Array.isArray(altRow.datum)) {
        altRow.datum.forEach((val: unknown, idx: number) => {
          const yrStr = years[idx];
          const yr = Number(yrStr);
          if (!isNaN(yr) && typeof val === "number") {
            altYearMap.set(yr, val * magnitude);
          }
        });
      }
      altByMetric.set(m.key, altYearMap);
    }
  }

  return { years: years.map(Number).filter((y) => !isNaN(y)), currency, byMetric, altByMetric };
}

/**
 * Extract financial items from our database or live SEC Facts
 */
export async function getOurFinancials(
  company: BenchmarkCompany,
  targetCurrency?: string,
  opts: { applyIdentities?: boolean } = {},
): Promise<{
  currency: string;
  byMetric: Map<string, Map<number, number>>;
}> {
  const byMetric = new Map<string, Map<number, number>>();
  CORE_METRIC_MAP.forEach((m) => byMetric.set(m.key, new Map()));
  LINE_ITEMS.forEach((item) => {
    if (!byMetric.has(item.key)) byMetric.set(item.key, new Map());
  });

  const raw = company.ticker;
  const bare = raw.replace(".HK", "").replace("-", ".");
  const entities = await db.entity.findMany({
    where: {
      OR: [
        { ticker: raw },
        { ticker: `${raw}.SS` },
        { ticker: `${raw}.SZ` },
        { code: bare },
        { ticker: bare },
        { ticker: `${bare}.HK` },
      ],
    },
    include: {
      financials: {
        where: { periodType: "FY" },
        orderBy: { periodEnd: "desc" },
      },
    },
  });
  const entity = entities.find((e) => e.financials.length > 0) || entities[0];

  const dbCurrency = entity?.financials?.find((f) => f.unit && f.unit !== "shares" && !f.unit.includes("/"))?.unit || "USD";
  const isUsForeignWithMismatch = company.market === "us" && (company.form === "20-F" || company.form === "40-F") && !!targetCurrency && !!dbCurrency && targetCurrency !== dbCurrency;
  if (entity && entity.financials.length > 0 && !isUsForeignWithMismatch) {
    for (const fin of entity.financials) {
      if (fin.value == null) continue;
      const rawYear = fin.periodEnd.getUTCFullYear();
      const month = fin.periodEnd.getUTCMonth();
      const day = fin.periodEnd.getUTCDate();
      const year = (month === 0 && day <= 15) ? rawYear - 1 : rawYear;
      const numVal = Number(fin.value.toString());
      if (!byMetric.has(fin.lineItem)) {
        byMetric.set(fin.lineItem, new Map());
      }
      byMetric.get(fin.lineItem)!.set(year, numVal);
    }
    return {
      // Must be the filtered unit: Financial rows mix money amounts with share
      // counts and ratios, and financials[0] is frequently "shares". Returning
      // that silently disabled FX conversion for the whole company.
      currency: dbCurrency,
      byMetric,
    };
  }

  // 2. If US company not yet in DB, extract live from SEC CompanyFacts
  if (company.market === "us") {
    let cik = company.cik;
    if (!cik) {
      const tickerClean = company.ticker.replace("-", "").toUpperCase();
      const secTickersRes = await fetch("https://www.sec.gov/files/company_tickers.json", {
        headers: { "User-Agent": "buffett-tribe research walkklaw@gmail.com" },
      });
      if (secTickersRes.ok) {
        const secTickers = (await secTickersRes.json()) as Record<string, { ticker?: string; cik_str?: string | number }>;
        for (const row of Object.values(secTickers)) {
          if (row.ticker?.toUpperCase() === tickerClean) {
            cik = String(row.cik_str).padStart(10, "0");
            break;
          }
        }
      }
    }

    if (cik) {
      const facts = await getCompanyFacts(cik);
      const rootSub = await fetchSecSubmissions(cik);
      let filings = pickRecentAnnualFilings(rootSub);
      if (filings.length < 4 && rootSub.filings?.files?.length) {
        filings = await fetchAllAnnualFilings(cik);
      }

      const gaap = facts.facts?.["us-gaap"] ?? {};
      const ifrs = facts.facts?.["ifrs-full"] ?? {};

      // Prefer target currency (e.g. TWD for TSM, CNY for BABA, USD for AAPL)
      const preferredUnits = targetCurrency ? [targetCurrency, "USD", "CNY", "HKD"] : ["USD", "CNY", "HKD"];

      // Process filings unique by reportDate
      const seenDates = new Set<string>();
      for (const filing of filings) {
        if (seenDates.has(filing.reportDate)) continue;
        seenDates.add(filing.reportDate);
        const d = new Date(filing.reportDate);
        const rawYear = d.getUTCFullYear();
        const month = d.getUTCMonth();
        const day = d.getUTCDate();
        const year = (month === 0 && day <= 15) ? rawYear - 1 : rawYear;
        const reportDate = filing.reportDate;

        for (const item of LINE_ITEMS) {
          const conceptSets = [
            { concepts: gaap, tags: item.tagsUsGaap },
            { concepts: ifrs, tags: item.tagsIfrs },
          ];

          const candidates: Array<{ filed: string; val: number }> = [];

          for (const set of conceptSets) {
            for (const tag of set.tags) {
              const concept = set.concepts[tag];
              if (!concept?.units) continue;

              let rowsToCheck: Array<{ end?: string; val?: number; form?: string; filed?: string; start?: string }> = [];
              if (targetCurrency && concept.units?.[targetCurrency]) {
                rowsToCheck = concept.units[targetCurrency];
              } else {
                const preferredUnitRows = preferredUnits.flatMap((u) => concept.units?.[u] ?? []);
                rowsToCheck = preferredUnitRows.length > 0 ? preferredUnitRows : Object.values(concept.units).flat();
              }

              for (const row of rowsToCheck) {
                if (!row || row.end !== reportDate || typeof row.val !== "number") continue;
                if (!ANNUAL_FORMS.has(row.form ?? "")) continue;

                if (item.periodType === "duration" && row.start) {
                  const days = (new Date(row.end).getTime() - new Date(row.start).getTime()) / 86400000;
                  if (days < 300) continue;
                }

                candidates.push({
                  filed: row.filed ?? "0000-00-00",
                  val: row.val,
                });
              }

              if (candidates.length) break;
            }
            if (candidates.length) break;
          }

          if (candidates.length > 0) {
            candidates.sort((a, b) => (a.filed < b.filed ? 1 : -1));
            const bestVal = candidates[0].val;
            if (byMetric.has(item.key)) {
              byMetric.get(item.key)!.set(year, bestVal);
            }
          }
        }

        // Accounting-identity derivation for the live-SEC fallback path. Gated
        // on `applyIdentities` so raw mode scores the pipeline's own output.
        // (The DB path never derived anything; that asymmetry is exactly what
        // the raw score is meant to expose.)
        if (opts.applyIdentities) {
          const assets = byMetric.get("TotalAssets")?.get(year);
          const equity = byMetric.get("ShareholdersEquity")?.get(year);
          if (assets != null && equity != null && !byMetric.get("TotalLiabilities")?.has(year)) {
            byMetric.get("TotalLiabilities")!.set(year, assets - equity);
          }

          const rev = byMetric.get("Revenue")?.get(year);
          const cost = byMetric.get("CostOfRevenue")?.get(year);
          const gp = byMetric.get("GrossProfit")?.get(year);
          if (rev != null && cost != null && gp == null) {
            byMetric.get("GrossProfit")!.set(year, rev - cost);
          } else if (rev != null && gp != null && cost == null) {
            byMetric.get("CostOfRevenue")!.set(year, rev - gp);
          }

          const intInc = byMetric.get("InterestIncome")?.get(year);
          const intExp = byMetric.get("InterestExpense")?.get(year);
          if (intInc != null && intExp != null && !byMetric.get("NetInterestIncome")?.has(year)) {
            byMetric.get("NetInterestIncome")!.set(year, intInc - intExp);
          }

          const netInt = byMetric.get("NetInterestIncome")?.get(year);
          if (rev != null && netInt != null && !byMetric.get("NonInterestIncome")?.has(year)) {
            byMetric.get("NonInterestIncome")!.set(year, rev - netInt);
          }
        }
      }
    }
  }

  return { currency: targetCurrency || "USD", byMetric };
}

/**
 * Compare our metrics against Morningstar ground truth
 */
/**
 * Prepare one of our metric values for comparison: normalize口径, and in
 * calibrated mode apply the accounting-identity derivations that belong in the
 * ingestion pipeline. Returns the value plus every named adjustment applied, so
 * the gap between `raw` and `calibrated` is fully attributable.
 *
 * Deliberately never consults the Morningstar value. An evaluator that looks at
 * the answer key while preparing the answer is not measuring anything.
 */
function prepareOurMetricValue(args: {
  metricDef: MetricDef;
  ours: { currency: string; byMetric: Map<string, Map<number, number>> };
  year: number;
  mode: EvalMode;
}): { value: number | null; adjustments: string[] } {
  const { metricDef, ours, year, mode } = args;
  const adjustments: string[] = [];
  const get = (key: string) => ours.byMetric.get(key)?.get(year) ?? null;

  let value = get(metricDef.key);

  // Cash & short-term investments (Morningstar IFBS000350) is an aggregation of
  // two of our line items, so it applies on top of a present value rather than
  // filling in a missing one.
  if (mode === "calibrated" && metricDef.key === "CashAndCashEquivalents" && value != null) {
    const sti = get("ShortTermInvestments");
    if (sti != null && sti > 0) {
      value = value + sti;
      adjustments.push("aggregate:+ShortTermInvestments");
    }
  }

  if (mode !== "calibrated" || value != null) {
    return { value, adjustments };
  }

  // Calibrated-only: identities the pipeline is expected to have applied already.
  switch (metricDef.key) {
    case "TotalProfit": {
      const ni = get("NetIncome");
      const tax = get("IncomeTaxExpense");
      if (ni != null && tax != null) {
        value = ni + tax;
        adjustments.push("identity:TotalProfit=NetIncome+IncomeTax");
      }
      break;
    }
    case "IncomeTaxExpense": {
      const tp = get("TotalProfit");
      const ni = get("NetIncome");
      if (tp != null && ni != null) {
        value = Math.abs(tp - ni);
        adjustments.push("identity:Tax=|TotalProfit-NetIncome|");
      }
      break;
    }
    case "NetInterestIncome": {
      const ii = get("InterestIncome");
      const ie = get("InterestExpense");
      if (ii != null && ie != null) {
        value = ii - ie;
        adjustments.push("identity:NetInterestIncome=InterestIncome-InterestExpense");
      }
      break;
    }
    case "NonInterestIncome": {
      const rev = get("Revenue");
      const ii = get("InterestIncome");
      const ie = get("InterestExpense");
      const nii = get("NetInterestIncome") ?? (ii != null && ie != null ? ii - ie : null);
      if (rev != null && nii != null) {
        value = rev - nii;
        adjustments.push("identity:NonInterestIncome=Revenue-NetInterestIncome");
      }
      break;
    }
    case "CostOfRevenue": {
      const rev = get("Revenue");
      const gp = get("GrossProfit");
      if (rev != null && gp != null) {
        value = rev - gp;
        adjustments.push("identity:CostOfRevenue=Revenue-GrossProfit");
      }
      break;
    }
    case "OperatingIncome": {
      const gp = get("GrossProfit");
      const sga = get("SGAExpense");
      const rnd = get("RnDExpense");
      // Only derive when an expense input actually exists. Defaulting a missing
      // SG&A to 0 would manufacture an operating profit out of nothing.
      if (gp != null && (sga != null || rnd != null)) {
        value = gp - (sga ?? 0) - (rnd ?? 0);
        adjustments.push("identity:OperatingIncome=GrossProfit-SGA-RnD");
      }
      break;
    }
    case "ShareholdersEquity": {
      const totalEq = get("TotalEquity");
      if (totalEq != null) {
        value = totalEq;
        adjustments.push("fallback:TotalEquity");
      }
      break;
    }
    default:
      break;
  }

  return { value, adjustments };
}

export async function evaluateCompany(
  company: BenchmarkCompany,
  mode: EvalMode = "raw",
): Promise<CompanyEvalReport> {
  const mstar = await fetchMorningstarStatements(company.secId);
  const ours = await getOurFinancials(company, company.reportingCurrency, {
    applyIdentities: mode === "calibrated",
  });

  // Window is the most recent N years Morningstar reports — never a hardcoded
  // calendar range, so a freshly filed year enters the benchmark on its own.
  const targetYears = mstar.years
    .filter((y) => y >= MIN_EVAL_YEAR)
    .sort((a, b) => a - b)
    .slice(-evalWindowYears);
  const details: MetricComparison[] = [];

  let matches = 0;
  let minorDiffs = 0;
  let discrepancies = 0;
  let missingOurs = 0;
  let missingMstar = 0;
  let fxConverted = 0;
  let fxUnconverted = 0;

  // Determine target sector
  const cat = (company.category || "").toLowerCase();
  const sectorType: "bank" | "insurance" | "industrial" =
    cat.includes("conglomerate") ? "industrial" : cat.includes("insurance") ? "insurance" : cat.includes("bank") ? "bank" : "industrial";

  // Currency basis. `mstar.currency` is the response footer, i.e. the *listing*
  // currency — it disagrees with the values for most foreign filers (TSM: footer
  // USD with TWD values; 0700.HK: footer HKD with CNY values), so it must never
  // be used as a conversion basis. The suite's `reportingCurrency` does match
  // the values: for 98/100 companies it equals our DB unit, and the remaining
  // two (1299.HK, 688981) are USD there against CNY here.
  const mstarValueCurrency = company.reportingCurrency;

  for (const year of targetYears) {
    for (const metricDef of CORE_METRIC_MAP) {
      // Sector filter: skip items not relevant to this company's sector
      const applies = metricDef.sectors?.includes("all") || metricDef.sectors?.includes(sectorType);
      if (!applies) continue;

      const rawOurValue = ours.byMetric.get(metricDef.key)?.get(year) ?? null;
      const prepared = prepareOurMetricValue({ metricDef, ours, year, mode });
      let ourVal = prepared.value;
      const adjustments = [...prepared.adjustments];

      // Currency normalization (both modes — a cross-currency diff is
      // meaningless otherwise). Applies only where the suite declares the
      // currency Morningstar's numbers are in; an undeclared company is compared
      // as-is and flagged, rather than converted on a guessed basis.
      if (ourVal != null && mstarValueCurrency && ours.currency !== mstarValueCurrency) {
        const rate = fxRate(ours.currency, mstarValueCurrency, year);
        if (rate != null) {
          ourVal = ourVal / rate;
          adjustments.push(`fx:${ours.currency}->${mstarValueCurrency}@${rate}`);
          fxConverted++;
        } else {
          adjustments.push(`fx:no-rate(${ours.currency}->${mstarValueCurrency},${year})`);
          fxUnconverted++;
        }
      }

      let mstarVal = mstar.byMetric.get(metricDef.key)?.get(year) ?? null;

      // Morningstar sometimes exposes two data points for one concept. Use the
      // primary id, fall back to the alt only when the primary is absent. The
      // previous code picked whichever was closer to ours — that is grading
      // your own homework against a key you get to edit.
      if (mstarVal == null && metricDef.altMstarId) {
        const alt = mstar.altByMetric?.get(metricDef.key)?.get(year) ?? null;
        if (alt != null) {
          mstarVal = alt;
          adjustments.push("mstar:alt-id");
        }
      }

      // Sign conventions: Morningstar reports cost/tax/dividend items negative.
      if (metricDef.signFlip) {
        if (ourVal != null && ourVal < 0) {
          ourVal = Math.abs(ourVal);
          adjustments.push("sign-flip");
        }
        if (mstarVal != null && mstarVal < 0) mstarVal = Math.abs(mstarVal);
      }

      if (ourVal == null && mstarVal == null) {
        continue; // Not reported by either, ignore
      }

      if (ourVal == null) {
        missingOurs++;
        details.push({
          metric: metricDef.key,
          year,
          ourValue: null,
          mstarValue: mstarVal,
          rawOurValue,
          diffPercent: null,
          status: "MISSING_OURS",
          adjustments: adjustments.length > 0 ? adjustments : undefined,
          notes: `${metricDef.label} missing in our dataset`,
        });
        continue;
      }

      if (mstarVal == null) {
        missingMstar++;
        details.push({
          metric: metricDef.key,
          year,
          ourValue: ourVal,
          mstarValue: null,
          rawOurValue,
          diffPercent: null,
          status: "MISSING_MSTAR",
          adjustments: adjustments.length > 0 ? adjustments : undefined,
          notes: `${metricDef.label} missing in Morningstar report`,
        });
        continue;
      }

      // Denominator uses the larger magnitude of the two (floored at 1), so a
      // near-zero peer value can't manufacture a five-digit percentage diff.
      const absDiff = Math.abs(ourVal - mstarVal);
      const denom = Math.max(Math.abs(ourVal), Math.abs(mstarVal), 1);
      const diffPercent = (absDiff / denom) * 100;

      let status: MetricComparison["status"];
      if (diffPercent <= MATCH_THRESHOLD_PERCENT) {
        matches++;
        status = "MATCH";
      } else if (diffPercent <= MINOR_DIFF_THRESHOLD_PERCENT) {
        minorDiffs++;
        status = "MINOR_DIFF";
      } else {
        discrepancies++;
        status = "DISCREPANCY";
      }

      details.push({
        metric: metricDef.key,
        year,
        ourValue: ourVal,
        mstarValue: mstarVal,
        rawOurValue,
        diffPercent: Number(diffPercent.toFixed(2)),
        status,
        adjustments: adjustments.length > 0 ? adjustments : undefined,
        notes: status === "MATCH" ? undefined : `Diff: ${(ourVal - mstarVal).toLocaleString()} (${diffPercent.toFixed(1)}%)`,
      });
    }
  }

  const totalChecked = matches + minorDiffs + discrepancies + missingOurs;
  const matchRate = totalChecked > 0 ? Number(((matches / totalChecked) * 100).toFixed(1)) : 0;

  return {
    company,
    mode,
    yearsCompared: targetYears,
    matchRate,
    totalMetricsChecked: totalChecked,
    matches,
    minorDiffs,
    discrepancies,
    missingOurs,
    missingMstar,
    fxConverted,
    fxUnconverted,
    details,
  };
}

// CLI Runner

interface EvalRunReport {
  generatedAt: string;
  mode: EvalMode;
  windowYears: number;
  suiteSize: number;
  summary: {
    meanMatchRate: number;
    companiesAtOrAbove80: number;
    companiesAt100: number;
    totalMetricsChecked: number;
    matches: number;
    minorDiffs: number;
    discrepancies: number;
    missingOurs: number;
    missingMstar: number;
    fxConverted: number;
    fxUnconverted: number;
    /** Suite entries with no declared reportingCurrency — compared as-is. */
    undeclaredCurrencyBasis: number;
  };
  companies: CompanyEvalReport[];
}

function summarize(reports: CompanyEvalReport[], mode: EvalMode): EvalRunReport {
  const sum = (pick: (r: CompanyEvalReport) => number) => reports.reduce((acc, r) => acc + pick(r), 0);
  return {
    generatedAt: new Date().toISOString(),
    mode,
    windowYears: evalWindowYears,
    suiteSize: reports.length,
    summary: {
      meanMatchRate: reports.length
        ? Number((sum((r) => r.matchRate) / reports.length).toFixed(2))
        : 0,
      companiesAtOrAbove80: reports.filter((r) => r.matchRate >= 80).length,
      companiesAt100: reports.filter((r) => r.matchRate === 100).length,
      totalMetricsChecked: sum((r) => r.totalMetricsChecked),
      matches: sum((r) => r.matches),
      minorDiffs: sum((r) => r.minorDiffs),
      discrepancies: sum((r) => r.discrepancies),
      missingOurs: sum((r) => r.missingOurs),
      missingMstar: sum((r) => r.missingMstar),
      fxConverted: sum((r) => r.fxConverted),
      fxUnconverted: sum((r) => r.fxUnconverted),
      undeclaredCurrencyBasis: reports.filter((r) => !r.company.reportingCurrency).length,
    },
    companies: reports,
  };
}

function printSummary(run: EvalRunReport) {
  console.log(`\n======================================================================`);
  console.log(`📊 Morningstar Reconciliation — mode: ${run.mode}, FY window: last ${run.windowYears}y`);
  console.log(`======================================================================`);
  console.log(
    `Ticker`.padEnd(10) +
    `Form`.padEnd(10) +
    `Match Rate`.padEnd(14) +
    `Matches`.padEnd(10) +
    `Minor Diff`.padEnd(12) +
    `Discrepancy`.padEnd(14) +
    `Missing (Ours)`.padEnd(14)
  );
  console.log(`-`.repeat(84));

  for (const r of run.companies) {
    console.log(
      r.company.ticker.padEnd(10) +
      r.company.form.padEnd(10) +
      `${r.matchRate}%`.padEnd(14) +
      String(r.matches).padEnd(10) +
      String(r.minorDiffs).padEnd(12) +
      String(r.discrepancies).padEnd(14) +
      String(r.missingOurs).padEnd(14)
    );
  }

  const s = run.summary;
  console.log(`-`.repeat(84));
  console.log(`Mean match rate: ${s.meanMatchRate}%  |  ≥80%: ${s.companiesAtOrAbove80}/${run.suiteSize}  |  =100%: ${s.companiesAt100}/${run.suiteSize}`);
  console.log(`MATCH ${s.matches}  MINOR ${s.minorDiffs}  DISCREPANCY ${s.discrepancies}  MISSING_OURS ${s.missingOurs}  MISSING_MSTAR ${s.missingMstar}`);
  if (s.fxUnconverted > 0) {
    console.log(`⚠️  ${s.fxUnconverted} comparisons have no FX rate for the required pair — see adjustments[] = fx:no-rate(...)`);
  }
  if (s.undeclaredCurrencyBasis > 0) {
    console.log(`ℹ️  ${s.undeclaredCurrencyBasis}/${run.suiteSize} suite entries declare no reportingCurrency, so their FX basis is assumed to already match ours.`);
  }

  const allDiscrepancies = run.companies.flatMap((r) =>
    r.details
      .filter((d) => d.status === "DISCREPANCY" || d.status === "MISSING_OURS")
      .map((d) => ({ ticker: r.company.ticker, ...d }))
  );

  if (allDiscrepancies.length > 0) {
    console.log(`\n🔍 Key Discrepancies & Calibration Targets (first 15):`);
    allDiscrepancies.slice(0, 15).forEach((d) => {
      const fmt = (v: number | null | undefined) => (v == null ? "NULL" : (v / 1e8).toFixed(2) + "亿");
      const adj = d.adjustments?.length ? ` [${d.adjustments.join(", ")}]` : "";
      console.log(`  - [${d.ticker}] ${d.metric} (${d.year}): Ours=${fmt(d.ourValue)} vs Mstar=${fmt(d.mstarValue)} | ${d.notes || ""}${adj}`);
    });
  }
}

function persistRun(run: EvalRunReport): string {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = run.generatedAt.replace(/[:.]/g, "-");
  const file = path.join(RESULTS_DIR, `morningstar-${run.mode}-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(run, null, 2));
  console.log(`\n💾 Saved: ${path.relative(process.cwd(), file)}`);
  return file;
}

function previousRunFile(mode: EvalMode, currentFile: string): string | null {
  if (!fs.existsSync(RESULTS_DIR)) return null;
  const files = fs
    .readdirSync(RESULTS_DIR)
    .filter((f) => f.startsWith(`morningstar-${mode}-`) && f.endsWith(".json"))
    .map((f) => path.join(RESULTS_DIR, f))
    .filter((f) => f !== currentFile)
    .sort();
  return files.length > 0 ? files[files.length - 1] : null;
}

function printBaselineDiff(run: EvalRunReport, currentFile: string) {
  const prevFile = previousRunFile(run.mode, currentFile);
  if (!prevFile) {
    console.log(`\n📉 --compare-baseline: no previous "${run.mode}" run found — this run becomes the baseline.`);
    return;
  }
  const prev = JSON.parse(fs.readFileSync(prevFile, "utf8")) as EvalRunReport;
  console.log(`\n📉 Baseline diff vs ${path.basename(prevFile)} (generated ${prev.generatedAt})`);

  const prevByTicker = new Map(prev.companies.map((c) => [c.company.ticker, c]));
  const moves: string[] = [];
  for (const cur of run.companies) {
    const before = prevByTicker.get(cur.company.ticker);
    if (!before) {
      moves.push(`  + ${cur.company.ticker}: new in suite (${cur.matchRate}%)`);
      continue;
    }
    const delta = Number((cur.matchRate - before.matchRate).toFixed(1));
    if (Math.abs(delta) >= 1) {
      moves.push(`  ${delta > 0 ? "▲" : "▼"} ${cur.company.ticker}: ${before.matchRate}% → ${cur.matchRate}% (${delta > 0 ? "+" : ""}${delta}pt)`);
    }
  }
  for (const ticker of prevByTicker.keys()) {
    if (!run.companies.some((c) => c.company.ticker === ticker)) {
      moves.push(`  - ${ticker}: dropped from suite`);
    }
  }

  const key = (t: string, m: string, y: number) => `${t}|${m}|${y}`;
  const before = new Map<string, MetricComparison["status"]>();
  for (const c of prev.companies) {
    for (const d of c.details) before.set(key(c.company.ticker, d.metric, d.year), d.status);
  }
  const regressions: string[] = [];
  const fixes: string[] = [];
  for (const c of run.companies) {
    for (const d of c.details) {
      const was = before.get(key(c.company.ticker, d.metric, d.year));
      if (was === d.status) continue;
      if (d.status === "DISCREPANCY" && was && was !== "DISCREPANCY") regressions.push(`  ${c.company.ticker} ${d.metric} FY${d.year}: ${was} → DISCREPANCY`);
      else if (was === "DISCREPANCY" && d.status !== "DISCREPANCY") fixes.push(`  ${c.company.ticker} ${d.metric} FY${d.year}: DISCREPANCY → ${d.status}`);
    }
  }

  console.log(`\n  Match-rate moves (≥1pt): ${moves.length}`);
  moves.slice(0, 20).forEach((m) => console.log(m));
  console.log(`\n  New discrepancies: ${regressions.length}`);
  regressions.slice(0, 20).forEach((m) => console.log(m));
  console.log(`\n  Resolved discrepancies: ${fixes.length}`);
  fixes.slice(0, 20).forEach((m) => console.log(m));
}

/**
 * Show what calibrating at eval time buys us: the delta between strict `raw`
 * and `calibrated`. A large gap means the ingestion pipeline is not applying
 * accounting identities it should be applying at write time.
 */
function printModeDelta(raw: EvalRunReport, calibrated: EvalRunReport) {
  console.log(`\n======================================================================`);
  console.log(`🔬 raw vs calibrated`);
  console.log(`   mean ${raw.summary.meanMatchRate}% (raw) vs ${calibrated.summary.meanMatchRate}% (calibrated) → eval-time patches buy +${(calibrated.summary.meanMatchRate - raw.summary.meanMatchRate).toFixed(2)}pt`);
  console.log(`   ≥80%: ${raw.summary.companiesAtOrAbove80}/${raw.suiteSize} vs ${calibrated.summary.companiesAtOrAbove80}/${calibrated.suiteSize}`);
  console.log(`   =100%: ${raw.summary.companiesAt100}/${raw.suiteSize} vs ${calibrated.summary.companiesAt100}/${calibrated.suiteSize}`);
  console.log(`   DISCREPANCY: ${raw.summary.discrepancies} vs ${calibrated.summary.discrepancies}`);

  const calByTicker = new Map(calibrated.companies.map((c) => [c.company.ticker, c.matchRate]));
  const deltas = raw.companies
    .map((c) => ({ ticker: c.company.ticker, delta: Number(((calByTicker.get(c.company.ticker) ?? c.matchRate) - c.matchRate).toFixed(1)) }))
    .filter((d) => Math.abs(d.delta) >= 0.5)
    .sort((a, b) => b.delta - a.delta);
  if (deltas.length > 0) {
    console.log(`\n   Companies most dependent on eval-time calibration:`);
    deltas.slice(0, 15).forEach((d) => console.log(`     ${d.ticker}: +${d.delta}pt`));
  }
}

async function runSuite(targets: BenchmarkCompany[], mode: EvalMode): Promise<CompanyEvalReport[]> {
  const reports: CompanyEvalReport[] = [];
  for (const company of targets) {
    process.stdout.write(`[${mode}] Evaluating [${company.form}] ${company.ticker} (${company.name})... `);
    try {
      const report = await evaluateCompany(company, mode);
      reports.push(report);
      console.log(`✓ Match Rate: ${report.matchRate}% (${report.matches}/${report.totalMetricsChecked} matches)`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`❌ ERROR: ${msg}`);
    }
  }
  return reports;
}

async function main() {
  const suite: BenchmarkCompany[] = JSON.parse(fs.readFileSync(SUITE_PATH, "utf8"));

  const tickerArg = process.argv.find((a, i) => process.argv[i - 1] === "--ticker");
  const suiteArg = process.argv.find((a, i) => process.argv[i - 1] === "--suite");
  const yearsArg = process.argv.find((a, i) => process.argv[i - 1] === "--years");
  const isAll = process.argv.includes("--all");
  const bothMode = process.argv.includes("--both");
  const compareBaseline = process.argv.includes("--compare-baseline");
  refreshBaseline = process.argv.includes("--refresh-baseline");

  if (yearsArg) {
    const n = Number(yearsArg);
    if (!Number.isInteger(n) || n <= 0) throw new Error(`--years expects a positive integer, got "${yearsArg}"`);
    evalWindowYears = n;
  }

  const modes: EvalMode[] = bothMode
    ? ["raw", "calibrated"]
    : [process.argv.includes("--calibrated") ? "calibrated" : "raw"];

  let targets = suite;
  if (tickerArg) {
    targets = suite.filter((c) => c.ticker.toUpperCase() === tickerArg.toUpperCase());
  } else if (suiteArg) {
    if (suiteArg === "10k") targets = suite.filter((c) => c.form === "10-K");
    else if (suiteArg === "20f") targets = suite.filter((c) => c.form === "20-F");
    else if (suiteArg === "40f") targets = suite.filter((c) => c.form === "40-F");
    else if (suiteArg === "cn") targets = suite.filter((c) => c.market === "cn");
    else if (suiteArg === "hk") targets = suite.filter((c) => c.market === "hk");
  } else if (!isAll) {
    // Default: run first 5 representative cross-market companies
    targets = [
      suite.find((c) => c.ticker === "AAPL")!,
      suite.find((c) => c.ticker === "BABA")!,
      suite.find((c) => c.ticker === "TSM")!,
      suite.find((c) => c.ticker === "SHOP")!,
      suite.find((c) => c.ticker === "600519")!,
    ].filter(Boolean);
  }

  console.log(`\n======================================================================`);
  console.log(`🚀 Buffett-Tribe vs Morningstar Ground Truth Benchmark Reconciliation`);
  console.log(`   ${targets.length} companies | window: last ${evalWindowYears} fiscal years | mode(s): ${modes.join(", ")}`);
  console.log(`   snapshots: ${refreshBaseline ? "refreshing from API" : "from .cache/morningstar-snapshots"}`);
  console.log(`======================================================================\n`);

  const runs: EvalRunReport[] = [];
  for (const mode of modes) {
    const reports = await runSuite(targets, mode);
    const run = summarize(reports, mode);
    printSummary(run);
    const file = persistRun(run);
    if (compareBaseline) printBaselineDiff(run, file);
    runs.push(run);
  }

  if (runs.length === 2) printModeDelta(runs[0], runs[1]);

  console.log(`\n   Morningstar snapshots: ${snapshotHits} cached, ${snapshotFetches} fetched`);
  console.log(`======================================================================\n`);
}

if (process.argv[1]?.includes("eval-financials-against-morningstar.ts")) {
  main().finally(() => db.$disconnect());
}
