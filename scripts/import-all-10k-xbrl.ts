/**
 * Batch import all company 10-K/20-F/40-F annual reports from 2020 to latest.
 *
 * Usage:
 *   npm run import:10k:all
 *   npm run import:10k:all -- --from 2020 --to 2026
 *   npm run import:10k:all -- --limit 10
 *
 * Notes:
 * - Runs sequentially to avoid SEC throttling.
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
  completed: Record<string, { ticker: string; company: string; completedAt: string }>;
  failed: Record<string, { ticker: string; company: string; error: string; failedAt: string }>;
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

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

function normalizeTicker(value: string | null | undefined) {
  const ticker = value?.trim().toUpperCase() ?? "";
  return ticker || null;
}

async function runImport(target: ImportTarget, fromYear: number, toYear: number) {
  return new Promise<{ code: number }>((resolve) => {
    const child = spawn(
      process.execPath,
      [
        "--env-file=.env.local",
        "./node_modules/.bin/tsx",
        "scripts/import-10k-xbrl.ts",
        "--ticker",
        target.ticker,
        "--from",
        String(fromYear),
        "--to",
        String(toYear),
      ],
      {
        cwd: process.cwd(),
        env: process.env,
        stdio: ["inherit", "pipe", "pipe"],
      },
    );

    child.stdout.on("data", (chunk) => process.stdout.write(chunk));
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.on("close", (code) => resolve({ code: code ?? 1 }));
  });
}

async function loadCheckpoint(fromYear: number, toYear: number): Promise<Checkpoint> {
  await mkdir(CHECKPOINT_DIR, { recursive: true });
  try {
    const raw = await readFile(CHECKPOINT_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<Checkpoint>;
    if (parsed.fromYear === fromYear && parsed.toYear === toYear) {
      return {
        fromYear,
        toYear,
        completed: parsed.completed ?? {},
        failed: parsed.failed ?? {},
      };
    }
  } catch {
    // no checkpoint yet
  }
  return { fromYear, toYear, completed: {}, failed: {} };
}

async function saveCheckpoint(checkpoint: Checkpoint) {
  await mkdir(CHECKPOINT_DIR, { recursive: true });
  await writeFile(CHECKPOINT_FILE, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
}

async function getTargets(limit?: number): Promise<ImportTarget[]> {
  const companies = await prisma.entity.findMany({
    where: {
      type: { in: ["company", "master"] },
      cik: { not: null },
    },
    select: {
      id: true,
      canonicalName: true,
      ticker: true,
      cik: true,
      securitiesAsCompany: {
        select: {
          ticker: true,
          isPrimary: true,
        },
        orderBy: [{ isPrimary: "desc" }, { ticker: "asc" }],
      },
    },
    orderBy: { canonicalName: "asc" },
  });

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
  const dryRun = hasFlag("--dry-run");

  if (Number.isNaN(limit ?? 0)) {
    throw new Error(`Invalid --limit value: ${limitArg}`);
  }

  const checkpoint = await loadCheckpoint(fromYear, toYear);
  const targets = await getTargets(limit);

  console.log(`Found ${targets.length} companies to import 10-K data for (${fromYear} -> ${toYear})`);
  console.log(`Checkpoint: ${CHECKPOINT_FILE}`);

  let completed = 0;
  let skipped = 0;
  let failed = 0;

  for (const target of targets) {
    if (checkpoint.completed[target.cik]) {
      skipped++;
      console.log(`\n[SKIP] ${target.company} (${target.ticker}) already completed`);
      continue;
    }

    console.log(`\n[${completed + skipped + failed + 1}/${targets.length}] ${target.company} (${target.ticker}) [CIK ${target.cik}]`);

    if (dryRun) {
      console.log(`  DRY-RUN: would import ${target.ticker} for ${fromYear} -> ${toYear}`);
      continue;
    }

    const res = await runImport(target, fromYear, toYear);
    if (res.code === 0) {
      completed++;
      checkpoint.completed[target.cik] = {
        ticker: target.ticker,
        company: target.company,
        completedAt: new Date().toISOString(),
      };
      delete checkpoint.failed[target.cik];
      await saveCheckpoint(checkpoint);
      console.log(`  ✓ completed`);
    } else {
      failed++;
      checkpoint.failed[target.cik] = {
        ticker: target.ticker,
        company: target.company,
        error: `import exited with code ${res.code}`,
        failedAt: new Date().toISOString(),
      };
      await saveCheckpoint(checkpoint);
      console.log(`  ✗ failed`);
    }
  }

  console.log(`\nDone. completed=${completed} skipped=${skipped} failed=${failed}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[import-all-10k-xbrl] fatal", err);
  await prisma.$disconnect();
  process.exit(1);
});
