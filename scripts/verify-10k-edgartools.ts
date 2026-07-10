/**
 * Run a small batch through the edgartools annual report importer, then print
 * the resulting DB counts per filing accession.
 *
 * Usage:
 *   npm run verify:10k:edgartools -- --tickers AAPL,PDD,SU --from 2025 --to 2025
 */
import { spawn } from "node:child_process";
import { db, normalizeTicker } from "./lib/annual-report-import-core";

type SnapshotRow = {
  ticker: string;
  year: number | null;
  kind: string;
  accession: string | null;
  sections: number;
  attachments: number;
  artifacts: number;
  derived: number;
};

function getArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  return args.find((_, i) => args[i - 1] === flag);
}

function parseYear(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid year: ${value}`);
  return parsed;
}

function parseTickers() {
  const raw = getArg("--tickers") ?? "AAPL,PDD,SU";
  return raw.split(",").map((ticker) => normalizeTicker(ticker)).filter(Boolean);
}

function runScript(script: string, params: {
  ticker: string;
  fromYear: number;
  toYear: number;
  filingConcurrency: number;
}) {
  const args = [
    "--env-file=.env.local",
    "./node_modules/.bin/tsx",
    script,
    "--ticker",
    params.ticker,
    "--from",
    String(params.fromYear),
    "--to",
    String(params.toYear),
    "--filing-concurrency",
    String(params.filingConcurrency),
  ];

  return new Promise<number>((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["inherit", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => process.stdout.write(chunk));
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function snapshot(ticker: string, fromYear: number, toYear: number): Promise<SnapshotRow[]> {
  const entity = await db.entity.findFirst({
    where: {
      type: "company",
      ticker: { equals: ticker, mode: "insensitive" },
    },
    select: { id: true },
  });
  if (!entity) return [];

  const sources = await db.extSource.findMany({
    where: {
      filerEntityId: entity.id,
      periodYear: { gte: fromYear, lte: toYear },
      kind: { in: ["10k", "20f", "40f"] },
    },
    select: {
      id: true,
      kind: true,
      periodYear: true,
      accessionNumber: true,
      _count: {
        select: {
          sections: true,
          attachments: true,
          artifacts: true,
          financials: true,
        },
      },
    },
    orderBy: [{ periodYear: "desc" }, { accessionNumber: "asc" }],
  });

  return sources.map((source) => ({
    ticker,
    year: source.periodYear,
    kind: source.kind,
    accession: source.accessionNumber,
    sections: source._count.sections,
    attachments: source._count.attachments,
    artifacts: source._count.artifacts,
    derived: source._count.financials,
  }));
}

function printSnapshot(label: string, rows: SnapshotRow[]) {
  console.log(`\n${label}`);
  if (!rows.length) {
    console.log("  (no rows)");
    return;
  }
  for (const row of rows) {
    console.log(
      `  ${row.ticker} ${row.year} ${row.kind} ${row.accession}: sections=${row.sections}, attachments=${row.attachments}, artifacts=${row.artifacts}, derived=${row.derived}`,
    );
  }
}

async function main() {
  const tickers = parseTickers();
  const fromYear = parseYear(getArg("--from"), 2025);
  const toYear = parseYear(getArg("--to"), 2025);
  const filingConcurrency = parseYear(getArg("--filing-concurrency"), 1);

  console.log(
    `Verify edgartools annual importer: tickers=${tickers.join(",")} years=${fromYear}-${toYear} archiveStrategy=standard`,
  );

  for (const ticker of tickers) {
    console.log(`\n=== ${ticker} ===`);
    const code = await runScript("scripts/import-10k-edgartools.ts", {
      ticker,
      fromYear,
      toYear,
      filingConcurrency,
    });
    if (code !== 0) throw new Error(`edgartools importer failed for ${ticker} with code ${code}`);
    const rows = await snapshot(ticker, fromYear, toYear);
    printSnapshot("edgartools snapshot", rows);
  }
}

main()
  .catch((err) => {
    console.error("[verify-10k-edgartools] fatal", err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
