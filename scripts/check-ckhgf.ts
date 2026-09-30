import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const entity = await prisma.entity.findFirst({
    where: { ticker: 'CKHGF', market: 'us' },
    select: {
      id: true,
      canonicalName: true,
      cik: true,
      ticker: true,
      market: true,
      type: true,
      onboardPhase: true
    }
  });

  console.log('CKHGF Entity:');
  console.log(JSON.stringify(entity, null, 2));

  if (entity) {
    const financials = await prisma.financial.count({
      where: { entityId: entity.id }
    });

    const extSources = await prisma.extSource.findMany({
      where: { filerEntityId: entity.id },
      select: { id: true, kind: true, periodYear: true, ts: true }
    });

    console.log('\nFinancial records:', financials);
    console.log('\nExtSource records:');
    console.log(JSON.stringify(extSources, null, 2));
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
