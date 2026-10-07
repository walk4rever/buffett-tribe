/**
 * Clean up official company filings (10-K, 10-Q, 20-F, 40-F, prospectuses, etc.)
 * dated before 2020 (< 2020) along with cascading sections, artifacts, and historical financials.
 *
 * Retention policy:
 * - Official company filings/announcements are strictly stored and displayed from 2020 onwards (>= 2020).
 * - Pre-2020 filings and historical financials prior to 2020 are deleted.
 * - Master 13F holdings and investor letters are untouched.
 *
 * Usage:
 *   node --env-file=.env.local ./node_modules/.bin/tsx scripts/cleanup-pre-2020-filings.ts            # Dry run
 *   node --env-file=.env.local ./node_modules/.bin/tsx scripts/cleanup-pre-2020-filings.ts --execute  # Actually delete
 */

import prisma from "../src/lib/prisma";
import { COMPANY_REFERENCE_FILING_KINDS } from "../src/lib/company-data";

const CUTOFF_YEAR = 2020;
const CUTOFF_DATE = new Date("2020-01-01T00:00:00.000Z");
const BATCH_SIZE = 100;

const targetWhere = {
  kind: { in: COMPANY_REFERENCE_FILING_KINDS },
  OR: [
    { periodYear: { lt: CUTOFF_YEAR } },
    { periodYear: null, filedAt: { lt: CUTOFF_DATE } },
    { periodYear: null, filedAt: null, ts: { lt: CUTOFF_DATE } },
  ],
};

async function main() {
  const isExecute = process.argv.includes("--execute");

  console.log(`=== Pre-${CUTOFF_YEAR} Official Filings Cleanup ===`);
  console.log(`Mode: ${isExecute ? "EXECUTE (Permanent deletion)" : "DRY RUN (No data modified)"}\n`);

  const totalExtSources = await prisma.extSource.count({ where: targetWhere });
  console.log(`Found ${totalExtSources} ExtSource records matching pre-${CUTOFF_YEAR} criteria.`);

  if (totalExtSources === 0) {
    console.log("No records to clean up.");
    return;
  }

  const byKind = await prisma.extSource.groupBy({
    by: ["kind"],
    where: targetWhere,
    _count: { id: true },
  });
  console.log("Breakdown by kind:");
  for (const item of byKind) {
    console.log(`  - ${item.kind}: ${item._count.id}`);
  }

  const targetSources = await prisma.extSource.findMany({
    where: targetWhere,
    select: { id: true },
  });
  const targetIds = targetSources.map((s) => s.id);

  const [secCount, artCount, finCount, attCount] = await Promise.all([
    prisma.filingSection.count({ where: { sourceId: { in: targetIds } } }),
    prisma.filingArtifact.count({ where: { sourceId: { in: targetIds } } }),
    prisma.financial.count({ where: { sourceId: { in: targetIds } } }),
    prisma.filingAttachment.count({ where: { sourceId: { in: targetIds } } }),
  ]);

  console.log("\nAssociated cascading records to be removed:");
  console.log(`  - FilingSection:    ${secCount}`);
  console.log(`  - FilingArtifact:   ${artCount}`);
  console.log(`  - Financial:        ${finCount}`);
  console.log(`  - FilingAttachment: ${attCount}`);

  if (!isExecute) {
    console.log("\n[DRY RUN] No records were deleted. To perform deletion, rerun with --execute");
    return;
  }

  console.log(`\nDeleting ${targetIds.length} ExtSource records in batches of ${BATCH_SIZE}...`);
  let deletedExtSources = 0;

  for (let i = 0; i < targetIds.length; i += BATCH_SIZE) {
    const chunk = targetIds.slice(i, i + BATCH_SIZE);
    const result = await prisma.extSource.deleteMany({
      where: { id: { in: chunk } },
    });
    deletedExtSources += result.count;
    console.log(`  Deleted ${deletedExtSources}/${targetIds.length} ExtSource records...`);
  }

  console.log(`\nCleanup complete! Deleted ${deletedExtSources} ExtSource records and all cascading child records.`);
}

main()
  .catch((err) => {
    console.error("Error during cleanup:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
