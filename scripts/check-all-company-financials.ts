import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

// Line items every FY should have, across all three import pipelines
// (US SEC 10-K, CN Sina, HK East Money). GrossProfit / CapEx /
// ShareRepurchaseAmt / EPS* are legitimately absent for some industries
// (insurers, banks) and are therefore not required.
const REQUIRED_LINE_ITEMS = [
  "Revenue",
  "NetIncome",
  "TotalAssets",
  "TotalLiabilities",
  "ShareholdersEquity",
  "OperatingCashFlow",
] as const;

async function main() {
  const companies = await db.entity.findMany({
    where: { type: "company" },
    select: {
      id: true,
      canonicalName: true,
      ticker: true,
      cik: true,
      sector: true,
      market: true,
    },
    orderBy: { canonicalName: "asc" },
  });

  const byBucket = {
    zero: [] as typeof companies,
    oneToTwo: [] as typeof companies,
    threeToFour: [] as typeof companies,
    fivePlus: [] as typeof companies,
  };

  const details: Array<{
    id: string;
    name: string;
    ticker: string | null;
    cik: string | null;
    fyCount: number;
    fyYears: number[];
  }> = [];

  const incomplete: Array<{
    id: string;
    name: string;
    ticker: string | null;
    year: number;
    missing: string[];
  }> = [];

  // ShareRepurchaseAmt on a CN/HK Financials-sector company is almost
  // always a source-data mislabel (e.g. East Money's insurer template
  // tagged a 2013 PICC P&C financing row as 回购股份 although the company
  // has never bought back shares) — flag for manual verification against
  // the annual report. US financials are excluded: buybacks are routine
  // capital return there (AXP, ALLY, AON all repurchase genuinely).
  const suspiciousRepurchases: Array<{
    id: string;
    name: string;
    ticker: string | null;
    periodEnd: string;
    value: string;
  }> = [];

  for (const c of companies) {
    const fyRows = await db.financial.findMany({
      where: { entityId: c.id, periodType: "FY" },
      select: { periodEnd: true, lineItem: true, value: true },
      orderBy: { periodEnd: "desc" },
    });
    const years = [...new Set(fyRows.map((f) => f.periodEnd.getUTCFullYear()))];
    const cnt = years.length;

    if (cnt === 0) byBucket.zero.push(c);
    else if (cnt <= 2) byBucket.oneToTwo.push(c);
    else if (cnt <= 4) byBucket.threeToFour.push(c);
    else byBucket.fivePlus.push(c);

    details.push({
      id: c.id,
      name: c.canonicalName,
      ticker: c.ticker,
      cik: c.cik,
      fyCount: cnt,
      fyYears: years,
    });

    // Completeness: required line items per fiscal year.
    const itemsByYear = new Map<number, Set<string>>();
    for (const row of fyRows) {
      const year = row.periodEnd.getUTCFullYear();
      if (!itemsByYear.has(year)) itemsByYear.set(year, new Set());
      itemsByYear.get(year)!.add(row.lineItem);
    }
    for (const [year, items] of itemsByYear) {
      const missing = REQUIRED_LINE_ITEMS.filter((item) => !items.has(item));
      if (missing.length > 0) {
        incomplete.push({ id: c.id, name: c.canonicalName, ticker: c.ticker, year, missing });
      }
    }

    if (c.sector === "Financials" && (c.market === "cn" || c.market === "hk")) {
      for (const row of fyRows) {
        if (row.lineItem === "ShareRepurchaseAmt" && row.value != null && Number(row.value) > 0) {
          suspiciousRepurchases.push({
            id: c.id,
            name: c.canonicalName,
            ticker: c.ticker,
            periodEnd: row.periodEnd.toISOString().slice(0, 10),
            value: row.value.toString(),
          });
        }
      }
    }
  }

  incomplete.sort((a, b) => a.name.localeCompare(b.name) || b.year - a.year);

  const report = {
    totalCompanies: companies.length,
    buckets: {
      "0 FY": byBucket.zero.length,
      "1-2 FY": byBucket.oneToTwo.length,
      "3-4 FY": byBucket.threeToFour.length,
      "5+ FY": byBucket.fivePlus.length,
    },
    missingFYCompanies: byBucket.zero.map((c) => ({
      id: c.id,
      name: c.canonicalName,
      ticker: c.ticker,
      cik: c.cik,
    })),
    incompleteFYCount: incomplete.length,
    incompleteFY: incomplete,
    suspiciousRepurchases,
    detail: details.slice(0, 50),
  };

  console.log(JSON.stringify(report, null, 2));
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error("[check-all-company-financials] fatal", err);
  await db.$disconnect();
  process.exit(1);
});
