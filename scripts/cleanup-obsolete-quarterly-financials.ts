/**
 * scripts/cleanup-obsolete-quarterly-financials.ts
 *
 * Controlled cleanup script for obsolete historical quarterly financial records
 * (Step 4.2 of fix.md).
 *
 * Retains:
 *   1. All `periodType = 'FY'` annual financial records.
 *   2. For entities with `FY` records: only interim records (`periodType <> 'FY'`)
 *      where `periodEnd > max_fy_date`.
 *   3. For recent IPO entities without any `FY` records: only interim records from
 *      their latest reported fiscal year.
 *
 * Usage:
 *   npx tsx scripts/cleanup-obsolete-quarterly-financials.ts --dry-run
 *   npx tsx scripts/cleanup-obsolete-quarterly-financials.ts --execute
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import db from "../src/lib/prisma";

const BATCH_SIZE = 50_000;

async function main() {
  const execute = process.argv.includes("--execute");
  const mode = execute ? "EXECUTE" : "DRY-RUN";
  console.log(`=== Obsolete Quarterly Financials Cleanup [${mode}] ===`);

  // 1. Preview counts before cleanup
  const summaryBefore = await db.$queryRaw<
    Array<{ period_group: string; row_count: bigint; entity_count: bigint }>
  >`
    WITH fy_max AS (
      SELECT "entityId", MAX("periodEnd") AS max_fy_date
      FROM "Financial"
      WHERE "periodType" = 'FY'
      GROUP BY "entityId"
    )
    SELECT
      CASE
        WHEN f."periodType" = 'FY' THEN '1_FY_retained'
        WHEN fy.max_fy_date IS NOT NULL AND f."periodEnd" <= fy.max_fy_date THEN '2_obsolete_interim_to_delete'
        WHEN fy.max_fy_date IS NOT NULL AND f."periodEnd" > fy.max_fy_date THEN '3_latest_unclosed_interim_retained'
        ELSE '4_no_fy_ipo_interim'
      END AS period_group,
      COUNT(*)::bigint AS row_count,
      COUNT(DISTINCT f."entityId")::bigint AS entity_count
    FROM "Financial" f
    LEFT JOIN fy_max fy ON f."entityId" = fy."entityId"
    GROUP BY 1
    ORDER BY 1
  `;

  console.log("\nCurrent Financial table distribution:");
  for (const row of summaryBefore) {
    console.log(
      `  ${row.period_group.padEnd(36)}: ${Number(row.row_count).toLocaleString().padStart(12)} rows across ${Number(row.entity_count).toLocaleString()} entities`,
    );
  }

  if (!execute) {
    console.log("\nDry-run complete. Re-run with --execute to delete obsolete historical interim rows.");
    await db.$disconnect();
    return;
  }

  console.log(`\nStarting batched deletion (batch size = ${BATCH_SIZE.toLocaleString()})...`);
  let totalDeleted = 0;
  let batchNum = 0;

  while (true) {
    batchNum++;
    const t0 = Date.now();
    const deletedCount = await db.$executeRawUnsafe(`
      WITH fy_max AS (
        SELECT "entityId", MAX("periodEnd") AS max_fy_date
        FROM "Financial"
        WHERE "periodType" = 'FY'
        GROUP BY "entityId"
      ),
      target_ids AS (
        SELECT f.id
        FROM "Financial" f
        JOIN fy_max fy ON f."entityId" = fy."entityId"
        WHERE f."periodType" <> 'FY'
          AND f."periodEnd" <= fy.max_fy_date
        LIMIT ${BATCH_SIZE}
      )
      DELETE FROM "Financial"
      WHERE id IN (SELECT id FROM target_ids)
    `);

    totalDeleted += Number(deletedCount);
    const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(
      `  Batch #${batchNum}: deleted ${Number(deletedCount).toLocaleString()} rows (${elapsedSec}s) | cumulative = ${totalDeleted.toLocaleString()}`,
    );

    if (Number(deletedCount) < BATCH_SIZE) {
      break;
    }
  }

  // Also clean up any older fiscal years' interim rows for entities without FY records (keep only latest reported fiscal year)
  const ipoOldDeleted = await db.$executeRawUnsafe(`
    WITH fy_entities AS (
      SELECT DISTINCT "entityId" FROM "Financial" WHERE "periodType" = 'FY'
    ),
    ipo_max_year AS (
      SELECT f."entityId",
             MAX(COALESCE(s."periodYear", EXTRACT(YEAR FROM f."periodEnd")::int)) AS max_yr
      FROM "Financial" f
      LEFT JOIN "ExtSource" s ON f."sourceId" = s.id
      WHERE f."entityId" NOT IN (SELECT "entityId" FROM fy_entities)
      GROUP BY f."entityId"
    ),
    target_ipo_ids AS (
      SELECT f.id
      FROM "Financial" f
      JOIN ipo_max_year m ON f."entityId" = m."entityId"
      LEFT JOIN "ExtSource" s ON f."sourceId" = s.id
      WHERE f."periodType" <> 'FY'
        AND COALESCE(s."periodYear", EXTRACT(YEAR FROM f."periodEnd")::int) < m.max_yr
    )
    DELETE FROM "Financial"
    WHERE id IN (SELECT id FROM target_ipo_ids)
  `);
  if (Number(ipoOldDeleted) > 0) {
    totalDeleted += Number(ipoOldDeleted);
    console.log(`  Deleted ${Number(ipoOldDeleted).toLocaleString()} older-year interim rows for non-FY entities.`);
  }

  console.log(`\nTotal obsolete interim rows deleted: ${totalDeleted.toLocaleString()}`);

  const summaryAfter = await db.$queryRaw<
    Array<{ period_type: string; row_count: bigint; entity_count: bigint }>
  >`
    SELECT "periodType" AS period_type,
           COUNT(*)::bigint AS row_count,
           COUNT(DISTINCT "entityId")::bigint AS entity_count
    FROM "Financial"
    GROUP BY "periodType"
    ORDER BY row_count DESC
  `;

  console.log("\nPost-cleanup Financial table distribution by periodType:");
  for (const row of summaryAfter) {
    console.log(
      `  ${row.period_type.padEnd(12)}: ${Number(row.row_count).toLocaleString().padStart(12)} rows across ${Number(row.entity_count).toLocaleString()} entities`,
    );
  }

  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
