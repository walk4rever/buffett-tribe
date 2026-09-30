/**
 * Merge the 4 historical duplicate entities (BNY, GOOGL, NTES, USB) created by
 * unpadded CIK mismatch during master universe seeding.
 *
 * For each pair:
 * 1. Safely migrate/deduplicate Financial, FilingSection, ExtSource, CompanyAnalysis
 * 2. Standardize main entity CIK to 10-digit zero-padded string
 * 3. Clean up stale metadata (e.g. delisted false-positives from old tickers)
 * 4. Delete the duplicate entity
 *
 * Usage:
 *   node --env-file=.env.local ./node_modules/.bin/tsx scripts/merge-all-duplicate-entities.ts
 */
import prisma from "@/lib/prisma";

interface MergePair {
  ticker: string;
  mainId: string;
  dupId: string;
}

const DUPLICATE_PAIRS: MergePair[] = [
  { ticker: "BNY", mainId: "cmpc0wytv000grssc8lyt7za1", dupId: "cmugnzl5206gjoypdkdrayuzx" },
  { ticker: "GOOGL", mainId: "cmp3oihp80000rstssk67i2hj", dupId: "cmugnzl4z06eroypd8a9odkps" },
  { ticker: "NTES", mainId: "cmpc0xzze000trssctl58tjmb", dupId: "cmugnzl5306hpoypdbp5sn8lj" },
  { ticker: "USB", mainId: "cmpdvxanv0000rspbbgde7p91", dupId: "cmugnzl5206h0oypdqsg7dm1j" },
];

async function mergePair(pair: MergePair) {
  const { ticker, mainId, dupId } = pair;
  console.log(`\n=======================================================`);
  console.log(`Merging ${ticker}: dup (${dupId}) -> main (${mainId})`);
  console.log(`=======================================================`);

  const main = await prisma.entity.findUnique({
    where: { id: mainId },
    include: { analyses: true },
  });
  const dup = await prisma.entity.findUnique({
    where: { id: dupId },
    include: { analyses: true },
  });

  if (!main || !dup) {
    console.warn(`Pair not found or already merged for ${ticker}`);
    return;
  }

  // 1. Release unique CIK on dup so main retains its canonical CIK
  const targetCik = main.cik
    ? String(Number(main.cik))
    : (dup.cik ? String(Number(dup.cik)) : null);

  await prisma.entity.update({
    where: { id: dupId },
    data: { cik: null },
  });
  console.log(`[1/7] Released unique CIK on dup entity`);

  // 2. Merge CompanyAnalysis
  const mainAnalysis = main.analyses[0];
  const dupAnalysis = dup.analyses[0];
  if (mainAnalysis && dupAnalysis) {
    const mainHasCanvas = mainAnalysis.canvas != null;
    const dupHasCanvas = dupAnalysis.canvas != null;
    if (!mainHasCanvas && dupHasCanvas) {
      await prisma.companyAnalysis.update({
        where: { id: mainAnalysis.id },
        data: {
          canvas: dupAnalysis.canvas,
          business: dupAnalysis.business,
        },
      });
      console.log(`[2/7] Copied canvas & business from dup to main analysis`);
    } else {
      console.log(`[2/7] Retained existing main analysis`);
    }
    await prisma.companyAnalysis.delete({ where: { id: dupAnalysis.id } });
  } else if (!mainAnalysis && dupAnalysis) {
    await prisma.companyAnalysis.update({
      where: { id: dupAnalysis.id },
      data: { entityId: mainId },
    });
    console.log(`[2/7] Reassigned dup analysis to main entity`);
  } else {
    console.log(`[2/7] No duplicate analysis to merge`);
  }

  // 3. Merge ExtSources and their child Financials/Sections
  const mainSources = await prisma.extSource.findMany({ where: { filerEntityId: mainId } });
  const accessionToMainSource = new Map<string, string>();
  for (const s of mainSources) {
    if (s.accessionNumber) accessionToMainSource.set(s.accessionNumber, s.id);
  }

  const dupSources = await prisma.extSource.findMany({ where: { filerEntityId: dupId } });
  console.log(`[3/7] Processing ${dupSources.length} ExtSource rows from dup`);

  let mergedSources = 0;
  let reassignedSources = 0;

  for (const ds of dupSources) {
    const existingMainSid = ds.accessionNumber ? accessionToMainSource.get(ds.accessionNumber) : undefined;
    if (existingMainSid) {
      // Duplicate accession already exists on main: re-point child financials
      const dupFins = await prisma.financial.findMany({ where: { sourceId: ds.id } });
      for (const f of dupFins) {
        const conflict = await prisma.financial.findUnique({
          where: {
            entityId_periodEnd_periodType_lineItem: {
              entityId: mainId,
              periodEnd: f.periodEnd,
              periodType: f.periodType,
              lineItem: f.lineItem,
            },
          },
        });
        if (conflict) {
          await prisma.financial.delete({ where: { id: f.id } });
        } else {
          await prisma.financial.update({
            where: { id: f.id },
            data: { entityId: mainId, sourceId: existingMainSid },
          });
        }
      }

      // Re-point child sections
      const dupSecs = await prisma.filingSection.findMany({ where: { sourceId: ds.id } });
      for (const sec of dupSecs) {
        const conflict = await prisma.filingSection.findUnique({
          where: {
            sourceId_section: {
              sourceId: existingMainSid,
              section: sec.section,
            },
          },
        });
        if (conflict) {
          await prisma.filingSection.delete({ where: { id: sec.id } });
        } else {
          await prisma.filingSection.update({
            where: { id: sec.id },
            data: { entityId: mainId, sourceId: existingMainSid },
          });
        }
      }

      await prisma.extSource.delete({ where: { id: ds.id } });
      mergedSources++;
    } else {
      // Re-parent unique source to main entity
      await prisma.extSource.update({
        where: { id: ds.id },
        data: { filerEntityId: mainId },
      });

      const dupFins = await prisma.financial.findMany({ where: { sourceId: ds.id, entityId: dupId } });
      for (const f of dupFins) {
        const conflict = await prisma.financial.findUnique({
          where: {
            entityId_periodEnd_periodType_lineItem: {
              entityId: mainId,
              periodEnd: f.periodEnd,
              periodType: f.periodType,
              lineItem: f.lineItem,
            },
          },
        });
        if (conflict) {
          await prisma.financial.delete({ where: { id: f.id } });
        } else {
          await prisma.financial.update({
            where: { id: f.id },
            data: { entityId: mainId },
          });
        }
      }

      await prisma.filingSection.updateMany({
        where: { sourceId: ds.id, entityId: dupId },
        data: { entityId: mainId },
      });
      reassignedSources++;
    }
  }
  console.log(`      Merged ${mergedSources} duplicate sources, reassigned ${reassignedSources} new sources.`);

  // 4. Any remaining orphan Financials on dup
  const remainingFins = await prisma.financial.findMany({ where: { entityId: dupId } });
  let deletedFins = 0;
  let reassignedFins = 0;
  for (const f of remainingFins) {
    const conflict = await prisma.financial.findUnique({
      where: {
        entityId_periodEnd_periodType_lineItem: {
          entityId: mainId,
          periodEnd: f.periodEnd,
          periodType: f.periodType,
          lineItem: f.lineItem,
        },
      },
    });
    if (conflict) {
      await prisma.financial.delete({ where: { id: f.id } });
      deletedFins++;
    } else {
      await prisma.financial.update({
        where: { id: f.id },
        data: { entityId: mainId },
      });
      reassignedFins++;
    }
  }
  console.log(`[4/7] Remaining financials: deduplicated ${deletedFins}, reassigned ${reassignedFins}`);

  // 5. Clean any remaining sections on dup
  const deletedSecCount = await prisma.filingSection.deleteMany({ where: { entityId: dupId } });
  console.log(`[5/7] Deleted ${deletedSecCount.count} residual filing sections on dup`);

  // 6. Delete dup entity
  await prisma.entity.delete({ where: { id: dupId } });
  console.log(`[6/7] Deleted duplicate entity ${dupId}`);

  // 7. Update main entity: pad CIK, standardize code, clean delisted and retry attempts
  const meta = (main.metadata as Record<string, unknown>) || {};
  delete meta.delisted;
  delete meta.delistedReason;
  delete meta.delistedMarkedAt;
  delete meta.onboardPhase2Attempts;
  delete meta.onboardPhase2LastError;
  delete meta.onboardPhase2LastAttemptAt;
  meta.isMasterUniverse = true;

  const finalPhase = Math.max(main.onboardPhase, dup.onboardPhase);

  await prisma.entity.update({
    where: { id: mainId },
    data: {
      cik: targetCik,
      code: main.code || main.ticker,
      onboardPhase: finalPhase,
      metadata: meta,
    },
  });
  console.log(`[7/7] Updated main entity: CIK=${targetCik}, code=${main.code || main.ticker}, onboardPhase=${finalPhase}`);
  console.log(`✓ ${ticker} merge complete.\n`);
}

async function main() {
  console.log(`Starting merge for ${DUPLICATE_PAIRS.length} duplicate pairs...`);
  for (const pair of DUPLICATE_PAIRS) {
    await mergePair(pair);
  }

  // Verify duplicates are completely gone
  const remainingDups = await prisma.$queryRawUnsafe<Array<{ ticker: string; cnt: number }>>(`
    SELECT UPPER(ticker) as ticker, COUNT(*)::int as cnt
    FROM "Entity"
    WHERE type = 'company' AND ticker IN ('BNY', 'GOOGL', 'NTES', 'USB')
    GROUP BY UPPER(ticker)
  `);

  console.log("\n================ Final Verification ================");
  console.log("Entity counts for BNY, GOOGL, NTES, USB:", remainingDups);
  console.log("All counts should be exactly 1.");
}

main()
  .catch((err) => {
    console.error("Fatal merge error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
