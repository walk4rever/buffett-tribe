/**
 * Database capacity check against Supabase free-tier limit (500MB).
 * Prints per-table sizes and total; exits non-zero over thresholds so
 * CI/cron can alert and batch jobs can refuse to run.
 *
 * Exit codes: 0 ok | 1 warn (>DB_SIZE_WARN_MB) | 2 critical (>DB_SIZE_CRITICAL_MB)
 *
 * Usage:
 *   tsx scripts/check-db-size.ts            # human-readable report
 *   tsx scripts/check-db-size.ts --quiet    # one summary line only
 */

import prisma from "../src/lib/prisma";

const WARN_MB = Number(process.env.DB_SIZE_WARN_MB ?? 400);
const CRITICAL_MB = Number(process.env.DB_SIZE_CRITICAL_MB ?? 450);

type TableRow = { table: string; total: string; bytes: bigint; rows: bigint };

export async function getDbSizeMb(): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ bytes: bigint }>>(
    `SELECT pg_database_size(current_database()) AS bytes`,
  );
  return Number(rows[0].bytes) / 1e6;
}

async function main() {
  const quiet = process.argv.includes("--quiet");

  const tables = await prisma.$queryRawUnsafe<TableRow[]>(`
    SELECT c.relname AS table,
           pg_size_pretty(pg_total_relation_size(c.oid)) AS total,
           pg_total_relation_size(c.oid) AS bytes,
           COALESCE(s.n_live_tup, 0) AS rows
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY pg_total_relation_size(c.oid) DESC
    LIMIT 15`);

  const totalMb = await getDbSizeMb();

  if (!quiet) {
    for (const t of tables) {
      console.log(`${t.table.padEnd(28)} ${String(t.total).padStart(10)}  rows≈${t.rows}`);
    }
  }

  const status = totalMb > CRITICAL_MB ? "CRITICAL" : totalMb > WARN_MB ? "WARN" : "OK";
  console.log(
    `DB_SIZE: ${totalMb.toFixed(0)}MB / 500MB free tier | warn>${WARN_MB}MB critical>${CRITICAL_MB}MB | STATUS: ${status}`,
  );

  await prisma.$disconnect();
  if (status === "CRITICAL") process.exit(2);
  if (status === "WARN") process.exit(1);
}

const isDirectRun = process.argv[1]?.endsWith("check-db-size.ts");
if (isDirectRun) {
  main().catch(async (err) => {
    console.error("[check-db-size] fatal", err);
    await prisma.$disconnect();
    process.exit(2);
  });
}
