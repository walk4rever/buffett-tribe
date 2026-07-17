/**
 * Batch import all company 10-K/20-F/40-F annual reports from 2020 to latest.
 *
 * Usage:
 *   npm run import:10k:all
 *   npm run import:10k:all -- --from 2020 --to 2026
 *   npm run import:10k:all -- --limit 10
 *   npm run import:10k:all -- --concurrency 3 --filing-concurrency 2
 *
 * Notes:
 * - Runs sequentially by default to avoid SEC throttling.
 * - Use --concurrency 2 or 3 for faster catch-up imports.
 * - Uses a checkpoint file in .cache so reruns skip completed companies.
 */

import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import prisma from "@/lib/prisma";

type Checkpoint = {
  fromYear: number;
  toYear: number;
  source?: "home-companies";
  targetOrder?: Array<{ index: number; cik: string; ticker: string; company: string }>;
  updatedAt?: string;
  completed: Record<string, { ticker: string; company: string; completedAt: string; index?: number; durationMs?: number; attempts?: number }>;
  failed: Record<string, { ticker: string; company: string; error: string; failedAt: string; index?: number; durationMs?: number; attempts?: number }>;
  inProgress?: Record<string, { ticker: string; company: string; startedAt: string; index?: number; attempts?: number }>;
  completedYears?: Record<string, Record<string, { startedAt?: string; completedAt: string; durationMs: number; attempts: number }>>;
  failedYears?: Record<string, Record<string, { startedAt?: string; error: string; failedAt: string; durationMs?: number; attempts: number }>>;
  inProgressYears?: Record<string, Record<string, { startedAt: string; attempts: number }>>;
};

type ImportTarget = {
  entityId: string;
  cik: string;
  company: string;
  ticker: string;
};

const CHECKPOINT_DIR = path.join(process.cwd(), ".cache");
const CHECKPOINT_FILE = path.join(CHECKPOINT_DIR, "import-10k-all.json");

function getArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  return args.find((_, i) => args[i - 1] === flag);
}

function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

function parseYear(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) throw new Error(`Invalid year: ${value}`);
  return n;
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid positive integer: ${value}`);
  return n;
}

function parseNonNegativeInt(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid non-negative integer: ${value}`);
  return n;
}

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

function normalizeTicker(value: string | null | undefined) {
  const ticker = value?.trim().toUpperCase() ?? "";
  return ticker || null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableDbError(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  if (code && ["P1001", "P1002", "P2024"].includes(code)) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /Can't reach database|Timed out|Connection terminated|ECONNRESET|ETIMEDOUT/i.test(message);
}

async function withDbRetry<T>(label: string, fn: () => Promise<T>) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryableDbError(error) || attempt >= 5) break;
      const delayMs = 2000 * 2 ** (attempt - 1);
      console.warn(`[DB] retry ${attempt}/5 ${label} error=${error instanceof Error ? error.message : String(error)} nextDelayMs=${delayMs}`);
      await sleep(delayMs);
    }
  }
  throw lastError;
}

async function runImport(params: {
  target: ImportTarget;
  fromYear: number;
  toYear: number;
  filingConcurrency: number;
  extractTimeoutMs: number;
  companyTimeoutMs: number;
  noEdgarToolsHtml: boolean;
}) {
  const { target, fromYear, toYear, filingConcurrency, extractTimeoutMs, companyTimeoutMs, noEdgarToolsHtml } = params;
  const childArgs = [
    "--env-file=.env.local",
    "./node_modules/.bin/tsx",
    "scripts/import-10k-edgartools.ts",
    "--ticker",
    target.ticker,
    "--from",
    String(fromYear),
    "--to",
    String(toYear),
    "--filing-concurrency",
    String(filingConcurrency),
    "--extract-timeout-ms",
    String(extractTimeoutMs),
  ];
  if (noEdgarToolsHtml) childArgs.push("--no-edgartools-html");

  return new Promise<{ code: number; timedOut: boolean }>((resolve) => {
    let settled = false;
    const child = spawn(
      process.execPath,
      childArgs,
      {
        cwd: process.cwd(),
        env: process.env,
        stdio: ["inherit", "pipe", "pipe"],
        detached: true,
      },
    );
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      console.error(`  child import timed out after ${companyTimeoutMs}ms: ${target.ticker}`);
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGTERM");
          setTimeout(() => {
            try {
              process.kill(-child.pid!, "SIGKILL");
            } catch {
              // process already exited
            }
          }, 5000).unref();
        } catch {
          child.kill("SIGTERM");
        }
      }
      resolve({ code: 124, timedOut: true });
    }, companyTimeoutMs);

    child.stdout.on("data", (chunk) => process.stdout.write(chunk));
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ code: code ?? 1, timedOut: false });
    });
  });
}

async function runPool<T>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<void>) {
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      await fn(items[index], index);
    }
  });
  await Promise.all(workers);
}

async function loadCheckpoint(fromYear: number, toYear: number, fresh: boolean): Promise<Checkpoint> {
  await mkdir(CHECKPOINT_DIR, { recursive: true });
  if (fresh) {
    return {
      fromYear,
      toYear,
      source: "home-companies",
      completed: {},
      failed: {},
      inProgress: {},
      completedYears: {},
      failedYears: {},
      inProgressYears: {},
    };
  }

  try {
    const raw = await readFile(CHECKPOINT_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<Checkpoint>;
    if (parsed.fromYear === fromYear && parsed.toYear === toYear) {
      return {
        fromYear,
        toYear,
        source: parsed.source ?? "home-companies",
        targetOrder: parsed.targetOrder,
        updatedAt: parsed.updatedAt,
        completed: parsed.completed ?? {},
        failed: parsed.failed ?? {},
        inProgress: parsed.inProgress ?? {},
        completedYears: parsed.completedYears ?? {},
        failedYears: parsed.failedYears ?? {},
        inProgressYears: parsed.inProgressYears ?? {},
      };
    }
  } catch {
    // no checkpoint yet
  }
  return { fromYear, toYear, source: "home-companies", completed: {}, failed: {}, inProgress: {}, completedYears: {}, failedYears: {}, inProgressYears: {} };
}

async function saveCheckpoint(checkpoint: Checkpoint) {
  await mkdir(CHECKPOINT_DIR, { recursive: true });
  checkpoint.updatedAt = new Date().toISOString();
  await writeFile(CHECKPOINT_FILE, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
}

async function getTargets(limit?: number): Promise<ImportTarget[]> {
  const companies = await withDbRetry("load homepage companies", () =>
    prisma.entity.findMany({
      where: {
        type: "company",
        cik: { not: null },
      },
      select: {
        id: true,
        canonicalName: true,
        ticker: true,
        cik: true,
        securitiesAsCompany: {
          select: { ticker: true },
          orderBy: { ticker: "asc" },
        },
      },
      orderBy: { canonicalName: "asc" },
      take: 200,
    }),
  );

  const targets: ImportTarget[] = [];
  const seenCik = new Set<string>();

  for (const company of companies) {
    const cik = company.cik?.trim();
    if (!cik || seenCik.has(cik)) continue;

    const tickers = unique([
      normalizeTicker(company.ticker),
      ...company.securitiesAsCompany.map((security) => normalizeTicker(security.ticker)),
    ]).filter((ticker): ticker is string => Boolean(ticker));

    const ticker = tickers[0];
    if (!ticker) continue;

    seenCik.add(cik);
    targets.push({
      entityId: company.id,
      cik,
      company: company.canonicalName,
      ticker,
    });

    if (limit && targets.length >= limit) break;
  }

  return targets;
}

async function main() {
  const defaultToYear = new Date().getUTCFullYear();
  const fromYear = parseYear(getArg("--from"), 2020);
  const toYear = parseYear(getArg("--to"), defaultToYear);
  const limitArg = getArg("--limit");
  const limit = limitArg ? Number.parseInt(limitArg, 10) : undefined;
  const concurrencyArg = getArg("--concurrency");
  const concurrency = parsePositiveInt(concurrencyArg, 1);
  const filingConcurrencyArg = getArg("--filing-concurrency");
  const filingConcurrency = parsePositiveInt(filingConcurrencyArg, 1);
  const extractTimeoutMs = parsePositiveInt(getArg("--extract-timeout-ms"), 8 * 60 * 1000);
  const companyTimeoutMs = parsePositiveInt(getArg("--company-timeout-ms"), 45 * 60 * 1000);
  const retries = parseNonNegativeInt(getArg("--retries"), 2);
  const retryDelayMs = parseNonNegativeInt(getArg("--retry-delay-ms"), 10_000);
  const noEdgarToolsHtml = hasFlag("--no-edgartools-html");
  const dryRun = hasFlag("--dry-run");
  const fresh = hasFlag("--fresh");

  if (Number.isNaN(limit ?? 0)) {
    throw new Error(`Invalid --limit value: ${limitArg}`);
  }
  const checkpoint = await loadCheckpoint(fromYear, toYear, fresh);
  const targets = await getTargets(limit);
  checkpoint.source = "home-companies";
  checkpoint.targetOrder = targets.map((target, index) => ({
    index: index + 1,
    cik: target.cik,
    ticker: target.ticker,
    company: target.company,
  }));
  checkpoint.inProgress ??= {};
  checkpoint.completedYears ??= {};
  checkpoint.failedYears ??= {};
  checkpoint.inProgressYears ??= {};
  await saveCheckpoint(checkpoint);

  console.log(`Found ${targets.length} homepage companies to import annual reports for (${fromYear} -> ${toYear})`);
  console.log(`Concurrency: ${concurrency}`);
  console.log(
    `Child filing concurrency: ${filingConcurrency}; archive strategy: standard`,
  );
  console.log(`edgartools primary HTML preload: ${noEdgarToolsHtml ? "disabled" : "enabled"}`);
  console.log(`Timeouts: extract=${extractTimeoutMs}ms; company=${companyTimeoutMs}ms`);
  console.log(`Retries: ${retries}; retryDelay=${retryDelayMs}ms`);
  console.log(`Checkpoint: ${CHECKPOINT_FILE}`);

  let completed = 0;
  let skipped = 0;
  let failed = 0;
  let completedYearCount = 0;
  let skippedYearCount = 0;
  let failedYearCount = 0;

  await runPool(targets, concurrency, async (target, index) => {
    if (checkpoint.completed[target.cik]) {
      skipped++;
      console.log(`\n[SKIP] ${target.company} (${target.ticker}) already completed`);
      return;
    }

    const targetIndex = index + 1;
    console.log(`\n[${targetIndex}/${targets.length}] ${target.company} (${target.ticker}) [CIK ${target.cik}]`);

    if (dryRun) {
      console.log(`  DRY-RUN: would import ${target.ticker} for ${fromYear} -> ${toYear}`);
      return;
    }

    const years = Array.from({ length: toYear - fromYear + 1 }, (_, yearIndex) => toYear - yearIndex);
    checkpoint.completedYears![target.cik] ??= {};
    checkpoint.failedYears![target.cik] ??= {};
    checkpoint.inProgressYears![target.cik] ??= {};
    let companyFailed = false;

    for (const year of years) {
      const yearKey = String(year);
      if (checkpoint.completedYears![target.cik][yearKey]) {
        skippedYearCount++;
        console.log(`  [${year}] skip completed`);
        continue;
      }

      let attempts =
        checkpoint.failedYears![target.cik][yearKey]?.attempts ??
        checkpoint.inProgressYears![target.cik][yearKey]?.attempts ??
        0;
      let lastFailure: { error: string; durationMs: number } | null = null;

      for (let retry = 0; retry <= retries; retry++) {
        attempts++;
        console.log(`  [${year}] attempt ${attempts}${retry > 0 ? ` (retry ${retry}/${retries})` : ""}`);
        const startedAt = Date.now();
        checkpoint.inProgress![target.cik] = {
          ticker: target.ticker,
          company: target.company,
          startedAt: new Date(startedAt).toISOString(),
          index: targetIndex,
          attempts,
        };
        checkpoint.inProgressYears![target.cik][yearKey] = {
          startedAt: new Date(startedAt).toISOString(),
          attempts,
        };
        await saveCheckpoint(checkpoint);

        const res = await runImport({
          target,
          fromYear: year,
          toYear: year,
          filingConcurrency,
          extractTimeoutMs,
          companyTimeoutMs,
          noEdgarToolsHtml,
        });
        const durationMs = Date.now() - startedAt;
        if (res.code === 0) {
          completedYearCount++;
          checkpoint.completedYears![target.cik][yearKey] = {
            startedAt: new Date(startedAt).toISOString(),
            completedAt: new Date().toISOString(),
            durationMs,
            attempts,
          };
          delete checkpoint.failedYears![target.cik][yearKey];
          delete checkpoint.inProgressYears![target.cik][yearKey];
          await saveCheckpoint(checkpoint);
          console.log(`  [${year}] ✓ completed in ${(durationMs / 1000).toFixed(1)}s`);
          lastFailure = null;
          break;
        }

        lastFailure = {
          error: res.timedOut ? `import timed out after ${companyTimeoutMs}ms` : `import exited with code ${res.code}`,
          durationMs,
        };
        console.log(`  [${year}] attempt failed in ${(durationMs / 1000).toFixed(1)}s: ${lastFailure.error}`);
        if (retry < retries) await sleep(retryDelayMs);
      }

      if (lastFailure) {
        failedYearCount++;
        companyFailed = true;
        checkpoint.failedYears![target.cik][yearKey] = {
          startedAt: checkpoint.inProgressYears![target.cik][yearKey]?.startedAt,
          error: lastFailure.error,
          failedAt: new Date().toISOString(),
          durationMs: lastFailure.durationMs,
          attempts,
        };
        delete checkpoint.inProgressYears![target.cik][yearKey];
        await saveCheckpoint(checkpoint);
        console.log(`  [${year}] ✗ failed`);
      }
    }

    delete checkpoint.inProgress![target.cik];
    if (companyFailed) {
      failed++;
      checkpoint.failed[target.cik] = {
        ticker: target.ticker,
        company: target.company,
        error: "one or more years failed",
        failedAt: new Date().toISOString(),
        index: targetIndex,
      };
    } else {
      completed++;
      checkpoint.completed[target.cik] = {
        ticker: target.ticker,
        company: target.company,
        completedAt: new Date().toISOString(),
        index: targetIndex,
      };
      delete checkpoint.failed[target.cik];
    }
    await saveCheckpoint(checkpoint);
  });

  console.log(`\nDone. completedCompanies=${completed} skippedCompanies=${skipped} failedCompanies=${failed}`);
  console.log(`Years: completed=${completedYearCount} skipped=${skippedYearCount} failed=${failedYearCount}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[import-all-10k-edgartools] fatal", err);
  await prisma.$disconnect();
  process.exit(1);
});
