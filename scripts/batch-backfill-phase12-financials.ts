/**
 * Unified Batch Backfill for Phase 1 & Phase 2 Companies
 *
 * Backfills full statutory financial statements (all canonical line items)
 * across US, CN, and HK markets for existing Phase 1 and Phase 2 entities.
 *
 * Features:
 * - Resumable with checkpoint file (.cache/batch-backfill-phase12-financials.json)
 * - Prioritizes Master Holdings (priority > 0) -> Phase 2 -> Phase 1
 * - Pure TS official SEC EDGAR REST for US (single call, zero Python)
 * - AkShare wide-table + Eastmoney for CN/HK with atomic bulk DB transaction
 * - Granular market filter (--market us|cn|hk|all) and batch bounds (--limit, --offset, --dry-run)
 *
 * Usage:
 *   # Dry-run preview
 *   npm run backfill:phase12-financials -- --dry-run
 *
 *   # Backfill top 5 US companies
 *   npm run backfill:phase12-financials -- --market us --limit 5
 *
 *   # Backfill all HK companies
 *   npm run backfill:phase12-financials -- --market hk
 *
 *   # Full run across all markets
 *   npm run backfill:phase12-financials
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { normalizeCurrencyCode } from "../src/lib/fx-rates-core";
import { persistReportingCurrency } from "../src/lib/reporting-currency";
import { backfillCompanyFinancialsFast } from "./backfill-company-financials-fast";
import { CN_HK_SEEDS } from "./lib/cn-hk-company-seeds";
import { runProcessGroup } from "./lib/run-process-group";
import {
  resolveHkCurrencyFromAnnualReport,
  resolveHkCurrencyViaYfinance,
} from "./lib/cn-hk-currency-resolve";

type Market = "us" | "cn" | "hk";

interface EntityCandidate {
  id: string;
  ticker: string;
  market: Market;
  code: string | null;
  cik: string | null;
  canonicalName: string;
  onboardPhase: number;
  priority: number;
  reportingCurrency: string | null;
}

interface CheckpointData {
  lastUpdated: string;
  completed: Record<string, { timestamp: string; rowsUpserted: number }>;
  failed: Record<string, { timestamp: string; error: string }>;
}

const CHECKPOINT_PATH = path.join(process.cwd(), ".cache", "batch-backfill-phase12-financials.json");
const shutdownController = new AbortController();
let shutdownRequested = false;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    shutdownRequested = true;
    console.warn(`[backfill] ${signal} received; stopping after the active company is safe.`);
    shutdownController.abort();
  });
}

function getArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function loadCheckpoint(): CheckpointData {
  if (existsSync(CHECKPOINT_PATH)) {
    try {
      return JSON.parse(readFileSync(CHECKPOINT_PATH, "utf8")) as CheckpointData;
    } catch {
      // Ignore parse failure
    }
  }
  return { lastUpdated: new Date().toISOString(), completed: {}, failed: {} };
}

function saveCheckpoint(data: CheckpointData) {
  mkdirSync(path.dirname(CHECKPOINT_PATH), { recursive: true });
  data.lastUpdated = new Date().toISOString();
  writeFileSync(CHECKPOINT_PATH, JSON.stringify(data, null, 2), "utf8");
}

function runCommand(cmd: string, args: string[]) {
  return runProcessGroup(cmd, args, {
    cwd: process.cwd(),
    env: process.env,
    signal: shutdownController.signal,
  });
}

async function resolveCompanyCurrency(entity: EntityCandidate): Promise<string> {
  const seed = CN_HK_SEEDS[entity.ticker];
  if (seed?.currency) return seed.currency;

  const registeredCurrency = normalizeCurrencyCode(entity.reportingCurrency);
  if (registeredCurrency) return registeredCurrency;
  if (entity.market === "us") return "USD";
  if (entity.market === "cn") return "CNY";

  // For HK, inspect existing Financial record unit
  const existingFin = await prisma.financial.findFirst({
    where: { entityId: entity.id },
    select: { unit: true },
  });
  const existingCurrency = normalizeCurrencyCode(existingFin?.unit);
  if (existingCurrency) return existingCurrency;

  // Extract from stored annual report text if available
  try {
    const fromReport = await resolveHkCurrencyFromAnnualReport(entity.id);
    if (fromReport) return fromReport;
  } catch {}

  // Fallback to Yahoo Finance metadata
  const fromYf = normalizeCurrencyCode(resolveHkCurrencyViaYfinance(entity.ticker));
  if (fromYf) return fromYf;

  return "HKD";
}

async function backfillCnHkCompany(
  entity: EntityCandidate,
  fromYear: number,
  currency: string
): Promise<{ rowsUpserted: number }> {
  const code = entity.code || entity.ticker.split(".")[0];
  const pyCmd = existsSync(".venv/bin/python") ? ".venv/bin/python" : "python3";

  await persistReportingCurrency(entity.id, entity.market, currency);

  const dataCurrency = CN_HK_SEEDS[entity.ticker]?.financialDataCurrency;
  const args = [
    "scripts/fetch-cn-hk-financials-ak.py",
    "--code", code,
    "--market", entity.market,
    "--currency", currency,
    "--from-year", String(fromYear),
  ];
  if (dataCurrency) args.push("--data-currency", dataCurrency);
  args.push("--import-db");

  const { exitCode, output } = await runCommand(pyCmd, args);
  if (exitCode !== 0) {
    throw new Error(`fetch-cn-hk-financials-ak exited with code ${exitCode}: ${output.slice(-300)}`);
  }

  // Count financial facts
  const finCount = await prisma.financial.count({ where: { entityId: entity.id } });
  return { rowsUpserted: finCount };
}

async function main() {
  const dryRun = hasFlag("--dry-run");
  const force = hasFlag("--force");
  const marketArg = (getArg("--market") ?? "all").toLowerCase();
  const fromYearArg = Number.parseInt(getArg("--from-year") ?? "2020", 10);
  const limitArg = getArg("--limit") ? Number.parseInt(getArg("--limit")!, 10) : undefined;
  const offsetArg = getArg("--offset") ? Number.parseInt(getArg("--offset")!, 10) : 0;
  const tickersArg = getArg("--tickers");
  const delayMs = getArg("--delay") ? Number.parseInt(getArg("--delay")!, 10) : 500;

  console.log("==================================================================");
  console.log("🚀 Batch Full-Statement Financial Backfill (Phase 1 & Phase 2)");
  console.log("==================================================================");
  console.log(`Market: ${marketArg} | From Year: ${fromYearArg} | Dry Run: ${dryRun}`);

  const marketFilter = marketArg === "all" ? { in: ["us", "cn", "hk"] } : marketArg;

  // Query all Phase 1 and Phase 2 entities
  const whereClause: Prisma.EntityWhereInput = {
    type: "company",
    onboardPhase: { in: [1, 2] },
    market: marketFilter,
  };

  if (tickersArg) {
    const tickerList = tickersArg.split(",").map((t) => t.trim().toUpperCase());
    whereClause.ticker = { in: tickerList };
  }

  const rawEntities = await prisma.entity.findMany({
    where: whereClause,
    select: {
      id: true,
      ticker: true,
      market: true,
      code: true,
      cik: true,
      canonicalName: true,
      onboardPhase: true,
      priority: true,
      reportingCurrency: true,
    },
    orderBy: [
      { priority: "desc" },
      { onboardPhase: "desc" },
      { ticker: "asc" },
    ],
  });

  const entitiesWithTicker = rawEntities.filter(
    (entity): entity is typeof entity & { ticker: string } => entity.ticker !== null,
  );
  if (entitiesWithTicker.length !== rawEntities.length) {
    console.warn(`Skipping ${rawEntities.length - entitiesWithTicker.length} entities without a ticker.`);
  }

  const candidates: EntityCandidate[] = entitiesWithTicker.map((e) => ({
    id: e.id,
    ticker: e.ticker,
    market: e.market as Market,
    code: e.code,
    cik: e.cik,
    canonicalName: e.canonicalName,
    onboardPhase: e.onboardPhase ?? 0,
    priority: e.priority ?? 0,
    reportingCurrency: e.reportingCurrency,
  }));

  const checkpoint = loadCheckpoint();
  const uncompleted = candidates.filter((c) => force || !checkpoint.completed[c.ticker]);
  const slicedCandidates = uncompleted.slice(offsetArg, limitArg ? offsetArg + limitArg : undefined);

  console.log(`\nInventory:`);
  console.log(`  - Total Phase 1 & 2 entities in DB: ${candidates.length}`);
  console.log(`  - Already completed in checkpoint: ${candidates.length - uncompleted.length}`);
  console.log(`  - Remaining to process: ${uncompleted.length}`);
  console.log(`  - Sliced for this run: ${slicedCandidates.length}`);

  const byMarket = { us: 0, cn: 0, hk: 0 };
  for (const c of slicedCandidates) {
    byMarket[c.market]++;
  }
  console.log(`  - Breakdown for this run: US=${byMarket.us}, CN=${byMarket.cn}, HK=${byMarket.hk}`);

  if (dryRun) {
    console.log("\n[dry-run] Sample 10 companies to backfill:");
    for (const c of slicedCandidates.slice(0, 10)) {
      console.log(`  [${c.market.toUpperCase()}] ${c.ticker.padEnd(10)} | Phase ${c.onboardPhase} | Priority ${c.priority} | ${c.canonicalName}`);
    }
    console.log("\n[dry-run] Complete without modifying data.");
    return;
  }

  const startTime = Date.now();
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < slicedCandidates.length && !shutdownRequested; i++) {
    const c = slicedCandidates[i];
    const prefix = `[${i + 1}/${slicedCandidates.length}] [${c.market.toUpperCase()}] ${c.ticker}`;
    const companyStart = Date.now();

    console.log(`\n>>> ${prefix} (${c.canonicalName})...`);

    try {
      let rowsUpserted = 0;
      if (c.market === "us") {
        if (!c.cik) {
          throw new Error(`US entity ${c.ticker} has no CIK`);
        }
        const res = await backfillCompanyFinancialsFast({
          entityId: c.id,
          cik: c.cik,
          ticker: c.ticker,
          fromYear: fromYearArg,
        });
        if (res.error) throw new Error(res.error);
        rowsUpserted = res.financialRowsUpserted;
      } else {
        const currency = await resolveCompanyCurrency(c);
        const res = await backfillCnHkCompany(c, fromYearArg, currency);
        rowsUpserted = res.rowsUpserted;
      }

      checkpoint.completed[c.ticker] = {
        timestamp: new Date().toISOString(),
        rowsUpserted,
      };
      saveCheckpoint(checkpoint);
      successCount++;

      const costMs = Date.now() - companyStart;
      console.log(`✓ ${prefix} complete: ${rowsUpserted} facts (${(costMs / 1000).toFixed(1)}s)`);
    } catch (err) {
      if (shutdownRequested) {
        console.warn(`↩ ${prefix} interrupted; leaving it uncheckpointed for a safe retry.`);
      } else {
        failCount++;
        const errMsg = err instanceof Error ? err.message : String(err);
        checkpoint.failed[c.ticker] = {
          timestamp: new Date().toISOString(),
          error: errMsg,
        };
        saveCheckpoint(checkpoint);
        console.error(`✗ ${prefix} failed: ${errMsg}`);
      }
    }

    if (delayMs > 0 && i < slicedCandidates.length - 1) {
      await sleep(delayMs);
    }
  }

  const totalCostSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n==================================================================");
  console.log(
    shutdownRequested
      ? `Backfill stopped cleanly after ${totalCostSec}s; unfinished companies remain resumable.`
      : `🎉 Batch Run Finished in ${totalCostSec}s:`,
  );
  console.log(`  - Succeeded: ${successCount}`);
  console.log(`  - Failed: ${failCount}`);
  console.log("==================================================================");
}

main()
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
