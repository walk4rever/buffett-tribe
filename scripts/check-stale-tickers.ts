/**
 * check-stale-tickers.ts
 *
 * Reports tickers whose StockPrice series has stopped advancing while the rest
 * of their market kept moving — the signature of a company that was acquired,
 * taken private or merged away. yfinance keeps answering for these symbols with
 * the same frozen tail forever, so the weekly price cron reports them as
 * "complete" every single week and nothing ever surfaces that they are dead.
 * (Distinct from the outright-404 case, which already shows up as a loud
 * failure and was handled in bulk on 2026-08-29 — see mark-delisted-tickers.ts.)
 *
 * Deliberately reports instead of marking. A single weekend's yfinance hiccup
 * looks exactly like a delisting: QLYS failed the 2026-09-06 run with
 * "possibly delisted; no price data found" and was trading normally four days
 * later. Confirm a candidate, then run mark:delisted-tickers on it by hand.
 *
 * Staleness is measured against each market's own frontier (the newest date any
 * ticker in that market has), never against today — the cron is weekly by
 * design, so "a few days behind today" is normal for everything.
 *
 * Usage:
 *   npm run check:stale-tickers
 *   npm run check:stale-tickers -- --days 30 --json --strict
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

type Market = "us" | "hk" | "cn";

interface StaleTicker {
  ticker: string;
  market: Market;
  latest: string;
  marketFrontier: string;
  daysBehind: number;
  alreadyMarkedDelisted: boolean;
}

const DEFAULT_STALE_DAYS = 21;

function getArgValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index >= 0 && index + 1 < argv.length) return argv[index + 1];
  const prefixed = argv.find((arg) => arg.startsWith(`${name}=`));
  return prefixed ? prefixed.slice(name.length + 1) : undefined;
}

function marketOf(ticker: string): Market {
  if (ticker.endsWith(".SS") || ticker.endsWith(".SZ")) return "cn";
  if (ticker.endsWith(".HK")) return "hk";
  return "us";
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

/** Tickers already flagged on either Entity or Security — see mark-delisted-tickers.ts. */
async function loadMarkedDelisted(): Promise<Set<string>> {
  const [entities, securities] = await Promise.all([
    db.entity.findMany({ where: { type: "company" }, select: { ticker: true, metadata: true } }),
    db.security.findMany({ select: { ticker: true, metadata: true } }),
  ]);

  const marked = new Set<string>();
  // Filtered in JS, not a Prisma JSON `where`: Postgres compares a missing JSON
  // path to NULL, so `NOT { path, equals }` matches no rows at all rather than
  // "everything unflagged" — the same trap import-company-stock-prices-yf.ts
  // documents and that cost a real debugging session on 2026-08-29.
  for (const row of [...entities, ...securities]) {
    const meta = row.metadata as Record<string, unknown> | null;
    if (row.ticker && meta?.delisted === true) marked.add(row.ticker);
  }
  return marked;
}

async function findStaleTickers(staleDays: number): Promise<StaleTicker[]> {
  const rows = await db.stockPrice.groupBy({ by: ["ticker"], _max: { date: true } });
  const marked = await loadMarkedDelisted();

  const latestByTicker = rows
    .filter((row): row is typeof row & { _max: { date: Date } } => row._max.date !== null)
    .map((row) => ({
      ticker: row.ticker,
      market: marketOf(row.ticker),
      latest: row._max.date.toISOString().slice(0, 10),
    }));

  const frontier = new Map<Market, string>();
  for (const row of latestByTicker) {
    const current = frontier.get(row.market);
    if (!current || row.latest > current) frontier.set(row.market, row.latest);
  }

  return latestByTicker
    .map((row) => {
      const marketFrontier = frontier.get(row.market) as string;
      return {
        ...row,
        marketFrontier,
        daysBehind: daysBetween(row.latest, marketFrontier),
        alreadyMarkedDelisted: marked.has(row.ticker),
      };
    })
    .filter((row) => row.daysBehind >= staleDays)
    .sort((a, b) => b.daysBehind - a.daysBehind);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const strict = argv.includes("--strict");
  const staleDays = Number(getArgValue(argv, "--days") ?? DEFAULT_STALE_DAYS);

  if (!Number.isFinite(staleDays) || staleDays <= 0) {
    throw new Error(`--days must be a positive number, got ${getArgValue(argv, "--days")}`);
  }

  const stale = await findStaleTickers(staleDays);
  const unmarked = stale.filter((row) => !row.alreadyMarkedDelisted);

  if (json) {
    console.log(JSON.stringify({ staleDays, stale, unmarkedCount: unmarked.length }, null, 2));
  } else if (stale.length === 0) {
    console.log(`No ticker is more than ${staleDays} days behind its market frontier.`);
  } else {
    console.log(`Tickers at least ${staleDays} days behind their market frontier:\n`);
    for (const row of stale) {
      const flag = row.alreadyMarkedDelisted ? " [already marked delisted]" : "";
      console.log(
        `  ${row.ticker.padEnd(10)} ${row.market}  latest ${row.latest}  ` +
        `(${row.daysBehind}d behind ${row.marketFrontier})${flag}`
      );
    }
    if (unmarked.length > 0) {
      console.log(
        `\n${unmarked.length} candidate(s) not yet marked. Confirm each is really dead — a ` +
        `transient yfinance failure looks identical — then:\n` +
        `  npm run mark:delisted-tickers -- --tickers ${unmarked.map((r) => r.ticker).join(",")} --reason "..."`
      );
    }
  }

  if (strict && unmarked.length > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("[check-stale-tickers] fatal", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
