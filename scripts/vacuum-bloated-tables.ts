/**
 * Capacity maintenance: cap FilingSection.content preview length, then
 * VACUUM FULL the bloat-heavy tables to return disk to the OS.
 *
 * content cap is safe because (audited 2026-06-13):
 *   - full section text lives in R2 (textArtifactId, 100% populated)
 *   - generation pipelines read at most the first 2.4KB (truncateText)
 *   - the reader UI uses contentPreview + R2 artifacts
 * Rows without textArtifactId are left untouched as a safety net.
 *
 * VACUUM FULL takes an exclusive lock per table (tables are small; expect
 * seconds each). Runs on DIRECT_URL — the pooled connection rejects VACUUM.
 *
 * Usage:
 *   tsx scripts/vacuum-bloated-tables.ts --dry-run   # report only
 *   tsx scripts/vacuum-bloated-tables.ts             # cap + vacuum
 */

import { PrismaClient } from "@prisma/client";

const CONTENT_CAP = 3000;
const TABLES_TO_VACUUM = ["Chunk", "FilingSection", "ExtSource", "StockPrice"] as const;

const directUrl = process.env.DIRECT_URL;
if (!directUrl) {
  console.error("DIRECT_URL is not set — VACUUM cannot run through the pooled connection.");
  process.exit(1);
}
const db = new PrismaClient({ datasourceUrl: directUrl });

async function tableSizeMb(table: string): Promise<number> {
  const rows = await db.$queryRawUnsafe<Array<{ bytes: bigint }>>(
    `SELECT pg_total_relation_size('"${table}"') AS bytes`,
  );
  return Number(rows[0].bytes) / 1e6;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const capCandidates = await db.$queryRawUnsafe<Array<{ n: number; mb: number }>>(`
    SELECT count(*)::int AS n, (sum(length(content)) / 1e6)::float AS mb
    FROM "FilingSection"
    WHERE length(content) > ${CONTENT_CAP} AND "textArtifactId" IS NOT NULL`);
  console.log(
    `FilingSection content cap @${CONTENT_CAP} chars: ${capCandidates[0].n} rows, ` +
      `${(capCandidates[0].mb ?? 0).toFixed(1)}MB uncompressed text affected${dryRun ? " [DRY-RUN]" : ""}`,
  );

  if (!dryRun && capCandidates[0].n > 0) {
    const updated = await db.$executeRawUnsafe(`
      UPDATE "FilingSection" SET content = left(content, ${CONTENT_CAP})
      WHERE length(content) > ${CONTENT_CAP} AND "textArtifactId" IS NOT NULL`);
    console.log(`  capped ${updated} rows`);
  }

  for (const table of TABLES_TO_VACUUM) {
    const before = await tableSizeMb(table);
    if (dryRun) {
      console.log(`VACUUM FULL "${table}" [DRY-RUN]: currently ${before.toFixed(0)}MB`);
      continue;
    }
    console.log(`VACUUM FULL "${table}" (${before.toFixed(0)}MB)...`);
    const started = Date.now();
    await db.$executeRawUnsafe(`VACUUM FULL ANALYZE "${table}"`);
    const after = await tableSizeMb(table);
    console.log(`  ${before.toFixed(0)}MB -> ${after.toFixed(0)}MB in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }

  const total = await db.$queryRawUnsafe<Array<{ s: string }>>(
    `SELECT pg_size_pretty(pg_database_size(current_database())) AS s`,
  );
  console.log(`\nDATABASE TOTAL: ${total[0].s}`);
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error("[vacuum-bloated-tables] fatal", err);
  await db.$disconnect();
  process.exit(1);
});
