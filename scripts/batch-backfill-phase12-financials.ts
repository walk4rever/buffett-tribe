/**
 * Unified Batch Backfill for Phase 1 & Phase 2 Companies
 *
 * Backfills full statutory financial statements (all canonical line items)
 * across US, CN, and HK markets for existing Phase 1 and Phase 2 entities.
 *
 * Features:
 * - Resumable with checkpoint file (.cache/batch-backfill-phase12-financials.json)
 * - Prioritizes Phase 2 -> Phase 1, and Market ordering US -> CN -> HK -> Priority -> Ticker
 * - Pure TS official SEC EDGAR REST for US (single call, zero Python)
 * - AkShare wide-table + Eastmoney for CN/HK with atomic bulk DB transaction
 * - Granular phase filter (--phase 1|2|all), market filter (--market us|cn|hk|all),
 *   and batch bounds (--limit, --offset, --dry-run, --reset-checkpoint)
 *
 * Usage:
 *   # Dry-run preview for Phase 2 across all markets (US -> CN -> HK)
 *   npm run backfill:phase12-financials -- --phase 2 --dry-run
 *
 *   # Backfill all Phase 2 companies
 *   npm run backfill:phase12-financials -- --phase 2
 *
 *   # Backfill US Phase 2 companies
 *   npm run backfill:phase12-financials -- --phase 2 --market us
 *
 *   # Full run across Phase 1 & Phase 2
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

export type Market = "us" | "cn" | "hk";

export interface EntityCandidate {
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

export interface CheckpointData {
  lastUpdated: string;
  completed: Record<
    string,
    { timestamp: string; rowsUpserted: number; phase?: number; market?: string }
  >;
  failed: Record<
    string,
    { timestamp: string; error: string; phase?: number; market?: string }
  >;
}

export interface BackfillOptions {
  dryRun: boolean;
  force: boolean;
  resetCheckpoint: boolean;
  market: Market | "all";
  phase: number[];
  fromYear: number;
  limit?: number;
  offset: number;
  tickers?: string[];
  delayMs: number;
}

export const CHECKPOINT_PATH = path.join(process.cwd(), ".cache", "batch-backfill-phase12-financials.json");
export const MARKET_ORDER: Record<Market, number> = { us: 0, cn: 1, hk: 2 };

const shutdownController = new AbortController();
let shutdownRequested = false;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    shutdownRequested = true;
    console.warn(`[backfill] ${signal} received; stopping after the active company is safe.`);
    shutdownController.abort();
  });
}

export function parseBackfillArgs(args: string[]): BackfillOptions {
  let dryRun = false;
  let force = false;
  let resetCheckpoint = false;
  let market: Market | "all" = "all";
  let phase: number[] = [1, 2];
  let fromYear = 2020;
  let limit: number | undefined;
  let offset = 0;
  let tickers: string[] | undefined;
  let delayMs = 500;

  const validFlags = new Set([
    "--dry-run",
    "--force",
    "--reset-checkpoint",
    "--market",
    "--phase",
    "--from-year",
    "--limit",
    "--offset",
    "--tickers",
    "--delay",
  ]);

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--force") {
      force = true;
    } else if (arg === "--reset-checkpoint") {
      resetCheckpoint = true;
    } else if (arg === "--market") {
      const val = args[++i]?.toLowerCase();
      if (!val || !["us", "cn", "hk", "all"].includes(val)) {
        throw new Error(`Invalid --market value "${val}". Allowed: us, cn, hk, all`);
      }
      market = val as Market | "all";
    } else if (arg === "--phase") {
      const val = args[++i]?.toLowerCase();
      if (val === "1") {
        phase = [1];
      } else if (val === "2") {
        phase = [2];
      } else if (val === "all") {
        phase = [1, 2];
      } else if (val === "1,2" || val === "2,1") {
        phase = [1, 2];
      } else {
        throw new Error(`Invalid --phase value "${val}". Allowed: 1, 2, all`);
      }
    } else if (arg === "--from-year") {
      const val = Number.parseInt(args[++i], 10);
      if (Number.isNaN(val) || val < 1990 || val > 2100) {
        throw new Error(`Invalid --from-year value. Must be between 1990 and 2100.`);
      }
      fromYear = val;
    } else if (arg === "--limit") {
      const val = Number.parseInt(args[++i], 10);
      if (Number.isNaN(val) || val <= 0) {
        throw new Error(`Invalid --limit value. Must be a positive integer.`);
      }
      limit = val;
    } else if (arg === "--offset") {
      const val = Number.parseInt(args[++i], 10);
      if (Number.isNaN(val) || val < 0) {
        throw new Error(`Invalid --offset value. Must be a non-negative integer.`);
      }
      offset = val;
    } else if (arg === "--tickers") {
      const val = args[++i];
      if (!val) throw new Error(`--tickers flag requires comma-separated ticker list`);
      tickers = val
        .split(",")
        .map((t) => t.trim().toUpperCase())
        .filter(Boolean);
    } else if (arg === "--delay") {
      const val = Number.parseInt(args[++i], 10);
      if (Number.isNaN(val) || val < 0) {
        throw new Error(`Invalid --delay value. Must be a non-negative integer.`);
      }
      delayMs = val;
    } else {
      throw new Error(`Unknown argument "${arg}". Supported options: ${Array.from(validFlags).join(", ")}`);
    }
  }

  return {
    dryRun,
    force,
    resetCheckpoint,
    market,
    phase,
    fromYear,
    limit,
    offset,
    tickers,
    delayMs,
  };
}

export function sortCandidates(candidates: EntityCandidate[]): EntityCandidate[] {
  return [...candidates].sort((a, b) => {
    // 1. onboardPhase descending (Phase 2 first, then Phase 1)
    if (b.onboardPhase !== a.onboardPhase) {
      return b.onboardPhase - a.onboardPhase;
    }
    // 2. market ordering: US (0) -> CN (1) -> HK (2)
    const mDiff = (MARKET_ORDER[a.market] ?? 99) - (MARKET_ORDER[b.market] ?? 99);
    if (mDiff !== 0) {
      return mDiff;
    }
    // 3. priority descending (e.g. Master Holdings with priority > 0)
    if (b.priority !== a.priority) {
      return b.priority - a.priority;
    }
    // 4. ticker ascending
    return a.ticker.localeCompare(b.ticker);
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function loadCheckpoint(): CheckpointData {
  if (existsSync(CHECKPOINT_PATH)) {
    try {
      return JSON.parse(readFileSync(CHECKPOINT_PATH, "utf8")) as CheckpointData;
    } catch {
      // Ignore parse failure
    }
  }
  return { lastUpdated: new Date().toISOString(), completed: {}, failed: {} };
}

export function saveCheckpoint(data: CheckpointData) {
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
  currency: string,
): Promise<{ rowsUpserted: number }> {
  const code = entity.code || entity.ticker.split(".")[0];
  const pyCmd = existsSync(".venv/bin/python") ? ".venv/bin/python" : "python3";

  await persistReportingCurrency(entity.id, entity.market, currency);

  const dataCurrency = CN_HK_SEEDS[entity.ticker]?.financialDataCurrency;
  const args = [
    "scripts/fetch-cn-hk-financials-ak.py",
    "--code",
    code,
    "--market",
    entity.market,
    "--currency",
    currency,
    "--from-year",
    String(fromYear),
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

export async function main() {
  const options = parseBackfillArgs(process.argv.slice(2));

  console.log("==================================================================");
  console.log("🚀 Batch Full-Statement Financial Backfill (Phase 1 & Phase 2)");
  console.log("==================================================================");
  console.log(
    `Phase: ${options.phase.join(",")} | Market: ${options.market} | From Year: ${options.fromYear} | Dry Run: ${options.dryRun}`,
  );

  if (options.resetCheckpoint && existsSync(CHECKPOINT_PATH)) {
    const backupPath = `${CHECKPOINT_PATH}.bak-${Date.now()}`;
    writeFileSync(backupPath, readFileSync(CHECKPOINT_PATH));
    console.log(`[checkpoint] Archived existing checkpoint to ${backupPath}`);
    writeFileSync(
      CHECKPOINT_PATH,
      JSON.stringify({ lastUpdated: new Date().toISOString(), completed: {}, failed: {} }, null, 2),
      "utf8",
    );
  }

  const marketFilter = options.market === "all" ? { in: ["us", "cn", "hk"] } : options.market;

  // Query entities matching phase and market
  const whereClause: Prisma.EntityWhereInput = {
    type: "company",
    onboardPhase: { in: options.phase },
    market: marketFilter,
  };

  if (options.tickers && options.tickers.length > 0) {
    whereClause.ticker = { in: options.tickers };
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
  });

  const entitiesWithTicker = rawEntities.filter(
    (entity): entity is typeof entity & { ticker: string } => entity.ticker !== null,
  );
  if (entitiesWithTicker.length !== rawEntities.length) {
    console.warn(`Skipping ${rawEntities.length - entitiesWithTicker.length} entities without a ticker.`);
  }

  const rawCandidates: EntityCandidate[] = entitiesWithTicker.map((e) => ({
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

  const candidates = sortCandidates(rawCandidates);

  const checkpoint = loadCheckpoint();
  const uncompleted = candidates.filter((c) => options.force || !checkpoint.completed[c.ticker]);
  const slicedCandidates = uncompleted.slice(
    options.offset,
    options.limit ? options.offset + options.limit : undefined,
  );

  console.log(`\nInventory:`);
  console.log(`  - Total Phase ${options.phase.join("/")} entities in DB: ${candidates.length}`);
  console.log(`  - Already completed in checkpoint: ${candidates.length - uncompleted.length}`);
  console.log(`  - Remaining to process: ${uncompleted.length}`);
  console.log(`  - Sliced for this run: ${slicedCandidates.length}`);

  const breakdown: Record<string, number> = {};
  for (const c of slicedCandidates) {
    const key = `Phase ${c.onboardPhase} ${c.market.toUpperCase()}`;
    breakdown[key] = (breakdown[key] ?? 0) + 1;
  }
  const breakdownStr = Object.entries(breakdown)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  console.log(`  - Breakdown for this run: ${breakdownStr || "none"}`);

  if (options.dryRun) {
    console.log("\n[dry-run] Sample 15 companies in execution order:");
    for (const c of slicedCandidates.slice(0, 15)) {
      console.log(
        `  [${c.market.toUpperCase()}] ${c.ticker.padEnd(10)} | Phase ${c.onboardPhase} | Priority ${c.priority} | ${c.canonicalName}`,
      );
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

    const maxRetries = 2;
    let attempt = 0;
    let succeeded = false;

    while (attempt <= maxRetries && !succeeded && !shutdownRequested) {
      attempt++;
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
            fromYear: options.fromYear,
          });
          if (res.error) throw new Error(res.error);
          rowsUpserted = res.financialRowsUpserted;
        } else {
          const currency = await resolveCompanyCurrency(c);
          const res = await backfillCnHkCompany(c, options.fromYear, currency);
          rowsUpserted = res.rowsUpserted;
        }

        checkpoint.completed[c.ticker] = {
          timestamp: new Date().toISOString(),
          rowsUpserted,
          phase: c.onboardPhase,
          market: c.market,
        };
        if (checkpoint.failed[c.ticker]) {
          delete checkpoint.failed[c.ticker];
        }
        saveCheckpoint(checkpoint);
        successCount++;
        succeeded = true;

        const costMs = Date.now() - companyStart;
        const elapsedSec = (Date.now() - startTime) / 1000;
        const avgSec = elapsedSec / (i + 1);
        const remainingSec = avgSec * (slicedCandidates.length - (i + 1));
        const etaHours = (remainingSec / 3600).toFixed(1);
        const progressPct = (((i + 1) / slicedCandidates.length) * 100).toFixed(1);

        console.log(
          `✓ ${prefix} complete: ${rowsUpserted} facts (${(costMs / 1000).toFixed(1)}s) | ` +
            `[${progressPct}%] elapsed: ${(elapsedSec / 60).toFixed(1)}m, ETA: ~${etaHours}h`,
        );
      } catch (err) {
        if (shutdownRequested) {
          console.warn(`↩ ${prefix} interrupted; leaving it uncheckpointed for a safe retry.`);
          break;
        }
        const errMsg = err instanceof Error ? err.message : String(err);
        if (attempt <= maxRetries) {
          const backoffMs = attempt * 2000;
          console.warn(
            `⚠ ${prefix} error (attempt ${attempt}/${maxRetries + 1}): ${errMsg}. Retrying in ${backoffMs}ms...`,
          );
          await sleep(backoffMs);
        } else {
          failCount++;
          checkpoint.failed[c.ticker] = {
            timestamp: new Date().toISOString(),
            error: errMsg,
            phase: c.onboardPhase,
            market: c.market,
          };
          saveCheckpoint(checkpoint);
          console.error(`✗ ${prefix} failed after ${maxRetries + 1} attempts: ${errMsg}`);
        }
      }
    }

    if (options.delayMs > 0 && i < slicedCandidates.length - 1) {
      await sleep(options.delayMs);
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

const isDirectExecution = process.argv[1] && /batch-backfill-phase12-financials(\.[cm]?[jt]s)?$/.test(process.argv[1]);
if (isDirectExecution) {
  main()
    .catch((err) => {
      console.error("Fatal error:", err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
