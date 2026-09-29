/**
 * Backfill ExtSource.url for quarterly filings (10-Q)
 *
 * Run after modifying import-us-quarterly-financials.ts to ensure
 * historical quarterly filings also have SEC viewer URLs.
 *
 * Usage:
 *   npm run backfill:quarterly-urls         # dry run
 *   npm run backfill:quarterly-urls -- --execute
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const isDryRun = !process.argv.includes('--execute');

  console.log('=== Backfill Quarterly Filing URLs ===\n');
  console.log(`Mode: ${isDryRun ? 'DRY RUN' : 'EXECUTE'}\n`);

  // Find 10-Q filings without url
  const quarterlyFilings = await prisma.extSource.findMany({
    where: {
      kind: '10q',
      url: null,
    },
    include: {
      filer: {
        select: { cik: true }
      }
    }
  });

  console.log(`Found ${quarterlyFilings.length} quarterly filings without url\n`);

  let updated = 0;
  let skipped = 0;

  for (const filing of quarterlyFilings) {
    const meta = filing.metadata as Record<string, unknown>;
    const accession = filing.accessionNumber || (meta?.accn as string);
    const cik = filing.filer?.cik;

    if (!cik || !accession) {
      console.log(`  Skip: ${filing.periodYear} Q${filing.periodQuarter} - missing CIK or accession`);
      skipped++;
      continue;
    }

    const url = `https://www.sec.gov/cgi-bin/viewer?action=view&cik=${cik}&accession_number=${accession}&xbrl_type=v`;

    if (!isDryRun) {
      await prisma.extSource.update({
        where: { id: filing.id },
        data: { url }
      });
    }

    console.log(`  ${isDryRun ? 'Would update' : 'Updated'}: ${filing.periodYear} Q${filing.periodQuarter} (${accession})`);
    updated++;
  }

  console.log(`\n=== Summary ===\n`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);

  if (isDryRun) {
    console.log(`\nTo execute, run: npm run backfill:quarterly-urls -- --execute`);
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
