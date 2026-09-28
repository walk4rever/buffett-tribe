/**
 * Automated Hourly Priority & Batch Onboarding Worker
 *
 * Pulls prioritized and regular companies directly from the database queue:
 * - Priority companies (priority > 0):
 *     - onboardPhase = 0 -> Advances to Phase 1 (10-K/financials + stock prices)
 *     - onboardPhase = 1 -> Advances to Phase 2 (Business canvas, moat, management, valuation)
 * - Standard batch companies (onboardPhase = 0):
 *     - Advances to Phase 1 balanced across US, HK, and CN markets
 *
 * Designed to run hourly via cron or manual trigger on the `mini` remote machine.
 *
 * Usage:
 *   # Dry-run inspection (default 15 companies):
 *   npm run worker:priority -- --dry-run
 *
 *   # Run a standard batch:
 *   npm run worker:priority
 *
 *   # Run a custom batch size (e.g. 10):
 *   npm run worker:priority -- --batch-size 10
 *
 *   # Target a specific market:
 *   npm run worker:priority -- --market hk --batch-size 15
 *
 *   # Priority-channel only (no standard Phase 0 fill):
 *   npm run worker:priority -- --priority-only
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, appendFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import prisma from "@/lib/prisma";

type Market = "us" | "hk" | "cn";

interface CandidateCompany {
  id: string;
  market: Market;
  ticker: string;
  code: string | null;
  canonicalName: string;
  nameZh?: string;
  priorityScore: number;
  currentPhase: number;
  targetPhase: number;
  isFastTrack: boolean;
}

const PID_FILE = path.join(process.cwd(), ".cache", "pipeline-priority-worker.pid");
const LOG_FILE = path.join(process.cwd(), "logs", "pipeline-priority.log");

// Core HK tickers for initial priority seeding
const CORE_HK_TICKERS = new Set([
  "9988.HK", "0700.HK", "3690.HK", "1810.HK", "9992.HK", "9633.HK",
  "0388.HK", "1211.HK", "9999.HK", "1024.HK", "9618.HK", "9888.HK",
  "0175.HK", "0883.HK", "2020.HK", "0291.HK", "0992.HK", "1299.HK",
  "2318.HK", "0941.HK", "1088.HK", "0005.HK", "0001.HK", "0011.HK",
  "0066.HK", "2388.HK", "3968.HK", "0386.HK", "0857.HK", "1093.HK",
]);

// Core A-share tickers (CSI 300 sample / top market caps)
const CORE_CN_TICKERS = new Set([
  "600519.SS", "300750.SZ", "601318.SS", "000858.SZ", "600036.SS",
  "002594.SZ", "601899.SS", "600900.SS", "601088.SS", "000333.SZ",
  "600276.SS", "002415.SZ", "000568.SZ", "603288.SS", "000001.SZ",
  "601166.SS", "600030.SS", "000651.SZ", "000338.SZ", "601988.SS",
]);

function getArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

function logMessage(msg: string) {
  const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try {
    mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    appendFileSync(LOG_FILE, line + "\n", "utf8");
  } catch {
    // Ignore logging write errors
  }
}

function acquireLock(): boolean {
  mkdirSync(path.dirname(PID_FILE), { recursive: true });
  if (existsSync(PID_FILE)) {
    try {
      const existingPid = parseInt(readFileSync(PID_FILE, "utf8").trim(), 10);
      if (existingPid && !Number.isNaN(existingPid)) {
        // Test if process is still running
        try {
          process.kill(existingPid, 0);
          return false; // Still running!
        } catch {
          // Process not found, stale lock
        }
      }
    } catch {
      // Stale or unreadable lock
    }
  }

  try {
    writeFileSync(PID_FILE, String(process.pid), "utf8");
    return true;
  } catch {
    return false;
  }
}

function releaseLock() {
  try {
    if (existsSync(PID_FILE)) {
      unlinkSync(PID_FILE);
    }
  } catch {
    // Ignore cleanup error
  }
}

function runCommand(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: "inherit", env: process.env, cwd: process.cwd() });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

function formatDuration(ms: number): string {
  const totalSecs = Math.round(ms / 1000);
  if (totalSecs < 60) return `${totalSecs}s`;
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${mins}m ${secs}s`;
}

/**
 * Fetch fast-track expedited candidates:
 * Covers both Phase 0 (target Phase 1) and Phase 1 (target Phase 2) companies with priority > 0.
 */
async function fetchFastTrackCandidates(limit: number, marketFilter?: Market): Promise<CandidateCompany[]> {
  const rows = await prisma.entity.findMany({
    where: {
      type: "company",
      onboardPhase: { in: [0, 1] },
      priority: { gt: 0 },
      ...(marketFilter ? { market: marketFilter } : {}),
    },
    select: {
      id: true,
      market: true,
      ticker: true,
      code: true,
      canonicalName: true,
      priority: true,
      priorityRequestedAt: true,
      onboardPhase: true,
      createdAt: true,
      metadata: true,
    },
    orderBy: [
      { priority: "desc" },
      { priorityRequestedAt: "asc" },
      { createdAt: "asc" },
    ],
    take: limit,
  });

  const candidates: CandidateCompany[] = [];

  for (const r of rows) {
    const meta = (r.metadata as Record<string, unknown>) || {};
    const attempts = r.onboardPhase === 0
      ? (typeof meta.onboardPhase1Attempts === "number" ? meta.onboardPhase1Attempts : 0)
      : (typeof meta.onboardPhase2Attempts === "number" ? meta.onboardPhase2Attempts : 0);

    if (attempts >= 3) continue; // Skip persistent failures

    let ticker = r.ticker?.trim() ?? "";
    const m = (r.market?.toLowerCase() ?? "us") as Market;

    if (!ticker) {
      if (m === "hk" && r.code) {
        ticker = `${r.code.padStart(4, "0")}.HK`;
      } else if (m === "cn" && r.code) {
        ticker = r.code.startsWith("6") || r.code.startsWith("9") ? `${r.code}.SS` : `${r.code}.SZ`;
      } else if (r.code) {
        ticker = r.code;
      }
    }
    if (!ticker) continue;

    candidates.push({
      id: r.id,
      market: m,
      ticker,
      code: r.code,
      canonicalName: r.canonicalName,
      nameZh: typeof meta.nameZh === "string" ? meta.nameZh : undefined,
      priorityScore: 1000 + (r.priority ?? 0),
      currentPhase: r.onboardPhase,
      targetPhase: r.onboardPhase === 0 ? 1 : 2,
      isFastTrack: true,
    });
  }

  return candidates;
}

/**
 * Fetch standard Phase 0 candidate companies for a market.
 */
async function fetchCandidatesForMarket(
  market: Market,
  limit: number,
  excludeIds: Set<string> = new Set()
): Promise<CandidateCompany[]> {
  if (limit <= 0) return [];

  const rows = await prisma.entity.findMany({
    where: {
      type: "company",
      market,
      onboardPhase: 0,
    },
    select: {
      id: true,
      market: true,
      ticker: true,
      code: true,
      canonicalName: true,
      metadata: true,
    },
    take: Math.max(limit * 4, 30), // Fetch extra for smart priority sorting
  });

  const candidates: CandidateCompany[] = [];

  for (const r of rows) {
    if (excludeIds.has(r.id)) continue;

    const meta = (r.metadata as Record<string, unknown>) || {};
    const attempts = typeof meta.onboardPhase1Attempts === "number" ? meta.onboardPhase1Attempts : 0;
    if (attempts >= 3) continue; // Skip persistent failures

    let ticker = r.ticker?.trim() ?? "";
    if (!ticker) {
      if (market === "hk" && r.code) {
        ticker = `${r.code.padStart(4, "0")}.HK`;
      } else if (market === "cn" && r.code) {
        ticker = r.code.startsWith("6") || r.code.startsWith("9") ? `${r.code}.SS` : `${r.code}.SZ`;
      } else if (r.code) {
        ticker = r.code;
      }
    }
    if (!ticker) continue;

    let priorityScore = 0;
    if (market === "hk" && CORE_HK_TICKERS.has(ticker.toUpperCase())) priorityScore += 100;
    if (market === "cn" && CORE_CN_TICKERS.has(ticker.toUpperCase())) priorityScore += 100;
    if (market === "us") {
      // 1-4 letter tickers without dot or digits are standard NYSE/NASDAQ common stocks
      if (ticker.length <= 4 && !ticker.includes(".") && !ticker.includes("-") && !/\d/.test(ticker)) {
        priorityScore += 20;
      } else {
        priorityScore -= 30; // OTC, warrants, units, 5-letter ADRs
      }
    }
    if (market === "cn") {
      // Deprioritize ST / *ST risk-alert companies
      const isSt = r.canonicalName.includes("ST") || (typeof meta.nameZh === "string" && meta.nameZh.includes("ST"));
      if (isSt) {
        priorityScore -= 60;
      }
    }

    if (meta.isMasterUniverse) priorityScore += 10;
    priorityScore -= attempts * 25;

    candidates.push({
      id: r.id,
      market,
      ticker,
      code: r.code,
      canonicalName: r.canonicalName,
      nameZh: typeof meta.nameZh === "string" ? meta.nameZh : undefined,
      priorityScore,
      currentPhase: 0,
      targetPhase: 1,
      isFastTrack: false,
    });
  }

  candidates.sort((a, b) => b.priorityScore - a.priorityScore || a.canonicalName.localeCompare(b.canonicalName));
  return candidates.slice(0, limit);
}

async function main() {
  const dryRun = hasFlag("--dry-run");
  const batchSize = Math.max(1, parseInt(getArg("--batch-size") ?? "15", 10));
  const targetMarket = (getArg("--market") ?? "all").toLowerCase();
  const delayMs = parseInt(getArg("--delay") ?? "2000", 10);
  const timeoutMins = parseInt(getArg("--timeout-mins") ?? "35", 10);
  const priorityOnly = hasFlag("--priority-only");

  logMessage("=======================================================");
  logMessage(`PRIORITY BATCH WORKER STARTED [Mode: ${dryRun ? "DRY-RUN" : "LIVE"}${priorityOnly ? ", PRIORITY-ONLY" : ""}]`);
  logMessage(`Configuration: BatchSize=${batchSize}, Market=${targetMarket}, Delay=${delayMs}ms, Timeout=${timeoutMins}m, PriorityOnly=${priorityOnly}`);

  if (!dryRun) {
    if (!acquireLock()) {
      logMessage("Notice: Another worker process is already running. Exiting cleanly.");
      process.exit(0);
    }
  }

  // Setup hard timeout guard
  const timeoutTimer = setTimeout(() => {
    logMessage(`WARNING: Worker reached maximum execution timeout of ${timeoutMins} minutes! Exiting gracefully.`);
    releaseLock();
    process.exit(0);
  }, timeoutMins * 60 * 1000);

  try {
    let candidateList: CandidateCompany[] = [];

    // 1. Fetch Fast-Track expedited companies first (Phase 0 and Phase 1)
    const fastTrackList = await fetchFastTrackCandidates(
      batchSize,
      targetMarket === "all" ? undefined : (targetMarket as Market)
    );
    const excludeIds = new Set(fastTrackList.map((c) => c.id));
    const remainingSlots = Math.max(0, batchSize - fastTrackList.length);

    let regularList: CandidateCompany[] = [];

    // 2. Supplement remaining slots with standard Phase 0 companies
    if (!priorityOnly && remainingSlots > 0) {
      if (targetMarket === "all") {
        const perMarket = Math.ceil(remainingSlots / 3);
        const [usList, hkList, cnList] = await Promise.all([
          fetchCandidatesForMarket("us", perMarket, excludeIds),
          fetchCandidatesForMarket("hk", perMarket, excludeIds),
          fetchCandidatesForMarket("cn", perMarket, excludeIds),
        ]);

        // Interleave results (round-robin)
        const maxLen = Math.max(usList.length, hkList.length, cnList.length);
        for (let i = 0; i < maxLen; i++) {
          if (usList[i]) regularList.push(usList[i]);
          if (hkList[i]) regularList.push(hkList[i]);
          if (cnList[i]) regularList.push(cnList[i]);
        }
        regularList = regularList.slice(0, remainingSlots);
      } else if (targetMarket === "us" || targetMarket === "hk" || targetMarket === "cn") {
        regularList = await fetchCandidatesForMarket(targetMarket as Market, remainingSlots, excludeIds);
      } else {
        throw new Error(`Invalid --market "${targetMarket}". Expected all, us, hk, or cn.`);
      }
    }

    candidateList = [...fastTrackList, ...regularList];

    logMessage(`Found ${candidateList.length} candidate companies (${fastTrackList.length} fast-track expedited):`);
    for (let i = 0; i < candidateList.length; i++) {
      const c = candidateList[i];
      const displayName = c.nameZh ? `${c.canonicalName} (${c.nameZh})` : c.canonicalName;
      const tag = c.isFastTrack ? "[⚡ FAST-TRACK]" : "[STANDARD]   ";
      const phaseTag = c.currentPhase === 0 ? "[P0→P1 基础建档]" : "[P1→P2 深度分析]";
      logMessage(`  [${(i + 1).toString().padStart(2, " ")}] ${tag} ${phaseTag} [${c.market.toUpperCase()}] ${c.ticker.padEnd(10)} - ${displayName}`);
    }

    if (dryRun) {
      logMessage("\nDry-run complete. No changes were made to the database.");
      clearTimeout(timeoutTimer);
      releaseLock();
      process.exit(0);
    }

    if (candidateList.length === 0) {
      logMessage("No candidates available for onboarding. Work complete!");
      clearTimeout(timeoutTimer);
      releaseLock();
      process.exit(0);
    }

    let succeeded = 0;
    let failed = 0;
    const batchStartTime = Date.now();

    for (let i = 0; i < candidateList.length; i++) {
      const company = candidateList[i];
      const startMs = Date.now();
      const phaseTag = company.currentPhase === 0 ? "P0→P1" : "P1→P2";
      const targetPhaseStr = String(company.targetPhase);

      logMessage(`\n>>> [${i + 1}/${candidateList.length}] Processing [${phaseTag}] ${company.ticker} (${company.market.toUpperCase()})...`);

      try {
        const exitCode = await runCommand("npm", [
          "run",
          "onboard:company",
          "--",
          "--ticker",
          company.ticker,
          "--market",
          company.market,
          "--phase",
          targetPhaseStr,
        ]);

        if (exitCode !== 0) {
          throw new Error(`onboard:company exited with status code ${exitCode}`);
        }

        // Reset priority after completion of the requested phase
        if (company.isFastTrack) {
          try {
            await prisma.entity.update({
              where: { id: company.id },
              data: { priority: 0 },
            });
          } catch (pErr) {
            console.error(`Failed to reset priority for ${company.ticker}:`, pErr);
          }
        }

        succeeded++;
        const elapsed = formatDuration(Date.now() - startMs);
        logMessage(`✓ [${i + 1}/${candidateList.length}] SUCCESS [${phaseTag}] ${company.ticker} (${elapsed})`);
      } catch (err: unknown) {
        failed++;
        const errMsg = err instanceof Error ? err.message : String(err);
        logMessage(`✗ [${i + 1}/${candidateList.length}] FAILED [${phaseTag}] ${company.ticker}: ${errMsg}`);

        // Update entity failure count
        try {
          const entity = await prisma.entity.findUnique({
            where: { id: company.id },
            select: { metadata: true },
          });
          if (entity) {
            const meta = (entity.metadata as Record<string, unknown>) || {};
            if (company.currentPhase === 0) {
              const attempts = ((meta.onboardPhase1Attempts as number) || 0) + 1;
              await prisma.entity.update({
                where: { id: company.id },
                data: {
                  onboardPhase: attempts >= 3 ? -1 : 0,
                  metadata: {
                    ...meta,
                    onboardPhase1Attempts: attempts,
                    onboardPhase1LastError: errMsg,
                    onboardPhase1LastAttemptAt: new Date().toISOString(),
                  },
                },
              });
            } else {
              // Phase 1 -> Phase 2 failure: retain onboardPhase=1 (don't demote to -1), record phase 2 attempts
              const attempts = ((meta.onboardPhase2Attempts as number) || 0) + 1;
              await prisma.entity.update({
                where: { id: company.id },
                data: {
                  metadata: {
                    ...meta,
                    onboardPhase2Attempts: attempts,
                    onboardPhase2LastError: errMsg,
                    onboardPhase2LastAttemptAt: new Date().toISOString(),
                  },
                },
              });
            }
          }
        } catch (dbErr) {
          console.error("Failed to update entity error metadata:", dbErr);
        }
      }

      if (i < candidateList.length - 1 && delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    const totalElapsed = formatDuration(Date.now() - batchStartTime);
    logMessage("=======================================================");
    logMessage(`BATCH SUMMARY: Succeeded=${succeeded}, Failed=${failed}, Elapsed=${totalElapsed}`);
    logMessage("=======================================================\n");
  } finally {
    clearTimeout(timeoutTimer);
    releaseLock();
    await prisma.$disconnect();
  }
}

main().catch(async (e) => {
  logMessage(`FATAL WORKER ERROR: ${e instanceof Error ? e.message : String(e)}`);
  releaseLock();
  await prisma.$disconnect();
  process.exit(1);
});
