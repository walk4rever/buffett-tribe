import { readFileSync } from "node:fs";
import db from "../src/lib/prisma";

type Record_ = { periodEnd: string; periodType?: string; lineItem: string; value: number };

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

async function runPool<T>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<void>) {
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      await fn(items[index], index);
    }
  });
  await Promise.all(workers);
}

  // Deduplicate records by unique composite key before concurrent upserts
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

  let written = 0;
  const CONCURRENCY = 3;
  console.time("  db-write");
  await runPool(uniqueRecords, CONCURRENCY, async (record) => {
    const periodEnd = new Date(record.periodEnd);
    const periodType = record.periodType ?? "FY";

    let attempts = 0;
    while (true) {
      try {
        await db.financial.upsert({
          where: {
            entityId_periodEnd_periodType_lineItem: {
              entityId: entity.id,
              periodEnd,
              periodType,
              lineItem: record.lineItem,
            },
          },
          create: {
            entityId: entity.id,
            sourceId: extSource.id,
            periodEnd,
            periodType,
            lineItem: record.lineItem,
            value: record.value,
            unit: currency,
          },
          update: {
            sourceId: extSource.id,
            value: record.value,
            unit: currency,
          },
        });
        written++;
        break;
      } catch (err: unknown) {
        attempts++;
        if (attempts >= 3) throw err;
        await new Promise((resolve) => setTimeout(resolve, 500 * attempts));
      }
    }
  });
  console.timeEnd("  db-write");

  console.log(`Wrote ${written}/${records.length} Financial rows for entity ${entity.id} (unit=${currency})`);
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
