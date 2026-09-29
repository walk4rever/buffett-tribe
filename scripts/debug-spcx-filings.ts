import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const entity = await prisma.entity.findFirst({
    where: { ticker: 'SPCX' }
  });

  if (!entity) {
    console.log('SPCX not found');
    return;
  }

  console.log(`Entity: ${entity.name} (${entity.ticker})`);
  console.log(`CIK: ${entity.cik}\n`);

  // Get all filings
  const filings = await prisma.extSource.findMany({
    where: {
      filerEntityId: entity.id
    },
    orderBy: [
      { periodYear: 'desc' },
      { periodQuarter: 'desc' }
    ]
  });

  console.log(`Total filings: ${filings.length}\n`);

  filings.forEach(filing => {
    const meta = filing.metadata as Record<string, unknown>;
    const form = (meta?.form as string) || filing.kind.toUpperCase();

    console.log(`${filing.periodYear} Q${filing.periodQuarter || 'N/A'} · ${form}`);
    console.log(`  kind: ${filing.kind}`);
    console.log(`  filed: ${filing.filedAt?.toISOString().split('T')[0]}`);
    console.log(`  accession: ${filing.accessionNumber || (meta?.accession as string) || 'NULL'}`);
    console.log(`  url: ${filing.url || 'NULL'}`);

    if (!filing.url) {
      console.log(`  → NO LINK!`);
      if (entity.cik && (filing.accessionNumber || (meta?.accession as string))) {
        const accession = filing.accessionNumber || (meta?.accession as string);
        const constructedUrl = `https://www.sec.gov/cgi-bin/viewer?action=view&cik=${entity.cik}&accession_number=${accession}&xbrl_type=v`;
        console.log(`  → Could construct: ${constructedUrl}`);
      }
    } else {
      console.log(`  → 查看原文 ↗`);
    }
    console.log('');
  });

  await prisma.$disconnect();
}

main();
