import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const entity = await prisma.entity.findFirst({
    where: { ticker: 'BB' }
  });

  if (!entity) {
    console.log('Entity not found');
    return;
  }

  const filings = await prisma.extSource.findMany({
    where: {
      filerEntityId: entity.id,
      kind: '10K'
    },
    include: {
      artifacts: true
    },
    orderBy: [
      { periodYear: 'desc' },
      { periodQuarter: 'desc' }
    ]
  });

  console.log(`DIDIY 年报数据 (${filings.length} filings):\n`);

  filings.forEach(filing => {
    const meta = filing.metadata as Record<string, unknown>;
    const form = (meta?.form as string) || 'N/A';
    const accession = (meta?.accession as string) || filing.accessionNumber || 'N/A';

    console.log(`${filing.periodYear} Q${filing.periodQuarter} · ${form}`);
    console.log(`  filed: ${filing.filedAt?.toISOString().split('T')[0] || 'N/A'}`);
    console.log(`  accession: ${accession}`);
    console.log(`  url: ${filing.url || 'NULL'}`);
    console.log(`  artifacts: ${filing.artifacts.length} total`);

    const artifactsByKind = filing.artifacts.reduce((acc, a) => {
      acc[a.kind] = (acc[a.kind] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    Object.entries(artifactsByKind).forEach(([kind, count]) => {
      console.log(`    - ${kind}: ${count}`);
    });

    const hasPrimaryHtml = filing.artifacts.some(a => a.kind === 'primary_html');

    if (hasPrimaryHtml) {
      console.log(`  → 在线阅读 (HTML)`);
    } else if (filing.url) {
      console.log(`  → 查看原文 ↗`);
    } else if (entity.cik && accession !== 'N/A') {
      console.log(`  → 查看原文 ↗ (constructed SEC URL)`);
    } else {
      console.log(`  → NO LINK`);
    }

    console.log('');
  });

  await prisma.$disconnect();
}

main();
