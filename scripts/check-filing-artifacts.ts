/**
 * Simple check of FilingArtifact and FilingSection data
 * to understand what we can clean up
 *
 * Usage:
 *   npx tsx scripts/check-filing-artifacts.ts
 */

import prisma from "../src/lib/prisma";

async function main() {
  console.log("Checking filing artifacts and sections...\n");

  // FilingArtifact by kind
  console.log("=== FilingArtifact by kind ===");
  const artifactsByKind = await prisma.filingArtifact.groupBy({
    by: ['kind'],
    _count: true,
  });

  for (const row of artifactsByKind) {
    console.log(`  ${row.kind}: ${row._count} artifacts`);
  }
  console.log();

  // Total ExtSource
  const totalSources = await prisma.extSource.count();
  console.log(`Total ExtSource: ${totalSources}`);

  // ExtSource with PDF artifacts
  const withPdf = await prisma.extSource.count({
    where: { artifacts: { some: { kind: 'primary_pdf' } } }
  });
  console.log(`ExtSource with primary_pdf: ${withPdf}`);

  // ExtSource with HTML artifacts
  const withHtml = await prisma.extSource.count({
    where: { artifacts: { some: { kind: 'primary_html' } } }
  });
  console.log(`ExtSource with primary_html: ${withHtml}`);
  console.log();

  // FilingSection stats
  const totalSections = await prisma.filingSection.count();
  console.log(`Total FilingSection: ${totalSections}`);

  // Sections by market (via ExtSource kind)
  const sectionsByMarket = await prisma.$queryRawUnsafe<Array<{
    market: string;
    count: bigint;
  }>>(
    `SELECT
      CASE
        WHEN es.kind LIKE 'cn-%' THEN 'CN'
        WHEN es.kind LIKE 'hk-%' THEN 'HK'
        WHEN es.kind IN ('10k', '20f', '40f', '10q', 'us-prospectus') THEN 'US'
        ELSE 'OTHER'
      END as market,
      COUNT(*) as count
    FROM "FilingSection" fs
    JOIN "ExtSource" es ON fs."sourceId" = es.id
    GROUP BY market
    ORDER BY count DESC`
  );

  console.log("\nFilingSection by market:");
  for (const row of sectionsByMarket) {
    console.log(`  ${row.market}: ${row.count}`);
  }
  console.log();

  // Sample some sections to see content size
  const sampleSections = await prisma.filingSection.findMany({
    select: { content: true },
    take: 100,
  });

  const lengths = sampleSections.map(s => s.content.length);
  const avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const maxLength = Math.max(...lengths);
  const minLength = Math.min(...lengths);

  console.log("FilingSection content stats (sample of 100):");
  console.log(`  Avg length: ${Math.round(avgLength).toLocaleString()} chars`);
  console.log(`  Max length: ${maxLength.toLocaleString()} chars`);
  console.log(`  Min length: ${minLength.toLocaleString()} chars`);
  console.log();

  // Financial table
  const totalFinancials = await prisma.financial.count();
  console.log(`Total Financial rows: ${totalFinancials}`);

  // StockPrice table
  const totalPrices = await prisma.stockPrice.count();
  console.log(`Total StockPrice rows: ${totalPrices}`);

  // Holding table
  const totalHoldings = await prisma.holding.count();
  console.log(`Total Holding rows: ${totalHoldings}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
