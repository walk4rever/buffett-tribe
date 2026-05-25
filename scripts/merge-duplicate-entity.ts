/**
 * Merge a duplicate entity into the primary one.
 * Usage:
 *   npx tsx scripts/merge-duplicate-entity.ts --from <dupId> --to <mainId>
 */

import prisma from "../src/lib/prisma";

async function main() {
  const args = process.argv.slice(2);
  const fromIdx = args.indexOf("--from");
  const toIdx = args.indexOf("--to");
  if (fromIdx === -1 || toIdx === -1) {
    console.error("Usage: npx tsx scripts/merge-duplicate-entity.ts --from <dupEntityId> --to <mainEntityId>");
    process.exit(1);
  }
  const dupId = args[fromIdx + 1];
  const mainId = args[toIdx + 1];

  const dupEntity = await prisma.entity.findUnique({ where: { id: dupId } });
  const mainEntity = await prisma.entity.findUnique({ where: { id: mainId } });
  if (!dupEntity || !mainEntity) {
    console.error("Entity not found");
    process.exit(1);
  }

  console.log(`Merging ${dupEntity.canonicalName} (${dupId}) into ${mainEntity.canonicalName} (${mainId})`);

  // Build URL -> mainSourceId map
  const mainSources = await prisma.extSource.findMany({
    where: { filerEntityId: mainId },
    select: { id: true, url: true },
  });
  const urlToMainSourceId = new Map(mainSources.map((s) => [s.url, s.id]));

  const dupSources = await prisma.extSource.findMany({
    where: { filerEntityId: dupId },
    select: { id: true, url: true },
  });

  let migratedFacts = 0;
  let deletedFinancials = 0;
  let deletedSections = 0;
  let deletedSources = 0;

  for (const ds of dupSources) {
    const mainSid = urlToMainSourceId.get(ds.url);
    if (!mainSid) {
      console.warn(`  No matching main source for URL: ${ds.url}`);
      continue;
    }

    // Migrate FinancialFact to main source / main entity
    const factResult = await prisma.financialFact.updateMany({
      where: { entityId: dupId, sourceId: ds.id },
      data: { entityId: mainId, sourceId: mainSid },
    });
    migratedFacts += factResult.count;
    console.log(`  Source ${ds.id.slice(0, 8)} -> ${mainSid.slice(0, 8)}: migrated ${factResult.count} facts`);

    // Delete duplicate Financial records (main already has them)
    const finResult = await prisma.financial.deleteMany({
      where: { entityId: dupId, sourceId: ds.id },
    });
    deletedFinancials += finResult.count;

    // Delete duplicate FilingSection records (main already has them)
    const secResult = await prisma.filingSection.deleteMany({
      where: { entityId: dupId, sourceId: ds.id },
    });
    deletedSections += secResult.count;

    // Now safe to delete dup source (no remaining FK refs)
    await prisma.extSource.delete({ where: { id: ds.id } });
    deletedSources++;
  }

  // Check for any remaining data on dup entity
  const remainingFacts = await prisma.financialFact.count({ where: { entityId: dupId } });
  const remainingFinancials = await prisma.financial.count({ where: { entityId: dupId } });
  const remainingSections = await prisma.filingSection.count({ where: { entityId: dupId } });
  const remainingSources = await prisma.extSource.count({ where: { filerEntityId: dupId } });

  console.log(`\nRemaining on dup entity: facts=${remainingFacts}, financials=${remainingFinancials}, sections=${remainingSections}, sources=${remainingSources}`);

  if (remainingFacts + remainingFinancials + remainingSections + remainingSources === 0) {
    await prisma.entity.delete({ where: { id: dupId } });
    console.log(`Deleted duplicate entity ${dupId}`);
  } else {
    console.warn("Duplicate entity still has data; not deleting. Manual review required.");
  }

  console.log(`\nSummary: migrated ${migratedFacts} facts, deleted ${deletedFinancials} financials, ${deletedSections} sections, ${deletedSources} sources.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
