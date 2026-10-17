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
import { pathToFileURL } from "node:url";
import prisma from "@/lib/prisma";
import { evaluateOnboardExclusion } from "@/lib/onboard-exclusion";

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
export const DEAD_LETTER_BACKOFF_MS = 24 * 60 * 60 * 1000; // 24 hours

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

let lockAcquired = false;

export function acquireLock(pidFilePath = PID_FILE): boolean {
  mkdirSync(path.dirname(pidFilePath), { recursive: true });
  if (existsSync(pidFilePath)) {
    try {
      const existingPid = parseInt(readFileSync(pidFilePath, "utf8").trim(), 10);
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
    writeFileSync(pidFilePath, String(process.pid), "utf8");
    lockAcquired = true;
    return true;
  } catch {
    return false;
  }
}

export function releaseLock(pidFilePath = PID_FILE) {
  if (!lockAcquired) return;
  try {
    if (existsSync(pidFilePath)) {
      const existingPid = parseInt(readFileSync(pidFilePath, "utf8").trim(), 10);
      if (!existingPid || Number.isNaN(existingPid) || existingPid === process.pid) {
        unlinkSync(pidFilePath);
      }
    }
  } catch {
    // Ignore cleanup error
  } finally {
    lockAcquired = false;
  }
}

export function computeInterCompanyDelayMs(
  delayMs: number,
  randomFn: () => number = Math.random,
): number {
  const baseDelayMs = Math.max(0, Number.isFinite(delayMs) ? delayMs : 1000);
  const jitterMs = Math.floor(randomFn() * 1000);
  return baseDelayMs + jitterMs;
}

let activeChildPid: number | null = null;

async function killChildProcessGroup(pid: number | null): Promise<void> {
  if (!pid) return;
  try {
    // Negative PID sends SIGTERM to the entire process group, allowing graceful DB disconnect
    process.kill(-pid, "SIGTERM");
  } catch {
    // Process group may have already exited
    return;
  }

  // Allow up to 3 seconds for child process group cleanup and Prisma disconnect
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    try {
      process.kill(-pid, 0); // Check if process group is still alive
      await new Promise((resolve) => setTimeout(resolve, 200));
    } catch {
      // Process group exited cleanly
      return;
    }
  }

  // Fallback to SIGKILL only if process group is still hanging
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // Ignore error if exited in between
  }
}

function runCommandWithTimeout(
  cmd: string,
  args: string[],
  timeoutMs: number
): Promise<{ exitCode: number; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      env: process.env,
      cwd: process.cwd(),
      detached: true,
    });

    activeChildPid = child.pid ?? null;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid) {
        killChildProcessGroup(child.pid);
      }
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      activeChildPid = null;
      resolve({ exitCode: timedOut ? 124 : (code ?? 1), timedOut });
    });

    child.on("error", () => {
      clearTimeout(timer);
      activeChildPid = null;
      resolve({ exitCode: 1, timedOut });
    });
  });
}

function formatDuration(ms: number): string {
  const totalSecs = Math.round(ms / 1000);
  if (totalSecs < 60) return `${totalSecs}s`;
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${mins}m ${secs}s`;
}

export interface SelfHealDeadLetterOptions {
  forceHeal?: boolean;
  dryRun?: boolean;
  dbClient?: typeof prisma;
  nowMs?: number;
}

/**
 * Auto-recover dead-letter priority companies (onboardPhase = -1 with priority > 0)
 * after a 24-hour backoff period (or immediately when --heal-deadletter is passed)
 * so transient outages don't leave priority targets permanently abandoned.
 */
export async function selfHealDeadLetterPriorityCompanies(
  options: SelfHealDeadLetterOptions = {},
): Promise<number> {
  const {
    forceHeal = false,
    dryRun = false,
    dbClient = prisma,
    nowMs = Date.now(),
  } = options;

  if (dryRun) return 0;

  const deadLetters = await dbClient.entity.findMany({
    where: {
      type: "company",
      onboardPhase: -1,
      priority: { gt: 0 },
    },
    select: { id: true, ticker: true, metadata: true },
    take: 10,
  });

  let healedCount = 0;
  for (const dl of deadLetters) {
    const meta = (dl.metadata as Record<string, unknown>) || {};
    if (meta.isExcluded) continue; // Skip manually or policy-excluded entities

    // Check last attempt time and backoff: at least 24 hours since last attempt unless --heal-deadletter is set
    const lastAttemptStr =
      (meta.onboardPhase1LastAttemptAt as string) ||
      (meta.onboardPhase2LastAttemptAt as string) ||
      (meta.phase3LastAttemptAt as string);
    if (!forceHeal && lastAttemptStr) {
      const lastAttemptMs = new Date(lastAttemptStr).getTime();
      if (!Number.isNaN(lastAttemptMs) && nowMs - lastAttemptMs < DEAD_LETTER_BACKOFF_MS) {
        continue; // Wait for 24h backoff window
      }
    }

    const reasonLabel = forceHeal ? "--heal-deadletter 强制触发" : "24h+ 退避窗口已过";
    logMessage(`[Dead-Letter Self-Healing] 自动自愈重点关注标的 ${dl.ticker ?? dl.id}: 重置 onboardPhase -1 -> 0 (${reasonLabel})`);
    await dbClient.entity.update({
      where: { id: dl.id },
      data: {
        onboardPhase: 0,
        metadata: {
          ...meta,
          onboardPhase1Attempts: 0,
          onboardPhase2Attempts: 0,
          healedFromDeadLetterAt: new Date(nowMs).toISOString(),
        },
      },
    }).catch(() => {});
    healedCount++;
  }
  return healedCount;
}

/**
 * Fetch fast-track expedited candidates:
 * Covers both Phase 0 (target Phase 1) and Phase 1 (target Phase 2) companies with priority > 0.
 */
async function fetchFastTrackCandidates(
  limit: number,
  marketFilter?: Market,
  dryRun = false,
): Promise<CandidateCompany[]> {
  const rows = await prisma.entity.findMany({
    where: {
      type: "company",
      onboardPhase: { gte: 0 },
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
      : r.onboardPhase === 1
      ? (typeof meta.onboardPhase2Attempts === "number" ? meta.onboardPhase2Attempts : 0)
      : (typeof meta.phase3Attempts === "number" ? meta.phase3Attempts : 0);

    if (attempts >= 3) {
      if (!dryRun && (r.priority ?? 0) > 0) {
        await prisma.entity.update({
          where: { id: r.id },
          data: {
            onboardPhase: r.onboardPhase === 0 ? -1 : r.onboardPhase,
            priority: r.onboardPhase === 0 ? r.priority : 0,
            priorityRequestedAt: r.onboardPhase === 0 ? r.priorityRequestedAt : null,
          },
        }).catch(() => {});
      }
      continue; // Skip persistent failures
    }

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

    const exclusion = evaluateOnboardExclusion({
      ticker,
      code: r.code,
      canonicalName: r.canonicalName,
      market: m,
      onboardPhase: r.onboardPhase,
      metadata: meta,
    });
    if (exclusion.isExcluded) {
      if (!dryRun) {
        await prisma.entity.update({
          where: { id: r.id },
          data: {
            onboardPhase: -1,
            priority: 0,
            priorityRequestedAt: null,
            metadata: {
              ...meta,
              isExcluded: true,
              exclusionReason: exclusion.reason,
              exclusionLabel: exclusion.label,
              excludedAt: new Date().toISOString(),
            },
          },
        }).catch(() => {});
      }
      continue;
    }

    candidates.push({
      id: r.id,
      market: m,
      ticker,
      code: r.code,
      canonicalName: r.canonicalName,
      nameZh: typeof meta.nameZh === "string" ? meta.nameZh : undefined,
      priorityScore: 1000 + (r.priority ?? 0),
      currentPhase: r.onboardPhase,
      targetPhase: r.onboardPhase === 0 ? 1 : r.onboardPhase === 1 ? 2 : 3,
      isFastTrack: true,
    });
  }

  return candidates;
}

/**
 * Fetch standard candidate companies for a market and target phase.
 */
async function fetchCandidatesForMarket(
  market: Market,
  targetPhase: 1 | 2,
  limit: number,
  excludeIds: Set<string> = new Set(),
  dryRun = false,
): Promise<CandidateCompany[]> {
  if (limit <= 0) return [];
  const currentPhase = targetPhase === 1 ? 0 : 1;

  const rows = await prisma.entity.findMany({
    where: {
      type: "company",
      market,
      onboardPhase: currentPhase,
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
    const attempts = targetPhase === 1
      ? (typeof meta.onboardPhase1Attempts === "number" ? meta.onboardPhase1Attempts : 0)
      : (typeof meta.onboardPhase2Attempts === "number" ? meta.onboardPhase2Attempts : 0);

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

    const exclusion = evaluateOnboardExclusion({
      ticker,
      code: r.code,
      canonicalName: r.canonicalName,
      market,
      onboardPhase: currentPhase,
      metadata: meta,
    });
    if (exclusion.isExcluded) {
      if (!dryRun) {
        await prisma.entity.update({
          where: { id: r.id },
          data: {
            onboardPhase: -1,
            priority: 0,
            priorityRequestedAt: null,
            metadata: {
              ...meta,
              isExcluded: true,
              exclusionReason: exclusion.reason,
              exclusionLabel: exclusion.label,
              excludedAt: new Date().toISOString(),
            },
          },
        }).catch(() => {});
      }
      continue;
    }

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
      currentPhase,
      targetPhase,
      isFastTrack: false,
    });
  }

  candidates.sort((a, b) => b.priorityScore - a.priorityScore || a.canonicalName.localeCompare(b.canonicalName));
  return candidates.slice(0, limit);
}

/**
 * Fetch standard pool candidate companies with dual-drive balance:
 * ~1/3 P1->P2 (deep analysis for already profiled companies, ~5 of 15)
 * ~2/3 P0->P1 (base profiling for pending universe companies, ~10 of 15)
 * With cross-market round-robin (US/HK/CN) and automatic slot fallback.
 */
async function fetchStandardCandidates(
  targetMarket: string,
  totalSlots: number,
  excludeIds: Set<string>,
  phaseFilter?: string,
  dryRun = false,
): Promise<CandidateCompany[]> {
  if (totalSlots <= 0) return [];

  const fetchPool = async (phase: 1 | 2, limit: number, currentExcludes: Set<string>): Promise<CandidateCompany[]> => {
    if (limit <= 0) return [];
    if (targetMarket === "all") {
      const perMarket = Math.ceil(limit / 3);
      const [usList, hkList, cnList] = await Promise.all([
        fetchCandidatesForMarket("us", phase, perMarket, currentExcludes, dryRun),
        fetchCandidatesForMarket("hk", phase, perMarket, currentExcludes, dryRun),
        fetchCandidatesForMarket("cn", phase, perMarket, currentExcludes, dryRun),
      ]);
      const merged: CandidateCompany[] = [];
      const maxLen = Math.max(usList.length, hkList.length, cnList.length);
      for (let i = 0; i < maxLen; i++) {
        if (usList[i]) merged.push(usList[i]);
        if (hkList[i]) merged.push(hkList[i]);
        if (cnList[i]) merged.push(cnList[i]);
      }
      return merged.slice(0, limit);
    } else if (targetMarket === "us" || targetMarket === "hk" || targetMarket === "cn") {
      return fetchCandidatesForMarket(targetMarket as Market, phase, limit, currentExcludes, dryRun);
    } else {
      throw new Error(`Invalid --market "${targetMarket}". Expected all, us, hk, or cn.`);
    }
  };

  if (phaseFilter === "1") {
    return fetchPool(1, totalSlots, excludeIds);
  }
  if (phaseFilter === "2") {
    return fetchPool(2, totalSlots, excludeIds);
  }
  if (phaseFilter === "3") {
    return [];
  }

  // Dual-drive balance: 1/3 P1->P2 (deep analysis, ~5 of 15), 2/3 P0->P1 (base profiling, ~10 of 15)
  // Prioritizes rapid clearance of the 15,000+ P0 stubs while steadily advancing P2
  const desiredP2 = Math.min(5, Math.floor(totalSlots / 3));
  const p2List = await fetchPool(2, desiredP2, excludeIds);

  const currentExcludes = new Set([...excludeIds, ...p2List.map((c) => c.id)]);
  const p0SlotsNeeded = totalSlots - p2List.length;
  const p0List = await fetchPool(1, p0SlotsNeeded, currentExcludes);
  for (const c of p0List) currentExcludes.add(c.id);

  // If P0 didn't use all remaining slots, top up with more P2
  const stillNeeded = totalSlots - (p2List.length + p0List.length);
  let extraP2List: CandidateCompany[] = [];
  if (stillNeeded > 0) {
    extraP2List = await fetchPool(2, stillNeeded, currentExcludes);
  }

  const allP2 = [...p2List, ...extraP2List];
  // Interleave P0->P1 (2) and P1->P2 (1) for steady progress across both frontiers
  const interleaved: CandidateCompany[] = [];
  let p0Idx = 0;
  let p2Idx = 0;
  while (p0Idx < p0List.length || p2Idx < allP2.length) {
    if (p0Idx < p0List.length) interleaved.push(p0List[p0Idx++]);
    if (p0Idx < p0List.length) interleaved.push(p0List[p0Idx++]);
    if (p2Idx < allP2.length) interleaved.push(allP2[p2Idx++]);
  }

  return interleaved.slice(0, totalSlots);
}

async function main() {
  const dryRun = hasFlag("--dry-run");
  const healDeadLetter = hasFlag("--heal-deadletter");
  const batchSize = Math.max(1, parseInt(getArg("--batch-size") ?? "15", 10));
  const targetMarket = (getArg("--market") ?? "all").toLowerCase();
  const delayMs = parseInt(getArg("--delay") ?? "1000", 10);
  const customTimeoutArg = getArg("--company-timeout-mins");
  const customCompanyTimeoutMs = customTimeoutArg ? Math.max(1, parseInt(customTimeoutArg, 10)) * 60 * 1000 : null;
  const companyTimeoutMins = customTimeoutArg ? Math.max(1, parseInt(customTimeoutArg, 10)) : 8; // Phase 2/3 default max
  const defaultGlobalTimeout = Math.min(Math.max(45, Math.ceil(batchSize * companyTimeoutMins + 5)), 55);
  const timeoutMins = parseInt(getArg("--timeout-mins") ?? String(defaultGlobalTimeout), 10);
  const priorityOnly = hasFlag("--priority-only");
  const phaseFilter = getArg("--phase"); // optional override: "1" | "2"

  logMessage("=======================================================");
  logMessage(`PRIORITY BATCH WORKER STARTED [Mode: ${dryRun ? "DRY-RUN" : "LIVE"}${priorityOnly ? ", PRIORITY-ONLY" : ""}${healDeadLetter ? ", HEAL-DEADLETTER" : ""}]`);
  logMessage(`Configuration: BatchSize=${batchSize}, Market=${targetMarket}, Delay=${delayMs}ms (+0~999ms jitter), Timeout=${timeoutMins}m, CompanyTimeout=${customTimeoutArg ? `${companyTimeoutMins}m (custom)` : "P1: 5m, P2/P3: 8m (dynamic)"}, PriorityOnly=${priorityOnly}${phaseFilter ? `, Phase=${phaseFilter}` : ""}`);

  if (!dryRun) {
    if (!acquireLock()) {
      logMessage("Notice: Another worker process is already running. Exiting cleanly.");
      process.exit(0);
    }
  }

  // Setup hard timeout guard (Dead Man's Switch)
  const timeoutTimer = setTimeout(async () => {
    logMessage(`WARNING: Worker reached maximum execution timeout of ${timeoutMins} minutes! Exiting gracefully.`);
    if (activeChildPid) {
      await killChildProcessGroup(activeChildPid);
    }
    releaseLock();
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  }, timeoutMins * 60 * 1000);

  let shuttingDown = false;
  const cleanupAndExit = async (signal: string, code: number) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logMessage(`Worker received ${signal}. Cleaning up child processes and exiting...`);
    if (activeChildPid) {
      await killChildProcessGroup(activeChildPid);
    }
    releaseLock();
    await prisma.$disconnect().catch(() => {});
    process.exit(code);
  };
  process.on("SIGINT", () => {
    void cleanupAndExit("SIGINT", 130);
  });
  process.on("SIGTERM", () => {
    void cleanupAndExit("SIGTERM", 143);
  });

  try {
    let candidateList: CandidateCompany[] = [];

    // 0. Auto-recover any priority companies that died transiently into dead-letter (onboardPhase = -1)
    if (!dryRun) {
      await selfHealDeadLetterPriorityCompanies({ forceHeal: healDeadLetter, dryRun });
    }

    // 1. Fetch Fast-Track expedited companies first (Phase 0, Phase 1, Phase 2)
    let fastTrackList = await fetchFastTrackCandidates(
      batchSize,
      targetMarket === "all" ? undefined : (targetMarket as Market),
      dryRun,
    );
    if (phaseFilter) {
      fastTrackList = fastTrackList.filter((c) => String(c.targetPhase) === phaseFilter);
    }
    const excludeIds = new Set(fastTrackList.map((c) => c.id));
    const remainingSlots = Math.max(0, batchSize - fastTrackList.length);

    let regularList: CandidateCompany[] = [];

    // 2. Supplement remaining slots with standard dual-drive companies (P1->P2 and P0->P1)
    if (!priorityOnly && remainingSlots > 0 && phaseFilter !== "3") {
      regularList = await fetchStandardCandidates(targetMarket, remainingSlots, excludeIds, phaseFilter, dryRun);
    }

    candidateList = [...fastTrackList, ...regularList];

    logMessage(`Found ${candidateList.length} candidate companies (${fastTrackList.length} fast-track expedited):`);
    for (let i = 0; i < candidateList.length; i++) {
      const c = candidateList[i];
      const displayName = c.nameZh ? `${c.canonicalName} (${c.nameZh})` : c.canonicalName;
      const tag = c.isFastTrack ? "[⚡ FAST-TRACK]" : "[STANDARD]   ";
      const phaseTag = c.targetPhase === 3 ? "[P2→P3 持续更新]" : c.currentPhase === 0 ? "[P0→P1 基础建档]" : "[P1→P2 深度分析]";
      logMessage(`  [${(i + 1).toString().padStart(2, " ")}] ${tag} ${phaseTag} [${c.market.toUpperCase()}] ${c.ticker.padEnd(10)} - ${displayName}`);
    }

    if (dryRun) {
      logMessage("\nDry-run complete. No changes were made to the database.");
      clearTimeout(timeoutTimer);
      await prisma.$disconnect();
      return;
    }

    if (candidateList.length === 0) {
      logMessage("No candidates available for onboarding. Work complete!");
      clearTimeout(timeoutTimer);
      releaseLock();
      await prisma.$disconnect();
      return;
    }

    let succeeded = 0;
    let failed = 0;
    const batchStartTime = Date.now();

    for (let i = 0; i < candidateList.length; i++) {
      const company = candidateList[i];
      const startMs = Date.now();
      const phaseTag = company.targetPhase === 3 ? "P2→P3" : company.currentPhase === 0 ? "P0→P1" : "P1→P2";
      const targetPhaseStr = String(company.targetPhase);

      logMessage(`\n>>> [${i + 1}/${candidateList.length}] Processing [${phaseTag}] ${company.ticker} (${company.market.toUpperCase()})...`);

      try {
        const cmd = "npm";
        const args =
          company.targetPhase === 3
            ? ["run", "process:phase3", "--", "--ticker", company.ticker, "--market", company.market]
            : [
                "run",
                "onboard:company",
                "--",
                "--ticker",
                company.ticker,
                "--market",
                company.market,
                "--phase",
                targetPhaseStr,
              ];

        const targetTimeoutMs = customCompanyTimeoutMs ?? (
          company.targetPhase === 1 ? 5 * 60 * 1000 : 8 * 60 * 1000
        );
        const targetTimeoutMins = Math.round(targetTimeoutMs / 60000);

        const { exitCode, timedOut } = await runCommandWithTimeout(
          cmd,
          args,
          targetTimeoutMs
        );

        if (timedOut) {
          throw new Error(`单标的执行超时（超过 ${targetTimeoutMins} 分钟），已主动熔断跳过并清理进程组`);
        }

        if (exitCode !== 0) {
          throw new Error(`${args.join(" ")} exited with status code ${exitCode}`);
        }

        // Reset priority after completion of the requested phase
        if (company.isFastTrack) {
          try {
            await prisma.entity.update({
              where: { id: company.id },
              data: {
                priority: 0,
                priorityRequestedAt: null,
              },
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

        // Update entity failure count with retry to guarantee error tracking even under pool contention
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            if (attempt > 1) {
              await new Promise((r) => setTimeout(r, 1000 * attempt));
            }
            const entity = await prisma.entity.findUnique({
              where: { id: company.id },
              select: { metadata: true },
            });
            if (entity) {
              const meta = (entity.metadata as Record<string, unknown>) || {};
              if (company.targetPhase === 3) {
                const attempts = ((meta.phase3Attempts as number) || 0) + 1;
                await prisma.entity.update({
                  where: { id: company.id },
                  data: {
                    priority: attempts >= 3 ? 0 : Math.max(0, company.priorityScore - 1000),
                    priorityRequestedAt: attempts >= 3 ? null : undefined,
                    metadata: {
                      ...meta,
                      phase3Attempts: attempts,
                      phase3LastError: errMsg,
                      phase3LastAttemptAt: new Date().toISOString(),
                    },
                  },
                });
              } else if (company.currentPhase === 0) {
                const attempts = ((meta.onboardPhase1Attempts as number) || 0) + 1;
                // Preserve priority > 0 when demoting fast-track companies to dead-letter (-1)
                // so selfHealDeadLetterPriorityCompanies can select them after the 24h backoff window.
                await prisma.entity.update({
                  where: { id: company.id },
                  data: {
                    onboardPhase: attempts >= 3 ? -1 : 0,
                    priority: company.isFastTrack ? Math.max(1, company.priorityScore - 1000) : undefined,
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
                    priority: attempts >= 3 ? 0 : (company.isFastTrack ? Math.max(0, company.priorityScore - 1000) : undefined),
                    priorityRequestedAt: attempts >= 3 ? null : undefined,
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
            break; // Success
          } catch (dbErr) {
            if (attempt === 3) {
              console.error(`Failed to update entity error metadata for ${company.ticker} after 3 attempts:`, dbErr);
            }
          }
        }
      }

      if (i < candidateList.length - 1) {
        // Add random jitter (0~999ms) to base delay (default 1000ms -> 1000~1999ms) to protect external API rate limits
        const totalSleepMs = computeInterCompanyDelayMs(delayMs);
        await new Promise((r) => setTimeout(r, totalSleepMs));
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(async (e) => {
    logMessage(`FATAL WORKER ERROR: ${e instanceof Error ? e.message : String(e)}`);
    releaseLock();
    await prisma.$disconnect();
    process.exit(1);
  });
}
