import db from "../src/lib/prisma.js";
import {
  addDays,
  buildWindows,
  fetchYahooChartWindow,
  formatDateKey,
  normalizeTicker,
  normalizeYahooChartResponse,
  parseUtcDate,
  replaceStockPriceWindow,
  todayUtc,
} from "./lib/stock-prices";

function getArgValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index >= 0 && index + 1 < argv.length) return argv[index + 1];
  const prefixed = argv.find((arg) => arg.startsWith(`${name}=`));
  return prefixed ? prefixed.slice(name.length + 1) : undefined;
}

async function main() {
  const argv = process.argv.slice(2);
  const ticker = normalizeTicker(getArgValue(argv, "--ticker") ?? argv[0] ?? "AAPL");
  const start = parseUtcDate(getArgValue(argv, "--start") ?? argv[1] ?? "1980-01-01");
  const endInclusive = parseUtcDate(getArgValue(argv, "--end") ?? argv[2] ?? formatDateKey(todayUtc()));
  const chunkDays = Number(getArgValue(argv, "--chunk-days") ?? "180");
  const overlapDays = Number(getArgValue(argv, "--overlap-days") ?? "5");
  const endExclusive = addDays(endInclusive, 1);

  const windows = buildWindows(start, endExclusive, chunkDays, overlapDays);
  console.log(`Syncing ${ticker}: ${formatDateKey(start)} -> ${formatDateKey(endInclusive)} (${windows.length} windows)`);

  let seenData = false;
  let inserted = 0;

  for (let i = 0; i < windows.length; i++) {
    const window = windows[i];
    const windowLabel = `${formatDateKey(window.start)} -> ${formatDateKey(addDays(window.endExclusive, -1))}`;
    console.log(`[${i + 1}/${windows.length}] Fetching ${ticker} ${windowLabel}...`);

    const payload = await fetchYahooChartWindow(ticker, window.start, window.endExclusive);
    const records = normalizeYahooChartResponse(ticker, payload);

    if (records.length === 0) {
      if (seenData) {
        throw new Error(`Unexpected empty Yahoo window after data started: ${windowLabel}`);
      }
      console.log(`  no data`);
      continue;
    }

    seenData = true;
    await replaceStockPriceWindow(db, ticker, window.start, window.endExclusive, records);
    inserted += records.length;

    const first = records[0];
    const last = records[records.length - 1];
    console.log(`  saved ${records.length} rows (${formatDateKey(first.date)} -> ${formatDateKey(last.date)})`);
  }

  if (!seenData) {
    throw new Error(`No price data returned for ${ticker}`);
  }

  const total = await db.stockPrice.count({ where: { ticker } });
  console.log(`Done. Wrote ${inserted} rows during sync, ${total} rows currently stored for ${ticker}.`);
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
