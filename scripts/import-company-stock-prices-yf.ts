import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import db from "../src/lib/prisma.js";

type ParsedArgs = {
  batchSize: number;
  start: string;
  startExplicit: boolean;
  end: string | null;
  outDir: string;
  checkpointFile: string;
  fresh: boolean;
  failFast: boolean;
  keepFiles: boolean;
  markets: string[] | null;
};

// When a ticker already has StockPrice rows, resume this many days before its
// last stored date rather than refetching --start..now in full — Yahoo
// occasionally revises the last day or two of adjusted-close after the fact.
const RESUME_OVERLAP_DAYS = 3;

function getArgValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index >= 0 && index + 1 < argv.length) return argv[index + 1];
  const prefixed = argv.find((arg) => arg.startsWith(`${name}=`));
  return prefixed ? prefixed.slice(name.length + 1) : undefined;
}

// Default start = 2 years ago: history older than that is stored downsampled
// to weekly (downsample-stock-prices.ts); a fixed early default would
// re-backfill the deleted daily rows on every run.
function defaultStartDate(): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - 2);
  return d.toISOString().slice(0, 10);
}

// 'us' companies have Entity.market === null (see prisma/schema.prisma); 'cn'/'hk'
// are explicit values. --market us,hk selects both.
function parseMarkets(value: string | undefined): string[] | null {
  if (!value) return null;
  const markets = value
    .split(",")
    .map((market) => market.trim().toLowerCase())
    .filter(Boolean);
  return markets.length ? markets : null;
}

function parseArgs(): ParsedArgs {
  const argv = process.argv.slice(2);
  const explicitStart = getArgValue(argv, "--start");
  return {
    batchSize: Number(getArgValue(argv, "--batch-size") ?? "10"),
    start: explicitStart ?? defaultStartDate(),
    startExplicit: explicitStart !== undefined,
    end: getArgValue(argv, "--end") ?? null,
    outDir: getArgValue(argv, "--out-dir") ?? "/tmp/stock-prices-yf",
    checkpointFile:
      getArgValue(argv, "--checkpoint-file") ?? ".cache/stock-prices-yf/checkpoints-company.json",
    fresh: argv.includes("--fresh"),
    failFast: argv.includes("--fail-fast"),
    keepFiles: argv.includes("--keep-files"),
    markets: parseMarkets(getArgValue(argv, "--market")),
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) throw new Error("batch-size must be positive");
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

function subtractDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// Per-ticker resume date: tickers with existing StockPrice rows resume from
// just before their own last stored date, so a ticker that's been stale for
// months doesn't get silently skipped by a blanket recent --start. An
// explicit --start on the CLI (manual backfill) overrides this uniformly.
async function resolveStartDates(tickers: string[], args: ParsedArgs): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (args.startExplicit) {
    for (const ticker of tickers) result.set(ticker, args.start);
    return result;
  }

  const lastDates = await db.stockPrice.groupBy({
    by: ["ticker"],
    where: { ticker: { in: tickers } },
    _max: { date: true },
  });
  const lastDateByTicker = new Map(
    lastDates.map((row) => [row.ticker, row._max.date] as const),
  );

  for (const ticker of tickers) {
    const lastDate = lastDateByTicker.get(ticker);
    result.set(
      ticker,
      lastDate ? subtractDays(lastDate.toISOString().slice(0, 10), RESUME_OVERLAP_DAYS) : args.start,
    );
  }
  return result;
}

async function main() {
  const args = parseArgs();
  const allCompanies = await db.entity.findMany({
    where: {
      type: "company",
      ...(args.markets
        ? { OR: args.markets.map((market) => (market === "us" ? { market: null } : { market })) }
        : {}),
    },
    select: { id: true, ticker: true, canonicalName: true, metadata: true },
    orderBy: { ticker: "asc" },
  });

  // Filtered in JS rather than a Prisma `NOT: { metadata: { path, equals } }` where
  // clause: Postgres JSON-path comparison against a missing key evaluates to NULL,
  // and `NOT NULL` is NULL too (not TRUE) — that silently excludes every row
  // instead of just the flagged ones. See mark-delisted-tickers.ts.
  const companies = allCompanies.filter((company) => {
    const meta = company.metadata as Record<string, unknown> | null;
    return meta?.delisted !== true;
  });

  const allSecurities = await db.security.findMany({
    where: {
      companyEntityId: { in: companies.map((company) => company.id) },
      ticker: { not: null },
    },
    select: { ticker: true, metadata: true },
  });

  // A Security can be delisted independently of the company Entity it links
  // to — e.g. a stale ticker/CUSIP from before a reorg that's kept around on
  // an otherwise-live company for holdings-history continuity (see
  // mark-delisted-tickers.ts for a concrete example: Howard Hughes).
  const securities = allSecurities.filter((security) => {
    const meta = security.metadata as Record<string, unknown> | null;
    return meta?.delisted !== true;
  });

  const tickers = [...new Set([
    ...companies.map((row) => row.ticker?.trim().toUpperCase()),
    ...securities.map((row) => row.ticker?.trim().toUpperCase()),
  ].filter((ticker): ticker is string => Boolean(ticker)))].sort();
  if (!tickers.length) {
    throw new Error("No company or security tickers found");
  }

  const startByTicker = await resolveStartDates(tickers, args);

  // Group tickers sharing the same resolved start date so they can still be
  // batched into one python invocation; a fresh catalog with uniform staleness
  // collapses to one group, a catalog with mixed staleness splits naturally.
  const tickersByStart = new Map<string, string[]>();
  for (const ticker of tickers) {
    const start = startByTicker.get(ticker) ?? args.start;
    const group = tickersByStart.get(start) ?? [];
    group.push(ticker);
    tickersByStart.set(start, group);
  }

  const batches = [...tickersByStart.entries()].flatMap(([start, group]) =>
    chunk(group, args.batchSize).map((batch) => ({ start, batch })),
  );
  const python = existsSync(".venv/bin/python") ? ".venv/bin/python" : "python3";
  const scriptPath = path.resolve("scripts/fetch-stock-prices-yf.py");
  let failures = 0;

  console.log(
    `Found ${tickers.length} company/security tickers across ${tickersByStart.size} distinct start dates. Running ${batches.length} batches of up to ${args.batchSize}.`,
  );

  for (let i = 0; i < batches.length; i++) {
    const { start, batch } = batches[i];
    const batchLabel = `${i + 1}/${batches.length}`;
    const command = [
      scriptPath,
      "--tickers",
      batch.join(","),
      "--start",
      start,
      "--out-dir",
      args.outDir,
      "--checkpoint-file",
      args.checkpointFile,
      ...(args.end ? ["--end", args.end] : []),
      ...(args.fresh ? ["--fresh"] : []),
      ...(args.failFast ? ["--fail-fast"] : []),
      ...(args.keepFiles ? ["--keep-files"] : []),
      "--import-db",
    ];

    console.log(`Batch ${batchLabel} (start=${start}): ${batch.join(", ")}`);
    const result = spawnSync(python, command, {
      cwd: process.cwd(),
      stdio: "inherit",
      env: process.env,
    });

    if (result.status !== 0) {
      failures += 1;
      console.error(`Batch ${batchLabel} failed.`);
      if (args.failFast) break;
    }
  }

  await db.$disconnect();
  if (failures > 0) {
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error(err);
  try {
    await db.$disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});
