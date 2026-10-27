/**
 * Missing-only standardized fact backfill for the 45-company metric suite.
 *
 * Usage:
 *   npm run backfill:validation-facts -- --line-items ShortTermDebt,LongTermDebt,TotalDebt
 *   npm run backfill:validation-facts -- --line-items ShortTermDebt --tickers AAPL,MSFT --execute --batch-id debt-20261026
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import db from "../src/lib/prisma";
import { importUsFinancialsFromYfinance } from "./import-us-financials-yf";
import { buildStrictBatchTag } from "./rollback-batch-financials";

const SUITE_PATH = path.join(
  process.cwd(),
  "scripts",
  "lib",
  "metric-validation-suite.json",
);

type Args = {
  lineItems: string[];
  tickers?: Set<string>;
  execute: boolean;
  batchId?: string;
  excludeZero: boolean;
};

function valueAfter(argv: string[], flag: string) {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const lineItems = valueAfter(argv, "--line-items")
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!lineItems?.length) {
    throw new Error("--line-items is required");
  }
  const tickers = valueAfter(argv, "--tickers");
  const execute = argv.includes("--execute");
  const batchId = valueAfter(argv, "--batch-id")?.trim();
  if (execute && (!batchId || !/^[a-zA-Z0-9_-]+$/.test(batchId))) {
    throw new Error("--execute requires a safe --batch-id");
  }
  return {
    lineItems,
    tickers: tickers
      ? new Set(tickers.split(",").map((ticker) => ticker.trim()))
      : undefined,
    execute,
    batchId,
    excludeZero: argv.includes("--exclude-zero"),
  };
}

async function main() {
  const args = parseArgs();
  const suite = JSON.parse(
    readFileSync(SUITE_PATH, "utf8"),
  ) as { companies: Array<{ ticker: string }> };
  const tickers = suite.companies
    .map((company) => company.ticker)
    .filter((ticker) => !args.tickers || args.tickers.has(ticker));

  let total = 0;
  let entitiesWithRows = 0;
  const batchTag = args.batchId
    ? buildStrictBatchTag(args.batchId)
    : undefined;
  for (const ticker of tickers) {
    const count = await importUsFinancialsFromYfinance(ticker, {
      lineItems: args.lineItems,
      missingOnly: true,
      annualOnly: true,
      dryRun: !args.execute,
      mappingTag: batchTag,
      verbose: !args.execute,
      excludeZero: args.excludeZero,
    });
    total += count;
    if (count > 0) entitiesWithRows += 1;
  }
  console.log(
    `${args.execute ? "Wrote" : "Would write"} ${total} rows across ${entitiesWithRows}/${tickers.length} companies.`,
  );
}

main()
  .catch((error) => {
    console.error("Validation-suite fact backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
