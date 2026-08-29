/**
 * mark-delisted-tickers.ts
 *
 * Marks company Entity rows AND Security rows as permanently unfetchable for
 * stock-price purposes (acquired / taken private / merged / renamed —
 * yfinance has no data for the old ticker and never will).
 * import-company-stock-prices-yf.ts skips anything with metadata.delisted ===
 * true, so these tickers stop showing up as weekly cron "failures" for a
 * reason that will never resolve.
 *
 * Both models need marking independently: a Security can carry a stale
 * ticker (an old share class/CUSIP from before a reorg) while still being
 * linked via companyEntityId to a perfectly alive company Entity trading
 * under a *different*, current ticker — e.g. the "HHC" Security (old Howard
 * Hughes Corp share class, CUSIP 44267D107) still points at the live "Howard
 * Hughes Holdings Inc." Entity (ticker HHH, CUSIP 44267T102) for holdings-
 * history continuity. Marking only the Entity side would leave HHC being
 * refetched forever even though the company itself isn't delisted.
 *
 * Usage:
 *   npx dotenv -e .env.local -- npx tsx scripts/mark-delisted-tickers.ts --tickers TWTR,XLNX --reason "..."
 *   npx dotenv -e .env.local -- npx tsx scripts/mark-delisted-tickers.ts --tickers TWTR,XLNX --reason "..." --dry-run
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

function getArgValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index >= 0 && index + 1 < argv.length) return argv[index + 1];
  const prefixed = argv.find((arg) => arg.startsWith(`${name}=`));
  return prefixed ? prefixed.slice(name.length + 1) : undefined;
}

type Counts = { marked: number; alreadyMarked: number };

async function markEntities(tickers: string[], reason: string, markedAt: string, dryRun: boolean): Promise<Counts> {
  const entities = await db.entity.findMany({
    where: { type: "company", ticker: { in: tickers } },
    select: { id: true, ticker: true, canonicalName: true, metadata: true },
  });

  const counts: Counts = { marked: 0, alreadyMarked: 0 };
  for (const entity of entities) {
    const meta = (entity.metadata as Record<string, unknown> | null) ?? {};
    if (meta.delisted === true) {
      counts.alreadyMarked += 1;
      console.log(`[entity] ${entity.ticker}: already marked delisted, skipping`);
      continue;
    }
    console.log(`${dryRun ? "[dry-run] " : ""}[entity] ${entity.ticker} (${entity.canonicalName}): marking delisted`);
    if (!dryRun) {
      await db.entity.update({
        where: { id: entity.id },
        data: { metadata: { ...meta, delisted: true, delistedReason: reason, delistedMarkedAt: markedAt } },
      });
    }
    counts.marked += 1;
  }
  return counts;
}

async function markSecurities(tickers: string[], reason: string, markedAt: string, dryRun: boolean): Promise<Counts> {
  const securities = await db.security.findMany({
    where: { ticker: { in: tickers } },
    select: { id: true, ticker: true, cusip: true, metadata: true },
  });

  const counts: Counts = { marked: 0, alreadyMarked: 0 };
  for (const security of securities) {
    const meta = (security.metadata as Record<string, unknown> | null) ?? {};
    if (meta.delisted === true) {
      counts.alreadyMarked += 1;
      console.log(`[security] ${security.ticker} (${security.cusip ?? "no cusip"}): already marked delisted, skipping`);
      continue;
    }
    console.log(`${dryRun ? "[dry-run] " : ""}[security] ${security.ticker} (${security.cusip ?? "no cusip"}): marking delisted`);
    if (!dryRun) {
      await db.security.update({
        where: { id: security.id },
        data: { metadata: { ...meta, delisted: true, delistedReason: reason, delistedMarkedAt: markedAt } },
      });
    }
    counts.marked += 1;
  }
  return counts;
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const reason = getArgValue(argv, "--reason");
  const tickersArg = getArgValue(argv, "--tickers");
  if (!reason) throw new Error("--reason is required (why is this ticker permanently unfetchable?)");
  if (!tickersArg) throw new Error("--tickers is required (comma-separated)");

  const tickers = [...new Set(tickersArg.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean))];
  console.log(`[mark-delisted-tickers] mode=${dryRun ? "dry-run" : "live"} tickers=${tickers.length}`);

  const markedAt = new Date().toISOString();
  const entityCounts = await markEntities(tickers, reason, markedAt, dryRun);
  const securityCounts = await markSecurities(tickers, reason, markedAt, dryRun);

  console.log(
    `[mark-delisted-tickers] entity: marked=${entityCounts.marked} alreadyMarked=${entityCounts.alreadyMarked} | ` +
      `security: marked=${securityCounts.marked} alreadyMarked=${securityCounts.alreadyMarked}`,
  );
  await db.$disconnect();
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
