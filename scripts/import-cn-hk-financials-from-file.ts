import { readFileSync } from "node:fs";
import db from "../src/lib/prisma";
import { normalizeCurrencyCode } from "../src/lib/fx-rates-core";
import { persistReportingCurrency } from "../src/lib/reporting-currency";
import { withShortWriteTransaction } from "../src/lib/db-short-write";
import { upsertFinancialRows } from "./lib/upsert-financial-rows";

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    console.warn(`[financial-import] ${signal} received; finishing the current import cleanly.`);
  });
}

type Record_ = {
  periodEnd: string;
  periodType?: string;
  lineItem: string;
  value: number | null;
  mappingRule?: string;
  confidence?: number;
};

function getArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  return args.find((_, i) => args[i - 1] === flag);
}

async function main() {
  const filePath = process.argv[2];
  const ticker = getArg("--ticker");
  const code = getArg("--code");
  const market = getArg("--market");
  const currency = getArg("--currency");

  if (!filePath || !ticker || !code || !market || !currency) {
    console.error(
      "Usage: tsx import-cn-hk-financials-from-file.ts <json-file> --ticker <T> --code <C> --market cn|hk --currency <ISO-4217>",
    );
    process.exitCode = 1;
    return;
  }
  const reportingCurrency = normalizeCurrencyCode(currency);
  if (!reportingCurrency) throw new Error(`Invalid reporting currency code: ${currency}`);

  const records = JSON.parse(readFileSync(filePath, "utf-8")) as Record_[];
  if (!records.length) {
    console.error("Empty records file");
    process.exitCode = 1;
    return;
  }

  const entity = await db.entity.findFirst({
    where: { type: "company", market, code },
    select: { id: true, market: true },
  });
  if (!entity) {
    console.error(`No Entity found for market=${market} code=${code} — run the seed_entity step first`);
    process.exitCode = 1;
    return;
  }

  // Stable accessionNumber so reruns reuse the same ExtSource row instead of
  // accumulating duplicates (ExtSource has no other natural dedupe key for
  // this kind — the (filerEntityId, accessionNumber) unique constraint only
  // helps once accessionNumber is non-null and consistent across runs).
  const accessionNumber = "akshare-annual";
  const extSource = await withShortWriteTransaction(db, (tx) =>
    tx.extSource.upsert({
      where: { ExtSource_filer_accession_unique: { filerEntityId: entity.id, accessionNumber } },
      create: { kind: "akshare", filerEntityId: entity.id, accessionNumber, metadata: { ticker, market, code } },
      update: { metadata: { ticker, market, code } },
    }),
  );

  // Deduplicate records by unique composite key before batch insert
  const uniqueRecords: Record_[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    const periodEnd = new Date(record.periodEnd);
    if (Number.isNaN(periodEnd.getTime())) continue;
    const periodType = record.periodType ?? "FY";
    const key = `${periodEnd.toISOString()}|${periodType}|${record.lineItem}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueRecords.push({ ...record, periodType });
    }
  }

  const importableRecords = uniqueRecords.filter((record) => record.value !== null);
  const skippedUnknown = uniqueRecords.length - importableRecords.length;

  const recordsToInsert = importableRecords.map((record) => ({
    entityId: entity.id,
    sourceId: extSource.id,
    periodEnd: new Date(record.periodEnd),
    periodType: record.periodType ?? "FY",
    lineItem: record.lineItem,
    value: record.value,
    unit: reportingCurrency,
    mappingRule: record.mappingRule,
    confidence: record.confidence,
  }));

  console.time("  db-write");
  await persistReportingCurrency(entity.id, entity.market, reportingCurrency);
  if (recordsToInsert.length > 0) {
    await upsertFinancialRows(db, recordsToInsert);
  }
  console.timeEnd("  db-write");

  console.log(
    `Wrote ${recordsToInsert.length}/${records.length} Financial rows for entity ${entity.id} (unit=${currency}); skipped ${skippedUnknown} unknown amount(s)`,
  );
  await db.$disconnect();

}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
}).finally(async () => {
  await db.$disconnect();
});
