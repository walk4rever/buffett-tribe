/**
 * Systematically merge the 15 remaining duplicate entity pairs created by
 * unpadded vs 10-digit zero-padded CIK mismatch.
 *
 * For each pair:
 * 1. Safely migrate/deduplicate Financial, FilingSection, ExtSource, CompanyAnalysis
 * 2. Handle SNAP / ARCH disambiguation (create Arch Resources Inc entity, re-point ARCH security, restore Snap Inc)
 * 3. Standardize main entity CIK to 10-digit zero-padded string
 * 4. Add alternate/class tickers to aliases
 * 5. Delete the duplicate stub entity
 * 6. DB-wide normalize ALL remaining Entity.cik and Filer.filerCik to 10-digit zero-padded strings
 *
 * Usage:
 *   node --env-file=.env.local ./node_modules/.bin/tsx scripts/merge-all-duplicate-entities.ts
 */
import prisma from "@/lib/prisma";
import { normalizeCik } from "@/lib/cik";

interface MergePair {
  label: string;
  normCik: string;
  mainId: string;
  dupId: string;
  newTicker?: string;
  addAlias?: string;
}

const DUPLICATE_PAIRS: MergePair[] = [
  { label: "ECHO", normCik: "1415404", mainId: "cmq60uicu000frsu0mwcdv9lf", dupId: "cmugnzl5906mooypd56oly2dp" },
  { label: "FWONA", normCik: "1560385", mainId: "cmp3ohhpd0000rsrrygqy6vjg", dupId: "cmugnzl5a06oboypd71onafx9" },
  { label: "HHC/HHH", normCik: "1981792", mainId: "cmsr02kcp0007rs2um1afadng", dupId: "cmugnzosq07cgoypdqvt87o5y", newTicker: "HHH", addAlias: "HHC" },
  { label: "BFB/BF-B", normCik: "14693", mainId: "cmsd8zupx0030rsaj135rc9qi", dupId: "cmugnzmvt06ufoypdzlek3mlo", newTicker: "BF-B", addAlias: "BFB" },
  { label: "LLYVK/LLYVA", normCik: "2078416", mainId: "cmp3pxa2i0000rso86y8nl35n", dupId: "cmugnzmw006yxoypdliwmcu3k", addAlias: "LLYVA" },
  { label: "Z/ZG", normCik: "1617640", mainId: "cmq60zljc004nrsu0tazphrd7", dupId: "cmugnzmw4071uoypdag7jvx2v", addAlias: "ZG" },
  { label: "CEIX/CNR", normCik: "1710366", mainId: "cmsdt2rmu0013rsbk3w23h9a3", dupId: "cmugnzosl078xoypd7yk8ag0t", newTicker: "CNR", addAlias: "CEIX" },
  { label: "BATRK/BATRA", normCik: "1958140", mainId: "cmp3o2hme0000rswg3byqlfgd", dupId: "cmugnzosr07dpoypda5s4w3hx", addAlias: "BATRA" },
  { label: "LBTYK/LBTYA", normCik: "1570585", mainId: "cmpc0xoo0000prsscxk3qxj2w", dupId: "cmugnzoss07f7oypd98d2obk9", addAlias: "LBTYA" },
  { label: "BITF/KEEL", normCik: "1812477", mainId: "cmstq3l3w000yrs6hf8y1bxuw", dupId: "cmugnzraf07l7oypdbu0q7k67", newTicker: "KEEL", addAlias: "BITF" },
  { label: "LILAK/LILA", normCik: "1712184", mainId: "cmp3orcl20000rsdfurr0xtqa", dupId: "cmugnzras07tioypdme2omsli", addAlias: "LILA" },
  { label: "USDEW/USDE", normCik: "2080215", mainId: "cmstq65wj001krs6hg0l5lp74", dupId: "cmugo01yg08veoypddeedo6kp", newTicker: "USDE", addAlias: "USDEW" },
  { label: "SEGRT/SEG", normCik: "2009684", mainId: "cmsr02mmu000ars2uxan9yy80", dupId: "cmugo01yk08xfoypdfnno3c0h", newTicker: "SEG", addAlias: "SEGRT" },
  { label: "SRG/SRG-PA", normCik: "1628063", mainId: "cmsdt3frr001trsbkpgak59ri", dupId: "cmugo0hql0bg9oypd5j8o1t3u", addAlias: "SRG-PA" },
];

async function mergePair(pair: MergePair) {
  const { label, mainId, dupId, newTicker, addAlias } = pair;
  console.log(`\n=======================================================`);
  console.log(`Merging ${label}: dup (${dupId}) -> main (${mainId})`);
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
    console.warn(`Pair not found or already merged for ${label}`);
    return;
  }

  // 1. Release unique CIK on dup so main retains its canonical CIK
  const targetCik = normalizeCik(main.cik || dup.cik);

  await prisma.entity.update({
    where: { id: dupId },
    data: { cik: null },
  });
  console.log(`[1/6] Released unique CIK on dup entity`);

  // 2. Merge CompanyAnalysis
  const mainAnalysis = main.analyses[0];
  const dupAnalysis = dup.analyses[0];
  if (mainAnalysis && dupAnalysis) {
    const mainHasProfile = !!mainAnalysis.profile;
    const dupHasProfile = !!dupAnalysis.profile;
    if (!mainHasProfile && dupHasProfile) {
      await prisma.companyAnalysis.update({
        where: { id: mainAnalysis.id },
        data: {
          profile: dupAnalysis.profile,
          canvas: dupAnalysis.canvas ?? mainAnalysis.canvas,
          business: dupAnalysis.business ?? mainAnalysis.business,
        },
      });
      console.log(`[2/6] Copied profile/canvas/business from dup to main analysis`);
    } else {
      console.log(`[2/6] Retained existing main analysis`);
    }
    await prisma.companyAnalysis.delete({ where: { id: dupAnalysis.id } });
  } else if (!mainAnalysis && dupAnalysis) {
    await prisma.companyAnalysis.update({
      where: { id: dupAnalysis.id },
      data: { entityId: mainId },
    });
    console.log(`[2/6] Reassigned dup analysis to main entity`);
  } else {
    console.log(`[2/6] No duplicate analysis to merge`);
  }

  // 3. Merge ExtSources and their child Financials/Sections
  const mainSources = await prisma.extSource.findMany({ where: { filerEntityId: mainId } });
  const accessionToMainSource = new Map<string, string>();
  for (const s of mainSources) {
    if (s.accessionNumber) accessionToMainSource.set(s.accessionNumber, s.id);
  }

  const dupSources = await prisma.extSource.findMany({ where: { filerEntityId: dupId } });
  console.log(`[3/6] Processing ${dupSources.length} ExtSource rows from dup`);

  let mergedSources = 0;
  let reassignedSources = 0;

  for (const ds of dupSources) {
    const existingMainSid = ds.accessionNumber ? accessionToMainSource.get(ds.accessionNumber) : undefined;
    if (existingMainSid) {
      // Duplicate accession already exists on main: re-point or deduplicate child financials
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

      // Re-point or deduplicate child sections
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
  if (dupSources.length > 0) {
    console.log(`      Merged ${mergedSources} duplicate sources, reassigned ${reassignedSources} new sources.`);
  }

  // 4. Any remaining orphan Financials or Sections on dup
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
  if (remainingFins.length > 0) {
    console.log(`[4/6] Remaining financials: deduplicated ${deletedFins}, reassigned ${reassignedFins}`);
  }
  await prisma.filingSection.deleteMany({ where: { entityId: dupId } });

  // 5. Delete dup entity
  await prisma.entity.delete({ where: { id: dupId } });
  console.log(`[5/6] Deleted duplicate entity ${dupId}`);

  // 6. Update main entity: pad CIK, standardize code, update ticker/aliases
  const meta = (main.metadata as Record<string, unknown>) || {};
  delete meta.delisted;
  delete meta.delistedReason;
  delete meta.delistedMarkedAt;
  delete meta.onboardPhase2Attempts;
  delete meta.onboardPhase2LastError;
  delete meta.onboardPhase2LastAttemptAt;
  meta.isMasterUniverse = true;

  const finalPhase = Math.max(main.onboardPhase, dup.onboardPhase);
  const aliases = new Set(main.aliases ?? []);
  if (addAlias) aliases.add(addAlias);

  const updatedTicker = newTicker || main.ticker || dup.ticker;
  const updatedCode = newTicker || main.code || main.ticker || dup.code;

  await prisma.entity.update({
    where: { id: mainId },
    data: {
      cik: targetCik,
      ticker: updatedTicker,
      code: updatedCode,
      aliases: [...aliases],
      onboardPhase: finalPhase,
      metadata: meta,
    },
  });
  console.log(`[6/6] Updated main entity: CIK=${targetCik}, ticker=${updatedTicker}, aliases=${[...aliases].join(",")}, onboardPhase=${finalPhase}`);
  console.log(`✓ ${label} merge complete.\n`);
}

async function handleSnapAndArchDisambiguation() {
  console.log(`\n=======================================================`);
  console.log(`Handling SNAP / ARCH Disambiguation`);
  console.log(`=======================================================`);

  const snapMainId = "cmq616uoa00aorsu0gxl0vzzv";
  const snapDupId = "cmugnzmvy06xmoypdrb1flwhp";
  const archSecId = "cmsdt32i0001crsbkekvgpmrc";
  const archCik = "0001037676";

  // 1. Release CIK on snap dup stub
  await prisma.entity.update({
    where: { id: snapDupId },
    data: { cik: null },
  });

  // 2. Find or create Arch Resources Inc entity
  let archEntity = await prisma.entity.findFirst({
    where: {
      OR: [
        { cik: archCik },
        { ticker: "ARCH", canonicalName: { contains: "Arch Resources", mode: "insensitive" } },
      ],
    },
  });

  if (!archEntity) {
    archEntity = await prisma.entity.create({
      data: {
        type: "company",
        canonicalName: "ARCH RESOURCES, INC.",
        ticker: "ARCH",
        market: "us",
        code: "ARCH",
        cik: archCik,
        onboardPhase: 1,
        metadata: {
          nameZh: "阿奇资源",
          nameEnShort: "ARCH RESOURCES",
          exchange: "NYSE",
          isMasterUniverse: true,
        },
      },
    });
    console.log(`Created new Arch Resources entity: ${archEntity.id} (CIK: ${archCik})`);
  } else {
    console.log(`Found existing Arch Resources entity: ${archEntity.id}`);
  }

  // 3. Move ARCH security to Arch Resources entity
  await prisma.security.update({
    where: { id: archSecId },
    data: { companyEntityId: archEntity.id },
  });
  console.log(`Re-linked ARCH security ${archSecId} to Arch Resources entity ${archEntity.id}`);

  // 4. Delete the SNAP duplicate stub entity
  await prisma.entity.delete({ where: { id: snapDupId } });
  console.log(`Deleted SNAP duplicate stub entity ${snapDupId}`);

  // 5. Restore Snap Inc main entity
  const snapMain = await prisma.entity.findUniqueOrThrow({ where: { id: snapMainId } });
  const meta = (snapMain.metadata as Record<string, unknown>) || {};
  meta.nameZh = "Snap公司";
  meta.nameEnShort = "Snap";
  meta.isMasterUniverse = true;

  await prisma.entity.update({
    where: { id: snapMainId },
    data: {
      ticker: "SNAP",
      code: "SNAP",
      cik: "0001564408",
      metadata: meta,
    },
  });
  console.log(`Restored Snap Inc entity: CIK=0001564408, ticker=SNAP, nameZh=Snap公司`);
  console.log(`✓ SNAP / ARCH disambiguation complete.\n`);
}

async function normalizeAllRemainingCiks() {
  console.log(`\n=======================================================`);
  console.log(`Normalizing ALL remaining unpadded CIKs across DB`);
  console.log(`=======================================================`);

  // Pad Entity.cik
  const entityResult = await prisma.$executeRawUnsafe(`
    UPDATE "Entity"
    SET cik = LPAD(cik, 10, '0')
    WHERE cik IS NOT NULL AND length(cik) < 10;
  `);
  console.log(`Updated ${entityResult} Entity rows with padded 10-digit CIK.`);

  // Pad Filer.filerCik
  const filerResult = await prisma.$executeRawUnsafe(`
    UPDATE "Filer"
    SET "filerCik" = LPAD("filerCik", 10, '0')
    WHERE "filerCik" IS NOT NULL AND length("filerCik") < 10;
  `);
  console.log(`Updated ${filerResult} Filer rows with padded 10-digit filerCik.`);
}

async function main() {
  console.log(`Step 1: Merging 14 regular duplicate pairs...`);
  for (const pair of DUPLICATE_PAIRS) {
    await mergePair(pair);
  }

  console.log(`\nStep 2: Disambiguating SNAP / ARCH...`);
  await handleSnapAndArchDisambiguation();

  console.log(`\nStep 3: DB-wide CIK normalization...`);
  await normalizeAllRemainingCiks();

  // Final Verification
  const unpaddedEntities = await prisma.$queryRawUnsafe<Array<{ count: number }>>(`
    SELECT COUNT(*)::int as count FROM "Entity" WHERE cik IS NOT NULL AND length(cik) < 10;
  `);
  const unpaddedFilers = await prisma.$queryRawUnsafe<Array<{ count: number }>>(`
    SELECT COUNT(*)::int as count FROM "Filer" WHERE "filerCik" IS NOT NULL AND length("filerCik") < 10;
  `);

  console.log("\n================ Final Verification ================");
  console.log(`Entities with length(cik) < 10: ${unpaddedEntities[0]?.count} (expected: 0)`);
  console.log(`Filers with length(filerCik) < 10: ${unpaddedFilers[0]?.count} (expected: 0)`);

  const duplicates = await prisma.$queryRawUnsafe<Array<{ cik: string; cnt: number }>>(`
    SELECT cik, COUNT(*)::int as cnt
    FROM "Entity"
    WHERE cik IS NOT NULL
    GROUP BY cik
    HAVING COUNT(*) > 1;
  `);
  console.log(`Duplicate CIKs in DB: ${duplicates.length} (expected: 0)`);
  if (duplicates.length > 0) {
    console.error("Found duplicate CIKs:", duplicates);
  }
}

main()
  .catch((err) => {
    console.error("Fatal merge error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
