#!/usr/bin/env node
/**
 * scripts/process-company-phase3-deep.ts
 *
 * Automated Phase 3 Deep Task Processing Worker
 *
 * Handles backend heavy lifting for companies that have new public reports (10-Q, 10-K, interim/annual)
 * discovered during Phase 3 fast updates, or enqueued into the Fast-Track Priority Channel.
 *
 * Responsibilities:
 * 1. Deep Financial Data Extraction:
 *    - US: Extracts quarterly line items from SEC CompanyFacts via importUsQuarterlyFinancialsForEntity
 *          and ensures latest annual 10-K facts via backfillCompanyFinancialsFast.
 *    - CN/HK: Runs akshare financial statement import via import:cn-hk-financials.
 * 2. Recalculates Situational & Valuation Metrics:
 *    - Runs runPhase3Update() to refresh TTM EPS, latest stock price, PE valuation corridor percentiles,
 *      and fundamental red flag detectors with the newly ingested financials.
 * 3. Priority & State Reset:
 *    - Clears fast-track priority (priority = 0, priorityRequestedAt = null, p3Pending = false).
 *    - Records p3DeepProcessedAt in entity metadata.
 *
 * Usage:
 *   node --env-file=.env.local ./node_modules/.bin/tsx scripts/process-company-phase3-deep.ts --ticker NKE
 *   node --env-file=.env.local ./node_modules/.bin/tsx scripts/process-company-phase3-deep.ts --ticker 9992.HK --market hk
 *   node --env-file=.env.local ./node_modules/.bin/tsx scripts/process-company-phase3-deep.ts --ticker 600519.SS --market cn
 *   node --env-file=.env.local ./node_modules/.bin/tsx scripts/process-company-phase3-deep.ts --all-pending
 */

import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import prisma from "@/lib/prisma";
import { runPhase3Update, type Phase3UpdateResult } from "@/lib/phase3-update";
import { importUsQuarterlyFinancialsForEntity } from "./import-us-quarterly-financials";
import { backfillCompanyFinancialsFast } from "./backfill-company-financials-fast";
import { resolveHkCurrencyFromAnnualReport, resolveHkCurrencyViaYfinance } from "./lib/cn-hk-currency-resolve";

type Market = "us" | "hk" | "cn";

export interface ProcessCompanyPhase3DeepResult {
  success: boolean;
  entityId: string;
  ticker: string;
  market: Market;
  financialsImported: number;
  phase3Result?: Phase3UpdateResult;
  durationMs: number;
  error?: string;
}

function getArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

function runCommand(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: "inherit", env: process.env, cwd: process.cwd() });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

function deriveCnHkCode(ticker: string, market: "cn" | "hk"): string {
  if (market === "cn") {
    const match = ticker.match(/^(\d{6})\.(SS|SZ|BJ)$/i);
    if (!match) throw new Error(`Cannot derive CN exchange code from ticker "${ticker}". Expected format like 600519.SS.`);
    return match[1];
  }
  const match = ticker.match(/^(\d{1,5})\.HK$/i);
  if (!match) throw new Error(`Cannot derive HK exchange code from ticker "${ticker}". Expected format like 9992.HK.`);
  return match[1].padStart(5, "0");
}

async function resolveHkCurrency(entityId: string, ticker: string): Promise<string> {
  // 1. Check if existing Financial records already have a confirmed currency
  const existingFin = await prisma.financial.findFirst({
    where: { entityId, unit: { in: ["CNY", "HKD", "USD"] } },
    select: { unit: true },
  });
  if (existingFin?.unit) {
    return existingFin.unit;
  }

  // 2. Try resolving from stored annual report text
  try {
    const annualCur = await resolveHkCurrencyFromAnnualReport(entityId);
    if (annualCur) return annualCur;
  } catch {
    // Continue to fallback
  }

  // 3. Try resolving via Yahoo Finance profile
  try {
    const yfCur = resolveHkCurrencyViaYfinance(ticker);
    if (yfCur) return yfCur;
  } catch {
    // Fallback
  }

  return "HKD";
}

export async function processCompanyPhase3Deep(options: {
  ticker?: string;
  entityId?: string;
  market?: Market;
  dryRun?: boolean;
}): Promise<ProcessCompanyPhase3DeepResult> {
  const startTime = Date.now();
  const dryRun = Boolean(options.dryRun);

  // 1. Resolve Entity
  const entity = await prisma.entity.findFirst({
    where: {
      type: "company",
      ...(options.entityId ? { id: options.entityId } : {}),
      ...(options.ticker
        ? {
            OR: [
              { ticker: { equals: options.ticker.trim().toUpperCase(), mode: "insensitive" } },
              { securitiesAsCompany: { some: { ticker: { equals: options.ticker.trim().toUpperCase(), mode: "insensitive" } } } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      ticker: true,
      code: true,
      canonicalName: true,
      cik: true,
      market: true,
      onboardPhase: true,
      priority: true,
      metadata: true,
    },
  });

  if (!entity) {
    throw new Error(`未找到标的: ${options.entityId || options.ticker}`);
  }

  const primaryTicker = (entity.ticker || options.ticker || "").trim().toUpperCase();
  const rawMarket = (options.market || entity.market || "us").toLowerCase();
  const market: Market = rawMarket === "hk" ? "hk" : rawMarket === "cn" ? "cn" : "us";

  console.log(`\n=======================================================`);
  console.log(`[P2→P3 DEEP WORKER] Processing ${primaryTicker} (${entity.canonicalName}) [Market: ${market.toUpperCase()}]`);
  console.log(`Current Phase: ${entity.onboardPhase}, Priority: ${entity.priority}, DryRun: ${dryRun}`);
  console.log(`=======================================================`);

  let financialsUpserted = 0;

  // 2. Heavy Data Ingestion by Market
  if (market === "us") {
    if (!entity.cik) {
      console.warn(`  ⚠️ [US] Entity ${primaryTicker} missing CIK, skipping SEC EDGAR quarterly ingestion`);
    } else {
      console.log(`\n[Step 1/3] Extracting 10-Q quarterly financial statements from SEC EDGAR (CIK ${entity.cik})...`);
      try {
        const qCount = await importUsQuarterlyFinancialsForEntity(entity.id, entity.cik, primaryTicker, {
          archiveHtml: false,
        });
        financialsUpserted += qCount;
        console.log(`  ✓ 10-Q Financial facts processed: ${qCount}`);
      } catch (qErr) {
        console.warn(`  ⚠️ 10-Q extraction warning:`, qErr instanceof Error ? qErr.message : String(qErr));
      }

      console.log(`\n[Step 2/3] Checking & backfilling annual 10-K financial facts...`);
      try {
        const annualRes = await backfillCompanyFinancialsFast({
          entityId: entity.id,
          cik: entity.cik,
          ticker: primaryTicker,
          dryRun,
        });
        financialsUpserted += annualRes.financialRowsUpserted;
        console.log(`  ✓ Annual 10-K Financial facts processed: ${annualRes.financialRowsUpserted}`);
      } catch (aErr) {
        console.warn(`  ⚠️ Annual facts check warning:`, aErr instanceof Error ? aErr.message : String(aErr));
      }
    }
  } else if (market === "cn") {
    const code = entity.code || deriveCnHkCode(primaryTicker, "cn");
    console.log(`\n[Step 1/3] Fetching CN financial statements via akshare (${code}.SS/SZ)...`);
    const codeStatus = await runCommand("npm", [
      "run",
      "import:cn-hk-financials",
      "--",
      "--code",
      code,
      "--market",
      "cn",
      "--ticker",
      primaryTicker,
      "--currency",
      "CNY",
      "--import-db",
    ]);
    if (codeStatus !== 0) {
      console.warn(`  ⚠️ CN financials import exited with status code ${codeStatus}`);
    } else {
      console.log(`  ✓ CN financials imported successfully`);
    }
  } else if (market === "hk") {
    const code = entity.code ? entity.code.padStart(5, "0") : deriveCnHkCode(primaryTicker, "hk");
    const currency = await resolveHkCurrency(entity.id, primaryTicker);
    console.log(`\n[Step 1/3] Fetching HK financial statements via akshare (${code}.HK, currency: ${currency})...`);
    const codeStatus = await runCommand("npm", [
      "run",
      "import:cn-hk-financials",
      "--",
      "--code",
      code,
      "--market",
      "hk",
      "--ticker",
      primaryTicker,
      "--currency",
      currency,
      "--import-db",
    ]);
    if (codeStatus !== 0) {
      console.warn(`  ⚠️ HK financials import exited with status code ${codeStatus}`);
    } else {
      console.log(`  ✓ HK financials imported successfully`);
    }
  }

  // 3. Situational Refresh & Valuation Recalculation
  console.log(`\n[Step 3/3] Recalculating Phase 3 situational metrics & fundamental red flags...`);
  const phase3Result = await runPhase3Update({
    entityId: entity.id,
    ticker: primaryTicker,
    dryRun,
  });

  // 4. Reset Fast-Track / Priority state
  if (!dryRun) {
    const currentMeta = (entity.metadata as Record<string, unknown>) || {};
    await prisma.entity.update({
      where: { id: entity.id },
      data: {
        priority: 0,
        priorityRequestedAt: null,
        metadata: {
          ...currentMeta,
          fastTrack: false,
          p3Pending: false,
          p3PendingFilings: null,
          p3DeepProcessedAt: new Date().toISOString(),
          phase3Attempts: 0,
          phase3LastError: null,
        },
      },
    });
    console.log(`  ✓ Priority reset to 0, p3Pending cleared`);
  }

  const durationMs = Date.now() - startTime;
  console.log(`\n✅ Phase 3 Deep processing completed successfully in ${durationMs}ms`);
  console.log(`最新市价: $${phase3Result.latestPrice?.toFixed(2) ?? "—"} (${phase3Result.priceDate ?? "—"})`);
  console.log(`最新 PE:   ${phase3Result.currentPe ?? "—"}x (中枢: ${phase3Result.benchmarkPe ?? "—"}x)`);
  console.log(`估值状态: ${phase3Result.valuationStatus}`);
  console.log(`基本面健康度: ${phase3Result.fundamentalHealth}`);
  console.log(`=======================================================\n`);

  return {
    success: true,
    entityId: entity.id,
    ticker: primaryTicker,
    market,
    financialsImported: financialsUpserted,
    phase3Result,
    durationMs,
  };
}

async function main() {
  const ticker = getArg("--ticker") || getArg("-t");
  const entityId = getArg("--id");
  const marketArg = (getArg("--market") || getArg("-m"))?.toLowerCase() as Market | undefined;
  const dryRun = hasFlag("--dry-run");
  const allPending = hasFlag("--all-pending");
  const limit = parseInt(getArg("--limit") ?? "15", 10);

  if (allPending) {
    console.log(`\n=== Scanning for pending Phase 3 fast-track companies (limit: ${limit}) ===`);
    const pendingEntities = await prisma.entity.findMany({
      where: {
        type: "company",
        onboardPhase: { gte: 2 },
        priority: { gt: 0 },
      },
      select: {
        id: true,
        ticker: true,
        canonicalName: true,
        market: true,
        priority: true,
      },
      orderBy: [
        { priority: "desc" },
        { priorityRequestedAt: "asc" },
      ],
      take: limit,
    });

    console.log(`Found ${pendingEntities.length} pending Phase 3 companies:`);
    for (let i = 0; i < pendingEntities.length; i++) {
      const e = pendingEntities[i];
      console.log(`  [${i + 1}] ${e.ticker} (${e.canonicalName}) - Priority ${e.priority}`);
    }

    if (dryRun || pendingEntities.length === 0) {
      return;
    }

    for (let i = 0; i < pendingEntities.length; i++) {
      const e = pendingEntities[i];
      try {
        await processCompanyPhase3Deep({
          entityId: e.id,
          ticker: e.ticker ?? undefined,
          market: (e.market as Market) ?? undefined,
          dryRun,
        });
      } catch (err) {
        console.error(`❌ Failed deep processing for ${e.ticker}:`, err);
      }
    }
    return;
  }

  if (!ticker && !entityId) {
    console.error("用法错误: 请提供 --ticker <TICKER> 或 --id <ENTITY_ID> 或 --all-pending");
    console.error("示例: node --env-file=.env.local ./node_modules/.bin/tsx scripts/process-company-phase3-deep.ts --ticker NKE");
    process.exit(1);
  }

  try {
    await processCompanyPhase3Deep({
      ticker,
      entityId,
      market: marketArg,
      dryRun,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`❌ Phase 3 Deep processing failed:`, message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
}
