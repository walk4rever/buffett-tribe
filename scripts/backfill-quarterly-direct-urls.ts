/**
 * Backfill quarterly filing URLs with direct Archives links
 *
 * Replaces SEC viewer URLs with direct document URLs for better reliability
 */

import { PrismaClient } from '@prisma/client';
import { fetchFilingIndexFiles } from './lib/filing-archive';

const prisma = new PrismaClient();

async function buildDirectUrl(cik: string, accession: string, formType: string): Promise<string | null> {
  const paddedCik = cik.padStart(10, "0");

  try {
    const { files } = await fetchFilingIndexFiles(paddedCik, accession);

    const primaryDoc = files.find(f =>
      f.category === "attachment" &&
      f.description?.toLowerCase().includes(formType.toLowerCase()) &&
      (f.documentName.endsWith('.htm') || f.documentName.endsWith('.html'))
    );

    if (primaryDoc) {
      const accessionPath = accession.replace(/-/g, "");
      return `https://www.sec.gov/Archives/edgar/data/${paddedCik}/${accessionPath}/${primaryDoc.documentName}`;
    }
  } catch (error) {
    // Ignore errors, return null to keep viewer URL
  }

  return null;
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run');

  // Find all quarterly filings with viewer URLs
  const quarterlyFilings = await prisma.extSource.findMany({
    where: {
      kind: '10q',
      url: {
        contains: 'cgi-bin/viewer'
      }
    },
    include: {
      filer: {
        select: { ticker: true, cik: true }
      }
    },
    orderBy: [
      { periodYear: 'desc' },
      { periodQuarter: 'desc' }
    ]
  });

  console.log(`Found ${quarterlyFilings.length} quarterly filings with viewer URLs\n`);

  if (isDryRun) {
    console.log('DRY RUN - no updates will be made\n');
  }

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const filing of quarterlyFilings) {
    const cik = filing.filer?.cik;
    const ticker = filing.filer?.ticker || 'unknown';
    const accession = filing.accessionNumber;

    if (!cik || !accession) {
      console.log(`⚠️  ${ticker} ${filing.periodYear} Q${filing.periodQuarter}: missing CIK or accession`);
      skipped++;
      continue;
    }

    const directUrl = await buildDirectUrl(cik, accession, '10-Q');

    if (directUrl) {
      console.log(`✓ ${ticker} ${filing.periodYear} Q${filing.periodQuarter}`);
      console.log(`  Old: ${filing.url}`);
      console.log(`  New: ${directUrl}`);

      if (!isDryRun) {
        await prisma.extSource.update({
          where: { id: filing.id },
          data: { url: directUrl }
        });
      }

      updated++;
    } else {
      console.log(`⚠️  ${ticker} ${filing.periodYear} Q${filing.periodQuarter}: could not build direct URL, keeping viewer URL`);
      failed++;
    }
  }

  console.log(`\nSummary:`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Failed (kept viewer URL): ${failed}`);
  console.log(`  Skipped: ${skipped}`);

  await prisma.$disconnect();
}

main().catch(console.error);
