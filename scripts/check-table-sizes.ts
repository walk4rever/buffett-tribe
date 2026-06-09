import { Client } from "pg";

async function main() {
  const client = new Client({ connectionString: process.env.DIRECT_URL });
  await client.connect();

  const r1 = await client.query('SELECT COUNT(*) FROM "FinancialFact"');
  const r2 = await client.query(
    "SELECT n_live_tup, n_dead_tup FROM pg_stat_user_tables WHERE relname = 'FinancialFact'"
  );
  const r3 = await client.query(`
    SELECT relname AS table_name,
           pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
           pg_size_pretty(pg_relation_size(relid)) AS data_size,
           pg_size_pretty(pg_indexes_size(relid)) AS index_size
    FROM pg_catalog.pg_statio_user_tables
    WHERE relname IN ('FinancialFact', 'FilingSection')
    ORDER BY pg_total_relation_size(relid) DESC
  `);

  console.log("=== FinancialFact row count ===");
  console.log("COUNT:", r1.rows[0].count);
  console.log("live_tup:", r2.rows[0]?.n_live_tup ?? "N/A");
  console.log("dead_tup:", r2.rows[0]?.n_dead_tup ?? "N/A");

  console.log("\n=== Table sizes ===");
  for (const row of r3.rows) {
    console.log(`${row.table_name}: total=${row.total_size} data=${row.data_size} index=${row.index_size}`);
  }

  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
