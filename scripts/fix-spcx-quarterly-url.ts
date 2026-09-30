/**
 * Fix SPCX quarterly filing URL using improved direct link strategy
 */

import { PrismaClient } from '@prisma/client';
import { fetchFilingIndexFiles } from './lib/filing-archive';

const prisma = new PrismaClient();

async function buildFilingUrl(cik: string, accession: string, formType: string): Promise<string> {
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
  } catch {
    console.warn(`Warning: Could not fetch filing index, using viewer URL`);
  }

  return `https://www.sec.gov/cgi-bin/viewer?action=view&cik=${cik}&accession_number=${accession}&xbrl_type=v`;
}

async function main() {
  const spcx = await prisma.entity.findFirst({
    where: { ticker: 'SPCX' }
  });

  if (!spcx) {
    console.log('SPCX not found');
    return;
  }

  const quarterly = await prisma.extSource.findMany({
    where: {
      filerEntityId: spcx.id,
      kind: '10q'
    }
  });

  console.log(`Found ${quarterly.length} quarterly filings for SPCX\n`);

  for (const filing of quarterly) {
    const oldUrl = filing.url;
    const newUrl = await buildFilingUrl(spcx.cik!, filing.accessionNumber!, '10-Q');

    console.log(`${filing.periodYear} Q${filing.periodQuarter}`);
    console.log(`  Old: ${oldUrl}`);
    console.log(`  New: ${newUrl}`);

    if (oldUrl !== newUrl) {
      await prisma.extSource.update({
        where: { id: filing.id },
        data: { url: newUrl }
      });
      console.log(`  ✓ Updated`);
    } else {
      console.log(`  (no change)`);
    }
    console.log('');
  }

  await prisma.$disconnect();
}

main().catch(console.error);
