/**
 * 快速查询待完善的公司（没有 Financial 数据的公司）
 */
import prisma from "@/lib/prisma";
import { writeFile } from "fs/promises";

async function main() {
  console.log("Querying companies...");

  // 查询所有公司
  const allCompanies = await prisma.entity.findMany({
    where: { type: "company" },
    select: {
      id: true,
      ticker: true,
      canonicalName: true,
      market: true,
      cik: true,
      _count: {
        select: {
          financials: true
        }
      }
    }
  });

  console.log(`Total companies: ${allCompanies.length}`);

  // 筛选待完善的公司（没有 Financial 数据）
  const pending = allCompanies.filter(c => c._count.financials === 0);

  console.log(`Pending companies (no financials): ${pending.length}\n`);

  // 按市场分组统计
  const byMarket = pending.reduce((acc, c) => {
    const market = c.market || 'unknown';
    acc[market] = (acc[market] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log('By market:');
  Object.entries(byMarket)
    .sort(([, a], [, b]) => b - a)
    .forEach(([market, count]) => {
      console.log(`  ${market.padEnd(10)}: ${count}`);
    });

  // 检查有 ticker 但没有 financials 的公司
  const withTicker = pending.filter(c => c.ticker);
  const withoutTicker = pending.filter(c => !c.ticker);

  console.log(`\nWith ticker: ${withTicker.length}`);
  console.log(`Without ticker: ${withoutTicker.length}`);

  // 输出前 30 家公司详情
  console.log('\n=== First 30 pending companies ===');
  pending.slice(0, 30).forEach((c, i) => {
    const ticker = c.ticker || 'NO_TICKER';
    const market = c.market || 'unknown';
    console.log(`${String(i + 1).padStart(3)}. ${ticker.padEnd(12)} ${market.padEnd(8)} ${c.canonicalName}`);
  });

  // 按市场分组输出
  console.log('\n=== By Market Breakdown ===');
  for (const [market, companies] of Object.entries(
    pending.reduce((acc, c) => {
      const m = c.market || 'unknown';
      if (!acc[m]) acc[m] = [];
      acc[m].push(c);
      return acc;
    }, {} as Record<string, typeof pending>)
  )) {
    console.log(`\n${market.toUpperCase()} (${companies.length}):`);
    companies.slice(0, 10).forEach(c => {
      const ticker = c.ticker || 'NO_TICKER';
      console.log(`  ${ticker.padEnd(12)} ${c.canonicalName}`);
    });
    if (companies.length > 10) {
      console.log(`  ... and ${companies.length - 10} more`);
    }
  }

  // 保存完整列表到文件
  const output = {
    summary: {
      total: allCompanies.length,
      pending: pending.length,
      byMarket,
      withTicker: withTicker.length,
      withoutTicker: withoutTicker.length
    },
    companies: pending.map(c => ({
      id: c.id,
      ticker: c.ticker,
      canonicalName: c.canonicalName,
      market: c.market,
      cik: c.cik
    }))
  };

  await writeFile(
    'pending-companies-analysis.json',
    JSON.stringify(output, null, 2)
  );
  console.log('\n✓ Full list saved to pending-companies-analysis.json');

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Error:', err);
  await prisma.$disconnect();
  process.exit(1);
});
