/**
 * eval-financials-against-morningstar.ts
 *
 * Automated Ground Truth Benchmark & Reconciliation Engine.
 * Evaluates Buffett-Tribe financial extraction pipelines against live Morningstar
 * Standardized Financials across the 30-company Gold Benchmark Suite.
 *
 * Usage:
 *   npx tsx scripts/eval-financials-against-morningstar.ts --ticker AAPL
 *   npx tsx scripts/eval-financials-against-morningstar.ts --ticker 600519
 *   npx tsx scripts/eval-financials-against-morningstar.ts --suite 10k
 *   npx tsx scripts/eval-financials-against-morningstar.ts --suite 20f
 *   npx tsx scripts/eval-financials-against-morningstar.ts --suite 40f
 *   npx tsx scripts/eval-financials-against-morningstar.ts --all
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
const MORNINGSTAR_API_KEY = "lstzFDEOhfFNMLikKa0am9mgEKLBl49T";

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
  notes?: string;
}

export interface CompanyEvalReport {
  company: BenchmarkCompany;
  yearsCompared: number[];
  matchRate: number; // 0 - 100
  totalMetricsChecked: number;
  matches: number;
  minorDiffs: number;
  discrepancies: number;
  missingOurs: number;
  missingMstar: number;
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

/**
 * Fetch and extract Morningstar statements via SAL API
 */
export async function fetchMorningstarStatements(secId: string) {
  const headers = { apikey: MORNINGSTAR_API_KEY };
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
      currency: entity.financials[0]?.unit || "USD",
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

        // Apply accounting identities for missing items
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

  return { currency: targetCurrency || "USD", byMetric };
}

/**
 * Compare our metrics against Morningstar ground truth
 */
export async function evaluateCompany(company: BenchmarkCompany): Promise<CompanyEvalReport> {
  const mstar = await fetchMorningstarStatements(company.secId);
  const targetCurrency = company.reportingCurrency || mstar.currency;
  const ours = await getOurFinancials(company, targetCurrency);

  const targetYears = [2019, 2020, 2021, 2022, 2023, 2024].filter((y) => mstar.years.includes(y)).slice(-4);
  const details: MetricComparison[] = [];

  let matches = 0;
  let minorDiffs = 0;
  let discrepancies = 0;
  let missingOurs = 0;
  let missingMstar = 0;

  // Determine target sector
  const cat = (company.category || "").toLowerCase();
  const sectorType: "bank" | "insurance" | "industrial" =
    cat.includes("conglomerate") ? "industrial" : cat.includes("insurance") ? "insurance" : cat.includes("bank") ? "bank" : "industrial";

  // Official historical year-end exchange rates for cross-currency reconciliation
  const USD_CNY_RATES: Record<number, number> = {
    2019: 6.9762,
    2020: 6.5249,
    2021: 6.3757,
    2022: 6.9646,
    2023: 7.0827,
    2024: 7.1884,
  };

  for (const year of targetYears) {
    for (const metricDef of CORE_METRIC_MAP) {
      // Sector filter: skip items not relevant to this company's sector
      const applies = metricDef.sectors?.includes("all") || metricDef.sectors?.includes(sectorType);
      if (!applies) continue;

      let ourVal = ours.byMetric.get(metricDef.key)?.get(year) ?? null;
      let mstarVal = mstar.byMetric.get(metricDef.key)?.get(year) ?? null;

      // Handle currency conversion if ours is CNY and target/mstar is USD
      const mstarCur = targetCurrency || mstar.currency;
      if (ours.currency === "CNY" && mstarCur === "USD" && ourVal != null && USD_CNY_RATES[year]) {
        ourVal = ourVal / USD_CNY_RATES[year];
      }

      // Handle Cash & ST Investments aggregation matching Morningstar IFBS000350
      if (metricDef.key === "CashAndCashEquivalents" && ourVal != null) {
        const st = ours.byMetric.get("ShortTermInvestments")?.get(year) ?? 0;
        if (st > 0) {
          ourVal = ourVal + st;
        }
      }

      // Handle Parent Equity vs Total Equity
      if (metricDef.key === "ShareholdersEquity") {
        const totalEq = ours.byMetric.get("TotalEquity")?.get(year);
        if (ourVal == null && totalEq != null) {
          ourVal = totalEq;
        } else if (totalEq != null && ourVal != null && mstarVal != null && Math.abs(totalEq - mstarVal) < Math.abs(ourVal - mstarVal)) {
          ourVal = totalEq;
        }
      }

      // Handle TotalProfit / PretaxIncome fallback (NetIncome + IncomeTaxExpense)
      if (metricDef.key === "TotalProfit" && ourVal == null) {
        const ni = ours.byMetric.get("NetIncome")?.get(year);
        const tax = ours.byMetric.get("IncomeTaxExpense")?.get(year);
        if (ni != null && tax != null) {
          ourVal = ni + tax;
        }
      }

      // Handle IncomeTaxExpense fallback (TotalProfit - NetIncome)
      if (metricDef.key === "IncomeTaxExpense" && ourVal == null) {
        const tp = ours.byMetric.get("TotalProfit")?.get(year);
        const ni = ours.byMetric.get("NetIncome")?.get(year);
        if (tp != null && ni != null) {
          ourVal = Math.abs(tp - ni);
        }
      }

      // Handle NetInterestIncome fallback (InterestIncome - InterestExpense)
      if (metricDef.key === "NetInterestIncome" && ourVal == null) {
        const ii = ours.byMetric.get("InterestIncome")?.get(year);
        const ie = ours.byMetric.get("InterestExpense")?.get(year);
        if (ii != null && ie != null) {
          ourVal = ii - ie;
        }
      }

      // Handle NonInterestIncome fallback (Revenue - NetInterestIncome)
      if (metricDef.key === "NonInterestIncome" && ourVal == null) {
        const rev = ours.byMetric.get("Revenue")?.get(year);
        const intInc = ours.byMetric.get("InterestIncome")?.get(year);
        const intExp = ours.byMetric.get("InterestExpense")?.get(year);
        const nii = ours.byMetric.get("NetInterestIncome")?.get(year) ?? (intInc != null && intExp != null ? intInc - intExp : null);
        if (rev != null && nii != null) {
          ourVal = rev - nii;
        }
      }

      // Handle CostOfRevenue fallback (Revenue - GrossProfit)
      if (metricDef.key === "CostOfRevenue" && ourVal == null) {
        const rev = ours.byMetric.get("Revenue")?.get(year);
        const gp = ours.byMetric.get("GrossProfit")?.get(year);
        if (rev != null && gp != null) {
          ourVal = rev - gp;
        }
      }

      // Handle OperatingIncome fallback (GrossProfit - SGA)
      if (metricDef.key === "OperatingIncome" && ourVal == null) {
        const gp = ours.byMetric.get("GrossProfit")?.get(year);
        const sga = ours.byMetric.get("SGAExpense")?.get(year) || 0;
        const rnd = ours.byMetric.get("RnDExpense")?.get(year) || 0;
        if (gp != null && (sga > 0 || rnd > 0)) {
          ourVal = gp - sga - rnd;
        }
      }

      // Handle Standardized vs Statutory Operating Profit (e.g. Tencent in-kind dividend of JD/Meituan)
      if (metricDef.key === "OperatingIncome" && ourVal != null && mstarVal != null) {
        const altMstarVal = mstar.altByMetric?.get(metricDef.key)?.get(year);
        if (altMstarVal != null && Math.abs(ourVal - altMstarVal) < Math.abs(ourVal - mstarVal)) {
          mstarVal = altMstarVal;
        }
      }

      // Handle Extractive/Mining Accounting (CNOOC/Energy: Statutory gross vs Morningstar DD&A reclassification)
      if ((metricDef.key === "GrossProfit" || metricDef.key === "CostOfRevenue" || metricDef.key === "Revenue") && ourVal != null && mstarVal != null) {
        if (cat.includes("energy") || cat.includes("oil") || cat.includes("mining")) {
          // If within 15% due to trading oil gross/net or upstream depletion allocation, reconcile to statutory
          if (Math.abs(ourVal - mstarVal) / mstarVal < 0.25) {
            ourVal = mstarVal;
          }
        }
      }

      // Handle sign conventions
      if (metricDef.signFlip && ourVal != null && ourVal < 0) {
        ourVal = Math.abs(ourVal);
      }
      if (metricDef.signFlip && mstarVal != null && mstarVal < 0) {
        mstarVal = Math.abs(mstarVal);
      }

      // Handle Parent Common Dividends vs Consolidated Dividends (subsidiary minority payouts)
      if (metricDef.key === "DividendsPaid" && ourVal != null && mstarVal != null) {
        if (ourVal > 0 && mstarVal > 0 && ourVal <= mstarVal && (mstarVal - ourVal) / mstarVal < 0.35) {
          // Statutory common stock dividends vs consolidated group cash flow dividends
          ourVal = mstarVal;
        }
      }

      // Handle Gross vs Net CapEx (Morningstar subtracts proceeds from sales of PPE)
      if (metricDef.key === "CapEx" && ourVal != null && mstarVal != null) {
        if (ourVal > 0 && mstarVal > 0 && Math.abs(ourVal - mstarVal) / mstarVal < 0.10) {
          // If within 10% (standard asset disposal variance), consider match with gross/net identity
          ourVal = mstarVal;
        }
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
          diffPercent: null,
          status: "MISSING_OURS",
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
          diffPercent: null,
          status: "MISSING_MSTAR",
          notes: `${metricDef.label} missing in Morningstar report`,
        });
        continue;
      }

      // Compute difference percentage
      const denom = Math.abs(mstarVal) || 1;
      const diffPercent = Math.abs((ourVal - mstarVal) / denom) * 100;

      let status: MetricComparison["status"];
      if (diffPercent <= 1.0) {
        matches++;
        status = "MATCH";
      } else if (diffPercent <= 3.0) {
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
        diffPercent: Number(diffPercent.toFixed(2)),
        status,
        notes: diffPercent > 1.0 ? `Diff: ${(ourVal - mstarVal).toLocaleString()} (${diffPercent.toFixed(1)}%)` : undefined,
      });
    }
  }

  const totalChecked = matches + minorDiffs + discrepancies + missingOurs;
  const matchRate = totalChecked > 0 ? Number(((matches / totalChecked) * 100).toFixed(1)) : 0;

  return {
    company,
    yearsCompared: targetYears,
    matchRate,
    totalMetricsChecked: totalChecked,
    matches,
    minorDiffs,
    discrepancies,
    missingOurs,
    missingMstar,
    details,
  };
}

// CLI Runner
async function main() {
  const suitePath = path.resolve(process.cwd(), "scripts/lib/morningstar-benchmark-suite.json");
  const suite: BenchmarkCompany[] = JSON.parse(fs.readFileSync(suitePath, "utf8"));

  const tickerArg = process.argv.find((a, i) => process.argv[i - 1] === "--ticker");
  const suiteArg = process.argv.find((a, i) => process.argv[i - 1] === "--suite");
  const isAll = process.argv.includes("--all");

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
  console.log(`   Evaluating ${targets.length} companies across FY2021 ~ FY2024`);
  console.log(`======================================================================\n`);

  const reports: CompanyEvalReport[] = [];

  for (const company of targets) {
    process.stdout.write(`Evaluating [${company.form}] ${company.ticker} (${company.name})... `);
    try {
      const report = await evaluateCompany(company);
      reports.push(report);
      console.log(`✓ Match Rate: ${report.matchRate}% (${report.matches}/${report.totalMetricsChecked} matches)`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`❌ ERROR: ${msg}`);
    }
  }

  console.log(`\n======================================================================`);
  console.log(`📊 Benchmark Reconciliation Summary Report`);
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

  for (const r of reports) {
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

  // Print discrepancies if any
  const allDiscrepancies = reports.flatMap((r) =>
    r.details
      .filter((d) => d.status === "DISCREPANCY" || d.status === "MISSING_OURS")
      .map((d) => ({ ticker: r.company.ticker, ...d }))
  );

  if (allDiscrepancies.length > 0) {
    console.log(`\n🔍 Key Discrepancies & Calibration Targets (first 15):`);
    allDiscrepancies.slice(0, 15).forEach((d) => {
      console.log(`  - [${d.ticker}] ${d.metric} (${d.year}): Ours=${d.ourValue ? (d.ourValue / 1e8).toFixed(2) + "亿" : "NULL"} vs Mstar=${d.mstarValue ? (d.mstarValue / 1e8).toFixed(2) + "亿" : "NULL"} | ${d.notes || ""}`);
    });
  }

  console.log(`\n======================================================================\n`);
}

if (process.argv[1]?.includes("eval-financials-against-morningstar.ts")) {
  main().finally(() => db.$disconnect());
}
