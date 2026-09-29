/**
 * Cleanup filing artifacts (Phase 3 of unified external links strategy)
 *
 * Tasks:
 * 1. Backfill ExtSource.url for historical US filings (construct SEC viewer URL)
 * 2. Delete primary_html artifacts (no longer needed, use external links)
 * 3. Delete section_blocks artifacts (already deprecated)
 * 4. Keep section_text artifacts (required for LLM generation)
 *
 * Usage:
 *   npm run cleanup:filing-artifacts              # dry run
 *   npm run cleanup:filing-artifacts -- --execute # actual execution
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface CleanupStats {
  extSourceUrlBackfilled: number;
  primaryHtmlDeleted: number;
  sectionBlocksDeleted: number;
  storageFreedMB: number;
}

async function main() {
  const isDryRun = !process.argv.includes('--execute');

  console.log('=== Filing Artifacts Cleanup ===\n');
  console.log(`Mode: ${isDryRun ? 'DRY RUN (no changes)' : 'EXECUTE (will modify database)'}\n`);

  const stats: CleanupStats = {
    extSourceUrlBackfilled: 0,
    primaryHtmlDeleted: 0,
    sectionBlocksDeleted: 0,
    storageFreedMB: 0,
  };

  // Task 1: Backfill ExtSource.url for US filings
  console.log('[1/3] Backfill ExtSource.url for US filings without url...');

  const sourcesNeedingUrl = await prisma.extSource.findMany({
    where: {
      kind: { in: ['10k', '20f', '40f'] },
      url: null,
    },
    include: {
      filer: {
        select: { cik: true }
      }
    }
  });

  console.log(`  Found ${sourcesNeedingUrl.length} sources needing url backfill`);

  if (!isDryRun) {
    for (const source of sourcesNeedingUrl) {
      const meta = source.metadata as Record<string, unknown>;
      const accession = (meta?.accession as string) || source.accessionNumber;
      const cik = source.filer?.cik;

      if (cik && accession) {
        const url = `https://www.sec.gov/cgi-bin/viewer?action=view&cik=${cik}&accession_number=${accession}&xbrl_type=v`;
        await prisma.extSource.update({
          where: { id: source.id },
          data: { url }
        });
        stats.extSourceUrlBackfilled++;
      }
    }
    console.log(`  ✓ Backfilled ${stats.extSourceUrlBackfilled} urls\n`);
  } else {
    console.log(`  Would backfill ${sourcesNeedingUrl.length} urls\n`);
  }

  // Task 2: Delete primary_html artifacts
  console.log('[2/3] Delete primary_html artifacts...');

  const primaryHtmlArtifacts = await prisma.filingArtifact.findMany({
    where: { kind: 'primary_html' },
    select: { id: true, sizeBytes: true }
  });

  const primaryHtmlSizeMB = primaryHtmlArtifacts.reduce((sum, a) => sum + Number(a.sizeBytes), 0) / (1024 * 1024);
  console.log(`  Found ${primaryHtmlArtifacts.length} primary_html artifacts (~${primaryHtmlSizeMB.toFixed(2)} MB)`);

  if (!isDryRun) {
    const deleted = await prisma.filingArtifact.deleteMany({
      where: { kind: 'primary_html' }
    });
    stats.primaryHtmlDeleted = deleted.count;
    stats.storageFreedMB += primaryHtmlSizeMB;
    console.log(`  ✓ Deleted ${stats.primaryHtmlDeleted} artifacts\n`);
  } else {
    console.log(`  Would delete ${primaryHtmlArtifacts.length} artifacts\n`);
  }

  // Task 3: Delete section_blocks artifacts (deprecated)
  console.log('[3/3] Delete section_blocks artifacts (deprecated)...');

  const sectionBlocksArtifacts = await prisma.filingArtifact.findMany({
    where: { kind: 'section_blocks' },
    select: { id: true, sizeBytes: true }
  });

  const sectionBlocksSizeMB = sectionBlocksArtifacts.reduce((sum, a) => sum + Number(a.sizeBytes), 0) / (1024 * 1024);
  console.log(`  Found ${sectionBlocksArtifacts.length} section_blocks artifacts (~${sectionBlocksSizeMB.toFixed(2)} MB)`);

  if (!isDryRun) {
    const deleted = await prisma.filingArtifact.deleteMany({
      where: { kind: 'section_blocks' }
    });
    stats.sectionBlocksDeleted = deleted.count;
    stats.storageFreedMB += sectionBlocksSizeMB;
    console.log(`  ✓ Deleted ${stats.sectionBlocksDeleted} artifacts\n`);
  } else {
    console.log(`  Would delete ${sectionBlocksArtifacts.length} artifacts\n`);
  }

  // Summary
  console.log('=== Summary ===\n');
  if (!isDryRun) {
    console.log(`ExtSource.url backfilled: ${stats.extSourceUrlBackfilled}`);
    console.log(`primary_html deleted: ${stats.primaryHtmlDeleted}`);
    console.log(`section_blocks deleted: ${stats.sectionBlocksDeleted}`);
    console.log(`Database storage freed: ~${stats.storageFreedMB.toFixed(2)} MB`);
    console.log(`\nNote: R2 objects must be cleaned up manually or via lifecycle policy`);
  } else {
    console.log(`DRY RUN - no changes made`);
    console.log(`\nTo execute, run: npm run cleanup:filing-artifacts -- --execute`);
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
