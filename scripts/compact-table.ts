/**
 * compact-table.ts
 *
 * Generic TRUNCATE + re-insert compaction for any table.
 * Use when VACUUM FULL is blocked by Supabase's Supavisor pooler.
 *
 * Usage:
 *   npm run compact:table -- --table FilingSection
 *   npm run compact:table -- --table FilingSection --dry-run
 */

import { Client } from "pg";

// PostgreSQL hard limit: 65535 bind parameters per query.
const MAX_PARAMS = 60000;

type Row = Record<string, unknown>;

function parseArgs() {
  const argv = process.argv.slice(2);
  const tableIdx = argv.indexOf("--table");
  const table = tableIdx !== -1 ? argv[tableIdx + 1] : null;
  const dryRun = argv.includes("--dry-run");
  if (!table) throw new Error("--table <TableName> is required");
  return { table, dryRun };
}

async function getTableSize(client: Client, table: string): Promise<string> {
  const res = await client.query<{ size: string }>(
    `SELECT pg_size_pretty(pg_total_relation_size('"${table}"')) AS size`
  );
  return res.rows[0].size;
}

async function main() {
  const { table, dryRun } = parseArgs();
  console.log(`[compact] Table: "${table}" | dry-run=${dryRun}`);

  const client = new Client({ connectionString: process.env.DIRECT_URL, query_timeout: 0 });
  await client.connect();

  // Override Supabase server-side statement_timeout (default 30s on free plan)
  await client.query("SET statement_timeout = 0");
  await client.query("SET lock_timeout = 0");
  console.log("[compact] Connected. Timeouts disabled.");

  // ── Step 0: Current state ────────────────────────────────────────────────
  const sizeBefore = await getTableSize(client, table);
  const countRes = await client.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM "${table}"`
  );
  const rowCount = parseInt(countRes.rows[0].count, 10);
  console.log(`[compact] Current size: ${sizeBefore}`);
  console.log(`[compact] Live rows:    ${rowCount.toLocaleString()}`);

  if (rowCount === 0) {
    console.log("[compact] Table is already empty. Nothing to compact.");
    await client.end();
    return;
  }

  if (dryRun) {
    console.log("[compact] --dry-run: would TRUNCATE and re-insert. Exiting.");
    await client.end();
    return;
  }

  // ── Step 1: Load all rows ────────────────────────────────────────────────
  console.log(`\n[compact] Loading ${rowCount.toLocaleString()} rows...`);
  const loadStart = Date.now();
  const allRows = await client.query<Row>(`SELECT * FROM "${table}"`);
  const rows = allRows.rows;
  const columns = allRows.fields.map((f) => f.name);
  console.log(`[compact] Loaded in ${Date.now() - loadStart}ms. Columns (${columns.length}): ${columns.join(", ")}`);

  // ── Step 2: TRUNCATE ─────────────────────────────────────────────────────
  console.log(`\n[compact] TRUNCATING "${table}"...`);
  await client.query(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE`);
  const sizeAfterTruncate = await getTableSize(client, table);
  console.log(`[compact] ✅ TRUNCATE done. Size: ${sizeAfterTruncate}`);

  // ── Step 3: Re-insert ────────────────────────────────────────────────────
  const BATCH_SIZE = Math.floor(MAX_PARAMS / columns.length);
  const colList = columns.map((c) => `"${c}"`).join(", ");
  let inserted = 0;
  const insertStart = Date.now();

  console.log(`\n[compact] Re-inserting ${rows.length.toLocaleString()} rows (${BATCH_SIZE} rows/batch)...`);

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    const valuePlaceholders = batch.map((_, rowIdx) => {
      const params = columns.map((_, colIdx) => `$${rowIdx * columns.length + colIdx + 1}`);
      return `(${params.join(", ")})`;
    });
    const values = batch.flatMap((row) => columns.map((col) => row[col] ?? null));

    await client.query(
      `INSERT INTO "${table}" (${colList}) VALUES ${valuePlaceholders.join(", ")}`,
      values
    );

    inserted += batch.length;
    const pct = ((inserted / rows.length) * 100).toFixed(1);
    const elapsed = Math.round((Date.now() - insertStart) / 1000);
    console.log(`[compact] Inserted ${inserted.toLocaleString()}/${rows.length.toLocaleString()} (${pct}%) — ${elapsed}s`);
  }

  // ── Step 4: Final report ─────────────────────────────────────────────────
  const sizeAfter = await getTableSize(client, table);
  console.log(`\n[compact] ✅ Done!`);
  console.log(`[compact] Size: ${sizeBefore} → ${sizeAfter}`);
  console.log(`[compact] Rows: ${rowCount.toLocaleString()} → ${inserted.toLocaleString()}`);

  await client.end();
}

main().catch((err) => {
  console.error(`[compact] fatal: ${err instanceof Error ? err.stack : err}`);
  process.exit(1);
});
