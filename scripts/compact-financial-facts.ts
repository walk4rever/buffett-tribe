/**
 * compact-financial-facts.ts
 *
 * TRUNCATE + re-insert approach to physically compact FinancialFact.
 * VACUUM FULL is unreliable through Supabase's Supavisor pooler.
 * TRUNCATE + re-insert is guaranteed to reclaim space immediately.
 *
 * Steps:
 * 1. Load all 118K live rows into memory (~35 MB)
 * 2. TRUNCATE the table (instant, reclaims all ~787 MB)
 * 3. Re-insert the live rows in batches
 *
 * Usage:
 *   npm run compact:financial-facts
 *   npm run compact:financial-facts -- --dry-run
 */

import { Client } from "pg";
import fs from "fs";

// PostgreSQL hard limit: 65535 bind parameters per query.
// With 18 columns, max safe rows per batch = floor(65535 / 18) = 3640.
// We use 3000 to be safe.
const MAX_PARAMS = 60000;

type Row = Record<string, unknown>;

function parseArgs() {
  return { dryRun: process.argv.includes("--dry-run") };
}

async function getTableSize(client: Client, table: string): Promise<string> {
  const res = await client.query<{ size: string }>(
    `SELECT pg_size_pretty(pg_total_relation_size('"${table}"')) AS size`
  );
  return res.rows[0].size;
}

async function main() {
  const { dryRun } = parseArgs();
  console.log(`[compact] Starting FinancialFact compaction (dry-run=${dryRun})`);

  // Use Supavisor session mode (port 5432) — works for long-running ops
  const url = process.env.DIRECT_URL;
  if (!url) throw new Error("DIRECT_URL not set");

  const client = new Client({ connectionString: url, query_timeout: 0 });
  await client.connect();
  console.log("[compact] Connected.");

  // ── Step 0: Show current state ──────────────────────────────────────────
  const sizeBefore = await getTableSize(client, "FinancialFact");
  const countRes = await client.query<{ count: string }>(
    'SELECT COUNT(*) AS count FROM "FinancialFact"'
  );
  const rowCount = parseInt(countRes.rows[0].count, 10);
  console.log(`[compact] Current size: ${sizeBefore}`);
  console.log(`[compact] Live rows:    ${rowCount.toLocaleString()}`);

  if (dryRun) {
    console.log("[compact] --dry-run: would TRUNCATE and re-insert. Exiting.");
    await client.end();
    return;
  }

  // ── Step 1: Load all live rows into memory ───────────────────────────────
  console.log(`\n[compact] Loading ${rowCount.toLocaleString()} rows into memory...`);
  const loadStart = Date.now();
  const allRows = await client.query<Row>('SELECT * FROM "FinancialFact"');
  const rows = allRows.rows;
  console.log(`[compact] Loaded ${rows.length.toLocaleString()} rows in ${Date.now() - loadStart}ms`);

  if (rows.length === 0) {
    console.log("[compact] No rows found. Exiting.");
    await client.end();
    return;
  }

  // Get column names from result
  const columns = allRows.fields.map((f) => f.name);
  console.log(`[compact] Columns (${columns.length}): ${columns.join(", ")}`);

  // ── Step 2: TRUNCATE ─────────────────────────────────────────────────────
  if (rowCount > 0) {
    console.log("\n[compact] TRUNCATING FinancialFact (this reclaims all disk space)...");
    await client.query('TRUNCATE TABLE "FinancialFact" RESTART IDENTITY');
    console.log("[compact] ✅ TRUNCATE done.");

    const sizeAfterTruncate = await getTableSize(client, "FinancialFact");
    console.log(`[compact] Size after TRUNCATE: ${sizeAfterTruncate}`);
  } else {
    console.log("[compact] Table already empty (from previous TRUNCATE). Skipping TRUNCATE.");
  }

  // ── Step 3: Re-insert in batches ─────────────────────────────────────────
  const BATCH_SIZE = Math.floor(MAX_PARAMS / columns.length);
  console.log(`\n[compact] Re-inserting ${rows.length.toLocaleString()} rows...`);
  console.log(`[compact] Columns: ${columns.length}, batch size: ${BATCH_SIZE} rows (${BATCH_SIZE * columns.length} params/batch)`);

  const colList = columns.map((c) => `"${c}"`).join(", ");
  let inserted = 0;
  const insertStart = Date.now();

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    // Build parameterized INSERT for this batch
    const valuePlaceholders = batch.map((_, rowIdx) => {
      const params = columns.map((_, colIdx) => `$${rowIdx * columns.length + colIdx + 1}`);
      return `(${params.join(", ")})`;
    });

    const values = batch.flatMap((row) => columns.map((col) => row[col]));

    await client.query(
      `INSERT INTO "FinancialFact" (${colList}) VALUES ${valuePlaceholders.join(", ")}`,
      values
    );

    inserted += batch.length;
    const pct = ((inserted / rows.length) * 100).toFixed(1);
    const elapsed = Math.round((Date.now() - insertStart) / 1000);
    console.log(`[compact] Inserted ${inserted.toLocaleString()}/${rows.length.toLocaleString()} (${pct}%) — ${elapsed}s elapsed`);
  }

  // ── Step 4: Final size check ─────────────────────────────────────────────
  const sizeAfter = await getTableSize(client, "FinancialFact");
  const countAfter = await client.query<{ count: string }>(
    'SELECT COUNT(*) AS count FROM "FinancialFact"'
  );

  console.log(`\n[compact] ✅ Compaction complete!`);
  console.log(`[compact] Rows: ${rowCount.toLocaleString()} → ${countAfter.rows[0].count}`);
  console.log(`[compact] Size: ${sizeBefore} → ${sizeAfter}`);

  await client.end();
}

main().catch((err) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error(`[compact] fatal: ${msg}`);
  process.exit(1);
});
