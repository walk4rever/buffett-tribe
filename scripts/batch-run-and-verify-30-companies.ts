import { execSync } from "node:child_process";
import db from "../src/lib/prisma";
import { backfillCompanyFinancialsFast } from "./backfill-company-financials-fast";
import { getCompanyFinancials } from "../src/lib/company-data";
import { computeCapitalAllocationStats } from "../src/lib/capital-allocation-metrics";
import { buildCompanyFinancialDashboard } from "../src/lib/company-financial-dashboard";

const US_COMPANIES = [
  "AAPL", "MSFT", "KO", "GOOGL", "COST", "BRK-B", "NVDA", "JNJ", "JPM", "AMZN"
];

const CN_COMPANIES: Array<{ code: string; ticker: string; currency: "CNY" }> = [
  { code: "600519", ticker: "600519.SS", currency: "CNY" },
  { code: "300750", ticker: "300750.SZ", currency: "CNY" },
  { code: "002594", ticker: "002594.SZ", currency: "CNY" },
  { code: "600036", ticker: "600036.SS", currency: "CNY" },
  { code: "601088", ticker: "601088.SS", currency: "CNY" },
  { code: "600900", ticker: "600900.SS", currency: "CNY" },
  { code: "600887", ticker: "600887.SS", currency: "CNY" },
  { code: "002415", ticker: "002415.SZ", currency: "CNY" },
  { code: "000002", ticker: "000002.SZ", currency: "CNY" },
  { code: "600660", ticker: "600660.SS", currency: "CNY" },
];

const HK_COMPANIES: Array<{ code: string; ticker: string; currency: "CNY" | "HKD" | "USD" }> = [
  { code: "00700", ticker: "0700.HK", currency: "CNY" },
  { code: "09988", ticker: "9988.HK", currency: "CNY" },
  { code: "03690", ticker: "3690.HK", currency: "CNY" },
  { code: "09992", ticker: "9992.HK", currency: "CNY" },
  { code: "02020", ticker: "2020.HK", currency: "CNY" },
  { code: "00291", ticker: "0291.HK", currency: "CNY" },
  { code: "00992", ticker: "0992.HK", currency: "USD" },
  { code: "00669", ticker: "0669.HK", currency: "USD" },
  { code: "00388", ticker: "0388.HK", currency: "HKD" },
  { code: "00981", ticker: "0981.HK", currency: "USD" },
];

interface CompanyReport {
  market: "US" | "CN" | "HK";
  symbol: string;
  name: string;
  fyRowsCount: number;
  distinctLineItems: number;
  yearsCovered: string[];
  hasRevenue: boolean;
  hasNetIncome: boolean;
  hasTotalAssets: boolean;
  hasTotalLiabilities: boolean;
  hasOperatingCashFlow: boolean;
  hasCapEx: boolean;
  hasDividends: boolean;
  hasRepurchases: boolean;
  financialsOk: boolean;
  capitalAllocationOk: boolean;
  dashboardOk: boolean;
  notes?: string;
}

async function verifyCompany(entityId: string, market: "US" | "CN" | "HK", symbol: string): Promise<CompanyReport> {
  const entity = await db.entity.findUnique({
    where: { id: entityId },
    select: { id: true, canonicalName: true, sector: true, metadata: true, sectorModelType: true },
  });
  const meta = (entity?.metadata || {}) as Record<string, unknown>;
  const name = (meta.nameZh as string) || entity?.canonicalName || symbol;
  const currency = (meta.currency as string) || (market === "CN" ? "CNY" : market === "HK" ? "HKD" : "USD");

  const multiYearFinancials = await getCompanyFinancials(entityId, 7);
  const recentFinancials = await db.financial.findMany({
    where: {
      entityId,
      periodType: "FY",
      periodEnd: { gte: new Date("2020-01-01") },
    },
    orderBy: { periodEnd: "asc" },
  });

  const years = Array.from(new Set(recentFinancials.map((f) => f.periodEnd.getUTCFullYear().toString())));
  const items = new Set(recentFinancials.map((f) => f.lineItem));

  let capitalAllocationOk = false;
  try {
    const annualInputs = multiYearFinancials.map((f) => ({
      year: f.year,
      operatingCashFlow: Number(f.items["OperatingCashFlow"]) || null,
      capEx: Number(f.items["CapEx"]) || null,
      repurchaseAmt: Number(f.items["ShareRepurchaseAmt"]) || null,
      dividendsPaid: Number(f.items["DividendsPaid"]) || null,
      shares: Number(f.items["CommonStockSharesOutstanding"]) || null,
      roe: null,
    }));
    const ca = computeCapitalAllocationStats(annualInputs);
    capitalAllocationOk = ca.periodCount > 0;
  } catch (e) {
    capitalAllocationOk = false;
  }

  let dashboardOk = false;
  try {
    const dash = buildCompanyFinancialDashboard(
      {
        sector: entity?.sector || null,
        metadata: entity?.metadata || null,
        sectorModelType: entity?.sectorModelType || null,
      },
      multiYearFinancials,
      currency,
    );
    dashboardOk = Boolean(dash && dash.rows?.length > 0 && dash.displayYears?.length > 0);
  } catch (e) {
    dashboardOk = false;
  }

  return {
    market,
    symbol,
    name,
    fyRowsCount: recentFinancials.length,
    distinctLineItems: items.size,
    yearsCovered: years,
    hasRevenue: items.has("Revenue"),
    hasNetIncome: items.has("NetIncome"),
    hasTotalAssets: items.has("TotalAssets"),
    hasTotalLiabilities: items.has("TotalLiabilities"),
    hasOperatingCashFlow: items.has("OperatingCashFlow"),
    hasCapEx: items.has("CapEx"),
    hasDividends: items.has("DividendsPaid"),
    hasRepurchases: items.has("ShareRepurchaseAmt"),
    financialsOk: multiYearFinancials.length >= 4,
    capitalAllocationOk,
    dashboardOk,
  };
}

async function main() {
  console.log("===============================================================================");
  console.log("Starting 30-Company Canonical Financial Ingestion & Downstream Verification");
  console.log("Scope: FY2020 ~ present (Audited Statutory Primary Statements & Capital Allocation)");
  console.log("===============================================================================\n");

  const reports: CompanyReport[] = [];

  // 1. Process US Companies
  console.log("\n>>> [1/3] Processing 10 US Companies (SEC EDGAR Fast Direct Pipeline)...");
  for (const ticker of US_COMPANIES) {
    console.log(`\n--- [US] Ingesting ${ticker} ---`);
    const entity = await db.entity.findFirst({
      where: { ticker: { in: [ticker, ticker.replace("-", ".")] }, cik: { not: null } },
      select: { id: true, cik: true, ticker: true },
    });
    if (!entity || !entity.cik) {
      console.error(`Entity or CIK not found for ${ticker}`);
      continue;
    }
    try {
      const res = await backfillCompanyFinancialsFast({
        entityId: entity.id,
        cik: entity.cik,
        ticker: entity.ticker,
        fromYear: 2020,
      });
      console.log(`  Upserted ${res.financialRowsUpserted} financial rows across years [${res.years.join(", ")}] in ${res.durationMs}ms`);
      const rep = await verifyCompany(entity.id, "US", ticker);
      reports.push(rep);
    } catch (err: unknown) {
      console.error(`  Failed ${ticker}:`, (err as Error).message);
    }
  }

  // 2. Process CN Companies
  console.log("\n>>> [2/3] Processing 10 CN A-Share Companies (Sina/Cninfo Canonical Pipeline)...");
  for (const item of CN_COMPANIES) {
    console.log(`\n--- [CN] Ingesting ${item.code} (${item.ticker}) ---`);
    const entity = await db.entity.findFirst({
      where: { market: "cn", code: item.code },
      select: { id: true },
    });
    if (!entity) {
      console.error(`Entity not found for CN code ${item.code}`);
      continue;
    }
    try {
      const cmd = `.venv/bin/python scripts/fetch-cn-hk-financials-ak.py --code ${item.code} --market cn --currency ${item.currency} --from-year 2020 --import-db`;
      execSync(cmd, { stdio: "inherit" });
      const rep = await verifyCompany(entity.id, "CN", item.code);
      reports.push(rep);
    } catch (err: unknown) {
      console.error(`  Failed ${item.code}:`, (err as Error).message);
    }
  }

  // 3. Process HK Companies
  console.log("\n>>> [3/3] Processing 10 HK Companies (Eastmoney Canonical Pipeline)...");
  for (const item of HK_COMPANIES) {
    console.log(`\n--- [HK] Ingesting ${item.code} (${item.ticker}) ---`);
    const entity = await db.entity.findFirst({
      where: { market: "hk", code: item.code },
      select: { id: true },
    });
    if (!entity) {
      console.error(`Entity not found for HK code ${item.code}`);
      continue;
    }
    try {
      const cmd = `.venv/bin/python scripts/fetch-cn-hk-financials-ak.py --code ${item.code} --market hk --currency ${item.currency} --from-year 2020 --import-db`;
      execSync(cmd, { stdio: "inherit" });
      const rep = await verifyCompany(entity.id, "HK", item.code);
      reports.push(rep);
    } catch (err: unknown) {
      console.error(`  Failed ${item.code}:`, (err as Error).message);
    }
  }

  // 4. Output Comprehensive Verification Matrix
  console.log("\n\n===============================================================================");
  console.log("30-COMPANY CANONICAL FINANCIAL VERIFICATION SUMMARY MATRIX (FY2020 - PRESENT)");
  console.log("===============================================================================");
  console.table(
    reports.map((r) => ({
      Mkt: r.market,
      Symbol: r.symbol,
      Name: r.name.slice(0, 10),
      "FY Rows": r.fyRowsCount,
      "Distinct Items": r.distinctLineItems,
      Years: r.yearsCovered.join(","),
      Rev: r.hasRevenue ? "✓" : "✗",
      NetInc: r.hasNetIncome ? "✓" : "✗",
      Assets: r.hasTotalAssets ? "✓" : "✗",
      Liab: r.hasTotalLiabilities ? "✓" : "✗",
      OCF: r.hasOperatingCashFlow ? "✓" : "✗",
      CapEx: r.hasCapEx ? "✓" : "✗",
      Div: r.hasDividends ? "✓" : "✗",
      Rep: r.hasRepurchases ? "✓" : "-",
      Financials: r.financialsOk ? "✓" : "✗",
      CapAlloc: r.capitalAllocationOk ? "✓" : "✗",
      Dash: r.dashboardOk ? "✓" : "✗",
    }))
  );

  const totalSuccess = reports.filter(
    (r) => r.fyRowsCount > 0 && r.hasRevenue && r.hasNetIncome && r.financialsOk && r.capitalAllocationOk
  ).length;

  console.log(`\nOverall Success: ${totalSuccess} / ${reports.length} companies verified successfully!`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
