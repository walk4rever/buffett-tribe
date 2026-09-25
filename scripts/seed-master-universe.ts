/**
 * Seed all listed companies (CN A-shares, HK stocks, US stocks) into Entity table as Phase 0.
 *
 * Sourced from:
 *   - A-shares: data/all-a-share-stocks.json (5,569 stocks via akshare)
 *   - HK stocks: data/all-hk-stocks.json (2,806 stocks via akshare)
 *   - US stocks: SEC EDGAR company_tickers_exchange.json (~8,000 unique listed companies)
 *
 * Usage:
 *   # Dry-run inspection:
 *   npm run seed:master-universe -- --dry-run
 *
 *   # Live seed all three markets:
 *   npm run seed:master-universe
 *
 *   # Seed only specific market:
 *   npm run seed:master-universe -- --market cn
 *   npm run seed:master-universe -- --market hk
 *   npm run seed:master-universe -- --market us
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import prisma from "@/lib/prisma";

type AShareItem = {
  code: string;
  name: string;
  ticker: string;
  exchange: string;
};

type HkShareItem = {
  code: string;
  name: string;
  engName?: string;
  ticker: string;
  exchange: string;
};

type UsShareItem = {
  cik: string;
  name: string;
  ticker: string;
  exchange: string;
};

function getArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

async function fetchSecUsStocks(): Promise<UsShareItem[]> {
  console.log("Fetching SEC EDGAR listed companies (company_tickers_exchange.json)...");
  const res = await fetch("https://www.sec.gov/files/company_tickers_exchange.json", {
    headers: { "User-Agent": "BuffettTribe rafael@air7.fun" },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch SEC tickers: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as { fields: string[]; data: Array<[number, string, string, string]> };
  const rows = json.data;

  const seenCik = new Set<string>();
  const seenTicker = new Set<string>();
  const results: UsShareItem[] = [];

  for (const r of rows) {
    const rawCik = r[0];
    const rawName = r[1];
    const rawTicker = r[2];
    const rawExchange = r[3];

    if (!rawTicker || !rawName) continue;
    const ticker = String(rawTicker).trim().toUpperCase();
    const cik = String(rawCik).padStart(10, "0");
    const name = String(rawName).trim();
    const exchange = String(rawExchange || "US").trim();

    // Deduplicate primary common stocks
    if (seenTicker.has(ticker) || seenCik.has(cik)) continue;
    seenTicker.add(ticker);
    seenCik.add(cik);

    results.push({ cik, name, ticker, exchange });
  }

  console.log(`Loaded ${results.length} clean US listed companies from SEC.`);
  return results;
}

function loadAShareStocks(): AShareItem[] {
  const jsonPath = path.join(process.cwd(), "data/all-a-share-stocks.json");
  if (!existsSync(jsonPath)) {
    throw new Error(`data/all-a-share-stocks.json not found. Run scripts/fetch-all-a-stocks.py first.`);
  }
  const data = JSON.parse(readFileSync(jsonPath, "utf-8")) as AShareItem[];
  console.log(`Loaded ${data.length} A-share stocks from data/all-a-share-stocks.json.`);
  return data;
}

function loadHkStocks(): HkShareItem[] {
  const jsonPath = path.join(process.cwd(), "data/all-hk-stocks.json");
  if (!existsSync(jsonPath)) {
    throw new Error(`data/all-hk-stocks.json not found. Run scripts/fetch-all-hk-stocks.py first.`);
  }
  const data = JSON.parse(readFileSync(jsonPath, "utf-8")) as HkShareItem[];
  console.log(`Loaded ${data.length} HK stocks from data/all-hk-stocks.json.`);
  return data;
}

async function chunkedCreateMany(items: any[], chunkSize = 500) {
  let inserted = 0;
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const res = await prisma.entity.createMany({
      data: chunk,
      skipDuplicates: true,
    });
    inserted += res.count;
    process.stdout.write(`  Inserted ${inserted}/${items.length}...\r`);
  }
  console.log(`  ✓ Inserted ${inserted} records.            `);
  return inserted;
}

async function main() {
  const dryRun = hasFlag("--dry-run");
  const targetMarket = (getArg("--market") ?? "all").toLowerCase();

  console.log(`\n=== Seed Master Universe as Phase 0 [Mode: ${dryRun ? "DRY-RUN" : "LIVE"}] ===\n`);

  // 1. Process A-shares
  if (targetMarket === "all" || targetMarket === "cn") {
    console.log("--- [1/3] A-Shares (CN) ---");
    const aShares = loadAShareStocks();
    const existingCn = await prisma.entity.findMany({
      where: { market: "cn", type: "company" },
      select: { code: true, ticker: true, onboardPhase: true },
    });
    const existingCodes = new Set(existingCn.map((c) => c.code).filter(Boolean));
    console.log(`Existing A-share companies in DB: ${existingCn.length}`);

    const newCnEntities = aShares
      .filter((s) => !existingCodes.has(s.code))
      .map((s) => ({
        type: "company",
        market: "cn",
        code: s.code,
        ticker: s.ticker,
        canonicalName: s.name,
        onboardPhase: 0,
        metadata: {
          nameZh: s.name,
          exchange: s.exchange,
          isMasterUniverse: true,
        },
      }));

    console.log(`New A-shares to seed as Phase 0: ${newCnEntities.length}`);
    if (!dryRun && newCnEntities.length > 0) {
      await chunkedCreateMany(newCnEntities);
    }
  }

  // 2. Process HK shares
  if (targetMarket === "all" || targetMarket === "hk") {
    console.log("\n--- [2/3] Hong Kong (HKEX) ---");
    const hkShares = loadHkStocks();
    const existingHk = await prisma.entity.findMany({
      where: { market: "hk", type: "company" },
      select: { code: true, ticker: true, onboardPhase: true },
    });
    const existingCodes = new Set(existingHk.map((c) => c.code).filter(Boolean));
    const existingTickers = new Set(existingHk.map((c) => c.ticker?.toUpperCase()).filter(Boolean));
    console.log(`Existing HK companies in DB: ${existingHk.length}`);

    const newHkEntities = hkShares
      .filter((s) => !existingCodes.has(s.code) && !existingTickers.has(s.ticker.toUpperCase()))
      .map((s) => ({
        type: "company",
        market: "hk",
        code: s.code,
        ticker: s.ticker,
        canonicalName: s.engName || s.name,
        onboardPhase: 0,
        metadata: {
          nameZh: s.name,
          nameEnShort: s.engName,
          exchange: "HKEX",
          isMasterUniverse: true,
        },
      }));

    console.log(`New HK stocks to seed as Phase 0: ${newHkEntities.length}`);
    if (!dryRun && newHkEntities.length > 0) {
      await chunkedCreateMany(newHkEntities);
    }
  }

  // 3. Process US shares
  if (targetMarket === "all" || targetMarket === "us") {
    console.log("\n--- [3/3] US Stocks (SEC EDGAR) ---");
    const usShares = await fetchSecUsStocks();
    const existingUs = await prisma.entity.findMany({
      where: { market: "us", type: "company" },
      select: { cik: true, ticker: true, onboardPhase: true },
    });
    const existingCiks = new Set(existingUs.map((c) => c.cik).filter(Boolean));
    const existingTickers = new Set(existingUs.map((c) => c.ticker?.toUpperCase()).filter(Boolean));
    console.log(`Existing US companies in DB: ${existingUs.length}`);

    const newUsEntities = usShares
      .filter((s) => !existingCiks.has(s.cik) && !existingTickers.has(s.ticker.toUpperCase()))
      .map((s) => ({
        type: "company",
        market: "us",
        code: s.ticker,
        ticker: s.ticker,
        cik: s.cik,
        canonicalName: s.name,
        onboardPhase: 0,
        metadata: {
          nameEnShort: s.name,
          exchange: s.exchange,
          isMasterUniverse: true,
        },
      }));

    console.log(`New US stocks to seed as Phase 0: ${newUsEntities.length}`);
    if (!dryRun && newUsEntities.length > 0) {
      await chunkedCreateMany(newUsEntities);
    }
  }

  // Summary audit
  const finalCounts = await prisma.entity.groupBy({
    by: ["market", "onboardPhase"],
    where: { type: "company" },
    _count: { id: true },
    orderBy: [{ market: "asc" }, { onboardPhase: "asc" }],
  });

  console.log("\n========================================");
  console.log("=== Master Universe Phase Breakdown ===");
  console.log("========================================");
  for (const c of finalCounts) {
    console.log(`  Market [${c.market?.padEnd(2)}]: Phase ${c.onboardPhase} -> ${c._count.id} companies`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Fatal error:", err);
  await prisma.$disconnect();
  process.exit(1);
});
