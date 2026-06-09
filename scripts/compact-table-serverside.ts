/**
 * compact-table-serverside.ts
 *
 * Server-side TRUNCATE + re-insert compaction.
 * Unlike compact-table.ts (which streams all rows to Node.js),
 * this script runs everything inside Postgres using a TEMP TABLE —
 * no large data transfer over the network, no connection timeout.
 *
 * Steps (all run on the server):
 * 1. CREATE TEMP TABLE backup AS SELECT * FROM "Table"  → server-side copy
 * 2. TRUNCATE "Table"                                    → instant, reclaims space
 * 3. INSERT INTO "Table" SELECT * FROM backup           → server-side copy back
 *
 * Usage:
 *   npm run compact:server -- --table FilingSection
 *   npm run compact:server -- --table FilingSection --dry-run
 */

import { Client } from "pg";

function parseArgs() {
  const argv = process.argv.slice(2);
  const tableIdx = argv.indexOf("--table");
  const table = tableIdx !== -1 ? argv[tableIdx + 1] : null;
  const dryRun = argv.includes("--dry-run");
  if (!table) throw new Error("--table <TableName> is required");
  return { table, dryRun };
}

async function query(client: Client, sql: string, label: string) {
  console.log(`[compact] ${label}...`);
  const start = Date.now();
  const res = await client.query(sql);
  const elapsed = Math.round((Date.now() - start) / 1000);
  console.log(`[compact] ✅ ${label} done in ${elapsed}s`);
  return res;
}

async function getSize(client: Client, table: string): Promise<string> {
  const r = await client.query(
    `SELECT pg_size_pretty(pg_total_relation_size('"${table}"')) AS sz`
  );
  return r.rows[0].sz;
}

async function main() {
  const { table, dryRun } = parseArgs();
  const tmpTable = `_compact_backup_${table.toLowerCase()}`;

  console.log(`[compact] Server-side compaction for "${table}" | dry-run=${dryRun}`);

  const client = new Client({
    connectionString: process.env.DIRECT_URL,
    query_timeout: 0,
    // Keep-alive to prevent Supavisor from dropping idle TCP connection
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
  });

  await client.connect();

  // Disable server-side timeouts for this session
  await client.query("SET statement_timeout = 0");
  await client.query("SET lock_timeout = 0");
  console.log("[compact] Connected. Server timeouts disabled.");

  const sizeBefore = await getSize(client, table);
  const countBefore = (await client.query(`SELECT COUNT(*) AS n FROM "${table}"`)).rows[0].n;
  console.log(`[compact] Before: ${sizeBefore} | ${parseInt(countBefore).toLocaleString()} rows`);

  if (dryRun) {
    console.log("[compact] --dry-run: no changes. Exiting.");
    await client.end();
    return;
  }

  // Clean up any leftover temp table from a previous failed run
  await client.query(`DROP TABLE IF EXISTS "${tmpTable}"`);

  // Step 1: Server-side copy into temp table (no network transfer)
  await query(
    client,
    `CREATE TEMP TABLE "${tmpTable}" AS SELECT * FROM "${table}"`,
    `CREATE TEMP TABLE "${tmpTable}" AS SELECT * FROM "${table}"`
  );

  const tmpCount = (await client.query(`SELECT COUNT(*) AS n FROM "${tmpTable}"`)).rows[0].n;
  console.log(`[compact] Temp table has ${parseInt(tmpCount).toLocaleString()} rows`);

  // Step 2: TRUNCATE (instant, reclaims all disk space including dead TOAST)
  await query(
    client,
    `TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE`,
    `TRUNCATE "${table}"`
  );
  console.log(`[compact] Size after TRUNCATE: ${await getSize(client, table)}`);

  // Step 3: Re-insert from temp table (server-side, no network transfer)
  await query(
    client,
    `INSERT INTO "${table}" SELECT * FROM "${tmpTable}"`,
    `INSERT INTO "${table}" SELECT * FROM temp`
  );

  // Cleanup temp table
  await client.query(`DROP TABLE IF EXISTS "${tmpTable}"`);

  const sizeAfter = await getSize(client, table);
  const countAfter = (await client.query(`SELECT COUNT(*) AS n FROM "${table}"`)).rows[0].n;

  console.log(`\n[compact] ✅ Compaction complete!`);
  console.log(`[compact] Size: ${sizeBefore} → ${sizeAfter}`);
  console.log(`[compact] Rows: ${parseInt(countBefore).toLocaleString()} → ${parseInt(countAfter).toLocaleString()}`);

  await client.end();
}

main().catch((err) => {
  console.error(`[compact] fatal: ${err instanceof Error ? err.stack : err}`);
  process.exit(1);
});
