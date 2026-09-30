import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== FilingSection 数据统计 ===\n');

  // 总记录数
  const totalSections = await prisma.filingSection.count();
  console.log('FilingSection 总记录数:', totalSections);

  // 按章节类型分布
  const bySectionType = await prisma.filingSection.groupBy({
    by: ['section'],
    _count: true,
    orderBy: { _count: { section: 'desc' } }
  });

  console.log('\n按章节类型分布（前20）:');
  bySectionType.slice(0, 20).forEach(({ section, _count }) => {
    console.log(`  ${section.padEnd(40)}: ${_count} 条`);
  });

  // 统计有多少公司有 FilingSection 数据
  const companiesWithFilings = await prisma.filingSection.groupBy({
    by: ['entityId'],
    _count: true
  });

  console.log('\n有年报章节数据的公司数:', companiesWithFilings.length);

  // 统计每家公司平均有多少条记录
  const avgPerCompany = totalSections / companiesWithFilings.length;
  console.log('平均每家公司的章节数:', avgPerCompany.toFixed(1));

  // 检查核心章节（Item 1 / Item 7）
  const item1Count = await prisma.filingSection.count({
    where: {
      OR: [
        { section: { contains: 'item_1' } },
        { section: { contains: 'business' } }
      ]
    }
  });

  const item7Count = await prisma.filingSection.count({
    where: {
      OR: [
        { section: { contains: 'item_7' } },
        { section: { contains: 'mda' } }
      ]
    }
  });

  console.log('\n核心章节（Item 1 / Item 7）统计:');
  console.log('  Item 1 相关 (业务描述):', item1Count, `(${((item1Count/totalSections)*100).toFixed(1)}%)`);
  console.log('  Item 7 相关 (MD&A):', item7Count, `(${((item7Count/totalSections)*100).toFixed(1)}%)`);
  console.log('  其他章节:', totalSections - item1Count - item7Count, `(${(((totalSections - item1Count - item7Count)/totalSections)*100).toFixed(1)}%)`);

  // 通过关联 ExtSource 统计年份分布
  const allSections = await prisma.filingSection.findMany({
    select: {
      source: {
        select: {
          periodYear: true
        }
      }
    }
  });

  const yearCount = new Map<number, number>();
  allSections.forEach(s => {
    if (s.source.periodYear) {
      yearCount.set(s.source.periodYear, (yearCount.get(s.source.periodYear) || 0) + 1);
    }
  });

  console.log('\n按年份分布:');
  Array.from(yearCount.entries())
    .sort((a, b) => b[0] - a[0])
    .forEach(([year, count]) => {
      console.log(`  ${year}: ${count} 条`);
    });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
