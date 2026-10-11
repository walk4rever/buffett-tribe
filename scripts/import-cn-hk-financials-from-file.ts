import { readFileSync } from "node:fs";
import db from "../src/lib/prisma";

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
      "Usage: tsx import-cn-hk-financials-from-file.ts <json-file> --ticker <T> --code <C> --market cn|hk --currency CNY|HKD|USD",
    );
    process.exit(1);
  }

  const records = JSON.parse(readFileSync(filePath, "utf-8")) as Record_[];
  if (!records.length) {
    console.error("Empty records file");
    process.exit(1);
  }

  const entity = await db.entity.findFirst({
    where: { type: "company", market, code },
    select: { id: true },
  });
  if (!entity) {
    console.error(`No Entity found for market=${market} code=${code} — run the seed_entity step first`);
    process.exit(1);
  }

  // Stable accessionNumber so reruns reuse the same ExtSource row instead of
  // accumulating duplicates (ExtSource has no other natural dedupe key for
  // this kind — the (filerEntityId, accessionNumber) unique constraint only
  // helps once accessionNumber is non-null and consistent across runs).
  const accessionNumber = "akshare-annual";
  const extSource = await db.extSource.upsert({
    where: { ExtSource_filer_accession_unique: { filerEntityId: entity.id, accessionNumber } },
    create: { kind: "akshare", filerEntityId: entity.id, accessionNumber, metadata: { ticker, market, code } },
    update: { metadata: { ticker, market, code } },
  });

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
    unit: currency,
    mappingRule: record.mappingRule,
    confidence: record.confidence,
  }));

  const periodEnds = Array.from(new Set(recordsToInsert.map((r) => r.periodEnd.getTime()))).map((t) => new Date(t));

  console.time("  db-write");
  if (recordsToInsert.length > 0) {
    // Delete existing records in the target periods for this company and bulk-insert new records
    await db.$transaction([
      db.financial.deleteMany({
        where: {
          entityId: entity.id,
          periodEnd: { in: periodEnds },
        },
      }),
      db.financial.createMany({
        data: recordsToInsert,
        skipDuplicates: true,
      }),
    ]);
  }
  console.timeEnd("  db-write");

  console.log(
    `Wrote ${recordsToInsert.length}/${records.length} Financial rows for entity ${entity.id} (unit=${currency}); skipped ${skippedUnknown} unknown amount(s)`,
  );
  await db.$disconnect();

}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
