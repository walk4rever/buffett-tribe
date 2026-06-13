/**
 * Downsample StockPrice history older than 2 years from daily to weekly OHLCV.
 * The last trading day of each (ticker, week) survives and absorbs the week:
 * open = first day's open, high/low = extremes, volume = sum, close stays.
 * Recent 2 years keep full daily resolution (charts, current PE).
 *
 * IRREVERSIBLE for the deleted daily rows — re-fetch from the price source
 * if daily history is ever needed again.
 *
 * Runs as a single atomic statement (CTE: aggregate -> update survivor ->
 * delete the rest), so a crash cannot leave half-aggregated weeks.
 *
 * Usage:
 *   tsx scripts/downsample-stock-prices.ts --dry-run
 *   tsx scripts/downsample-stock-prices.ts
 */

import prisma from "../src/lib/prisma";

const KEEP_DAILY_YEARS = 2;

function cutoffDate(): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - KEEP_DAILY_YEARS);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const cutoff = cutoffDate();

  const stats = await prisma.$queryRawUnsafe<Array<{ old_rows: number; weeks: number }>>(`
    SELECT count(*)::int AS old_rows,
           count(DISTINCT (ticker, date_trunc('week', date)))::int AS weeks
    FROM "StockPrice" WHERE date < '${cutoff}'`);
  const { old_rows, weeks } = stats[0];
  console.log(
    `Daily rows older than ${cutoff}: ${old_rows} -> ${weeks} weekly rows ` +
      `(deleting ${old_rows - weeks})${dryRun ? " [DRY-RUN]" : ""}`,
  );

  if (dryRun || old_rows === 0) {
    await prisma.$disconnect();
    return;
  }

  const deleted = await prisma.$executeRawUnsafe(`
    WITH agg AS (
      SELECT ticker,
             date_trunc('week', date)::date AS wk,
             (array_agg(open ORDER BY date ASC))[1] AS wk_open,
             max(high) AS wk_high,
             min(low) AS wk_low,
             sum(volume) AS wk_volume,
             max(date) AS last_date
      FROM "StockPrice"
      WHERE date < '${cutoff}'
      GROUP BY ticker, date_trunc('week', date)
    ),
    upd AS (
      UPDATE "StockPrice" sp
      SET open = a.wk_open, high = a.wk_high, low = a.wk_low, volume = a.wk_volume
      FROM agg a
      WHERE sp.ticker = a.ticker AND sp.date = a.last_date
    )
    DELETE FROM "StockPrice" sp
    USING agg a
    WHERE sp.ticker = a.ticker
      AND sp.date < '${cutoff}'
      AND date_trunc('week', sp.date)::date = a.wk
      AND sp.date <> a.last_date`);

  console.log(`Deleted ${deleted} daily rows. Run VACUUM FULL "StockPrice" to reclaim disk.`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[downsample-stock-prices] fatal", err);
  await prisma.$disconnect();
  process.exit(1);
});
