import db from "../src/lib/prisma.js";
import fs from "fs";
import {
  addDays,
  formatDateKey,
  normalizeTicker,
  normalizeYahooChartResponse,
  replaceStockPriceWindow,
} from "./lib/stock-prices";

async function main() {
  const filePath = process.argv[2];
  const ticker = normalizeTicker(process.argv[3] ?? "AAPL");

  if (!filePath) {
    console.error("Usage: tsx import-stock-prices-from-file.ts <json-file> [ticker]");
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  const records = normalizeYahooChartResponse(ticker, raw);
  if (!records.length) {
    console.error("Invalid data or empty Yahoo response");
    process.exit(1);
  }

  const start = records[0].date;
  const endExclusive = addDays(records[records.length - 1].date, 1);
  console.log(
    `Replacing ${ticker} rows for ${formatDateKey(start)} -> ${formatDateKey(addDays(endExclusive, -1))} (${records.length} rows)...`
  );

  await replaceStockPriceWindow(db, ticker, start, endExclusive, records);

  console.log("Done.");
  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
