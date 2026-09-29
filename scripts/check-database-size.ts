/**
 * Check database table sizes to understand storage usage
 *
 * Usage:
 *   npx tsx scripts/check-database-size.ts
 */

import prisma from "../src/lib/prisma";

async function main() {
  console.log("Checking database table sizes...\n");

  // Query pg_tables for size information - use $queryRawUnsafe to avoid schema validation
  const result = await prisma.$queryRawUnsafe<Array<{
    schemaname: string;
    tablename: string;
    size: string;
    size_bytes: bigint;
  }>>(
    `SELECT
      schemaname,
      tablename,
      pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
      pg_total_relation_size(schemaname||'.'||tablename) AS size_bytes
    FROM pg_tables
    WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
    ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
    LIMIT 20`
  );

  console.log("Top 20 tables by size:\n");
  console.log("Table Name".padEnd(40), "Size".padEnd(15), "Bytes");
  console.log("-".repeat(70));

  let totalBytes = 0n;
  for (const row of result) {
    const fullName = `${row.schemaname}.${row.tablename}`;
    console.log(
      fullName.padEnd(40),
      row.size.padEnd(15),
      row.size_bytes.toString()
    );
    totalBytes += row.size_bytes;
  }

  console.log("-".repeat(70));
  console.log("Total (top 20):".padEnd(40), formatBytes(totalBytes));
  console.log();

  // Check FilingArtifact counts by kind
  console.log("FilingArtifact breakdown by kind:\n");
  const artifacts = await prisma.filingArtifact.groupBy({
    by: ['kind'],
    _count: true,
  });

  for (const row of artifacts) {
    console.log(`  ${row.kind}: ${row._count} artifacts`);
  }
  console.log();

  // Check FilingSection stats
  const sectionStats = await prisma.$queryRaw<Array<{
    count: bigint;
    avg_length: number;
    total_length: bigint;
  }>>`
    SELECT
      COUNT(*) as count,
      AVG(LENGTH(content)) as avg_length,
      SUM(LENGTH(content)) as total_length
    FROM "FilingSection"
  `;

  if (sectionStats.length > 0) {
    const stats = sectionStats[0];
    console.log("FilingSection stats:");
    console.log(`  Total sections: ${stats.count}`);
    console.log(`  Avg content length: ${Math.round(stats.avg_length)} chars`);
    console.log(`  Total content size: ${formatBytes(BigInt(stats.total_length))}`);
    console.log();
  }

  // Check ExtSource with artifacts
  const sourcesWithArtifacts = await prisma.extSource.count({
    where: {
      artifacts: {
        some: {
          kind: { in: ['primary_pdf', 'primary_html'] }
        }
      }
    }
  });

  const totalSources = await prisma.extSource.count();
  console.log("ExtSource stats:");
  console.log(`  Total sources: ${totalSources}`);
  console.log(`  Sources with PDF/HTML artifacts: ${sourcesWithArtifacts}`);
  console.log();

  await prisma.$disconnect();
}

function formatBytes(bytes: bigint): string {
  const kb = Number(bytes) / 1024;
  if (kb < 1024) return `${kb.toFixed(2)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(2)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
