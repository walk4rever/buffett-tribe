/**
 * vacuum-tables.ts
 *
 * Runs VACUUM FULL on FinancialFact and FilingSection via a direct
 * (non-pooled) Postgres connection. This bypasses Supabase SQL Editor's
 * HTTP timeout and PgBouncer's connection limits.
 *
 * VACUUM FULL physically rewrites the table and returns disk space to the OS.
 * It requires an ACCESS EXCLUSIVE lock — the table will be inaccessible during
 * execution (est. 5–15 min per table).
 *
 * Usage:
 *   npm run vacuum:tables
 */

import { Client } from "pg";

const TABLES = ["FinancialFact", "FilingSection"];

async function vacuumTable(client: Client, table: string) {
  console.log(`\n[vacuum] Starting VACUUM FULL on "${table}"...`);
  console.log(`[vacuum] This may take 5–15 minutes. Do NOT interrupt.`);

  const start = Date.now();

  // VACUUM FULL cannot run inside a transaction block.
  // pg Client (non-pooled) runs statements directly — safe for VACUUM.
  await client.query(`VACUUM FULL "${table}"`);

  const elapsed = Math.round((Date.now() - start) / 1000);
  console.log(`[vacuum] ✅ "${table}" done in ${elapsed}s`);
}

async function getTableSize(client: Client, table: string): Promise<string> {
  const res = await client.query<{ size: string }>(
    `SELECT pg_size_pretty(pg_total_relation_size('"${table}"')) AS size`
  );
  return res.rows[0].size;
}

async function main() {
  // Build the TRUE direct URL (not Supavisor pooler).
  // VACUUM FULL does not work reliably through Supavisor (pooler.supabase.com).
  // True direct format: postgresql://postgres:[password]@db.[project-ref].supabase.co:5432/postgres
  const supavisorUrl = process.env.DIRECT_URL ?? "";
  if (!supavisorUrl) throw new Error("DIRECT_URL not set in environment");

  // Parse project-ref and password from the Supavisor URL and build the true direct URL.
  // Supavisor user format: postgres.PROJECT_REF  →  host: db.PROJECT_REF.supabase.co
  let directUrl = supavisorUrl;
  try {
    const parsed = new URL(supavisorUrl);
    const userParts = parsed.username.split("."); // e.g. ["postgres", "vsrgznawbxtvgtzzixvh"]
    if (userParts.length === 2) {
      const projectRef = userParts[1];
      directUrl = `postgresql://postgres:${parsed.password}@db.${projectRef}.supabase.co:5432/postgres`;
      console.log(`[vacuum] Using true direct URL: db.${projectRef}.supabase.co:5432`);
    } else {
      console.log("[vacuum] Could not parse project-ref; falling back to DIRECT_URL");
    }
  } catch {
    console.log("[vacuum] URL parse failed; falling back to DIRECT_URL");
  }

  // Use a single non-pooled client with no statement timeout
  const client = new Client({
    connectionString: directUrl,
    connectionTimeoutMillis: 15_000,
    query_timeout: 0, // disable query timeout for VACUUM FULL
    ssl: { rejectUnauthorized: false }, // Supabase requires SSL for direct connections
  });

  await client.connect();
  console.log("[vacuum] Connected via direct URL (bypassing PgBouncer)");

  // Show sizes before
  console.log("\n[vacuum] Table sizes BEFORE:");
  for (const table of TABLES) {
    const size = await getTableSize(client, table);
    console.log(`  ${table}: ${size}`);
  }

  // Run VACUUM FULL for each table sequentially
  for (const table of TABLES) {
    await vacuumTable(client, table);
  }

  // Show sizes after
  console.log("\n[vacuum] Table sizes AFTER:");
  for (const table of TABLES) {
    const size = await getTableSize(client, table);
    console.log(`  ${table}: ${size}`);
  }

  await client.end();
  console.log("\n[vacuum] Done. Disk space has been returned to the OS.");
}

main().catch((err) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error(`[vacuum] fatal: ${msg}`);
  process.exit(1);
});
