/**
 * cleanup-financial-facts.ts
 *
 * Reduces FinancialFact table from ~1M rows to ~115K by keeping only
 * essential financial statement concepts. Also clears rawFactJson /
 * rawContextJson to free JSON storage, and clears FilingSection large-text
 * fields that already have R2 artifact backups.
 *
 * Estimated savings: ~1.1 GB → ~360 MB (well below 500 MB free plan limit)
 *
 * Usage:
 *   npm run cleanup:financial-facts
 *   npm run cleanup:financial-facts -- --dry-run     # estimate only, no writes
 *   npm run cleanup:financial-facts -- --batch-size 30000
 *   npm run cleanup:financial-facts -- --step json   # only clear JSON fields
 *   npm run cleanup:financial-facts -- --step section # only clean FilingSection
 */

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

// ---------------------------------------------------------------------------
// Whitelist: essential concepts for value-investing financial analysis
// (income statement + balance sheet + cash flow statement key lines)
// ---------------------------------------------------------------------------
const KEEP_CONCEPTS = [
  // Income Statement
  "Revenues",
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "GrossProfit",
  "OperatingIncomeLoss",
  "InterestExpense",
  "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
  "IncomeTaxExpenseBenefit",
  "NetIncomeLoss",
  "ProfitLoss",
  "ComprehensiveIncomeNetOfTax",
  // EPS & Shares
  "EarningsPerShareBasic",
  "EarningsPerShareDiluted",
  "WeightedAverageNumberOfSharesOutstandingBasic",
  "WeightedAverageNumberOfDilutedSharesOutstanding",
  "CommonStockDividendsPerShareDeclared",
  // Balance Sheet
  "Assets",
  "Liabilities",
  "LiabilitiesAndStockholdersEquity",
  "CashAndCashEquivalentsAtCarryingValue",
  "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
  "PropertyPlantAndEquipmentNet",
  "Goodwill",
  "RetainedEarningsAccumulatedDeficit",
  "StockholdersEquity",
  "AccumulatedOtherComprehensiveIncomeLossNetOfTax",
  // Cash Flow Statement
  "NetCashProvidedByUsedInOperatingActivities",
  "NetCashProvidedByUsedInInvestingActivities",
  "NetCashProvidedByUsedInFinancingActivities",
  "PaymentsToAcquirePropertyPlantAndEquipment",
  "PaymentsForRepurchaseOfCommonStock",
  // FCF Adjustments
  "ShareBasedCompensation",
  "AllocatedShareBasedCompensationExpense",
  "AmortizationOfIntangibleAssets",
  "DeferredIncomeTaxExpenseBenefit",
];

type Args = {
  dryRun: boolean;
  batchSize: number;
  step: "all" | "delete" | "json" | "section";
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const batchIdx = argv.indexOf("--batch-size");
  const batchSize = batchIdx !== -1 ? parseInt(argv[batchIdx + 1], 10) : 50000;
  const stepIdx = argv.indexOf("--step");
  const step = (stepIdx !== -1 ? argv[stepIdx + 1] : "all") as Args["step"];
  return { dryRun, batchSize, step };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function estimateSizes() {
  const result = await db.$queryRaw<
    { table_name: string; total_size: string }[]
  >`
    SELECT relname AS table_name,
           pg_size_pretty(pg_total_relation_size(relid)) AS total_size
    FROM pg_catalog.pg_statio_user_tables
    WHERE relname IN ('FinancialFact', 'FilingSection')
    ORDER BY pg_total_relation_size(relid) DESC
  `;
  return result;
}

async function stepDeleteNonWhitelist(args: Args) {
  console.log("\n[cleanup] === STEP 1: Delete non-whitelist FinancialFact rows ===");

  const totalBefore = await db.financialFact.count();
  const toKeep = await db.financialFact.count({
    where: { concept: { in: KEEP_CONCEPTS } },
  });
  const toDelete = totalBefore - toKeep;

  console.log(`[cleanup] Total rows:    ${totalBefore.toLocaleString()}`);
  console.log(`[cleanup] Rows to keep:  ${toKeep.toLocaleString()} (${((toKeep / totalBefore) * 100).toFixed(1)}%)`);
  console.log(`[cleanup] Rows to delete: ${toDelete.toLocaleString()} (${((toDelete / totalBefore) * 100).toFixed(1)}%)`);

  if (args.dryRun) {
    console.log("[cleanup] --dry-run: skipping delete.");
    return;
  }

  let batch = 0;
  let totalDeleted = 0;

  // Build the concept whitelist as a SQL literal (safe — values are hardcoded in source)
  const conceptList = KEEP_CONCEPTS.map((c) => `'${c}'`).join(", ");

  while (true) {
    batch++;
    console.log(`[cleanup] Batch ${batch}: deleting up to ${args.batchSize.toLocaleString()} rows...`);

    // Use a CTE subquery — avoids the 32767 Postgres bind-variable limit
    const deleted = await db.$executeRawUnsafe(`
      WITH batch AS (
        SELECT id FROM "FinancialFact"
        WHERE concept NOT IN (${conceptList})
        LIMIT ${args.batchSize}
      )
      DELETE FROM "FinancialFact" WHERE id IN (SELECT id FROM batch)
    `);

    totalDeleted += deleted;
    console.log(`[cleanup] Batch ${batch}: deleted ${deleted.toLocaleString()} rows (total deleted: ${totalDeleted.toLocaleString()})`);

    if (deleted === 0) {
      console.log("[cleanup] No more rows to delete. Done.");
      break;
    }

    // Small pause to avoid overwhelming the DB
    await sleep(500);
  }

  const totalAfter = await db.financialFact.count();
  console.log(`[cleanup] FinancialFact rows after delete: ${totalAfter.toLocaleString()}`);
}

async function stepClearJsonFields(args: Args) {
  console.log("\n[cleanup] === STEP 2: Clear rawFactJson + rawContextJson ===");

  const count = await db.financialFact.count();
  console.log(`[cleanup] Rows to update: ${count.toLocaleString()}`);

  if (args.dryRun) {
    console.log("[cleanup] --dry-run: skipping update.");
    return;
  }

  console.log("[cleanup] Clearing JSON fields (may take a moment)...");
  const result = await db.$executeRaw`
    UPDATE "FinancialFact"
    SET "rawFactJson" = '{}'::json,
        "rawContextJson" = '{}'::json
  `;
  console.log(`[cleanup] Updated ${result} rows.`);
}

async function stepCleanFilingSection(args: Args) {
  console.log("\n[cleanup] === STEP 3: Clean FilingSection large-text fields (aggressive) ===");
  console.log("[cleanup] Strategy: full-text content → preview only (will be served from R2/SEC)");

  const totalRows = await db.$queryRaw<{ cnt: bigint }[]>`
    SELECT COUNT(*) AS cnt FROM "FilingSection"
  `;
  const rawHtmlRows = await db.$queryRaw<{ cnt: bigint }[]>`
    SELECT COUNT(*) AS cnt FROM "FilingSection" WHERE "rawHtml" IS NOT NULL
  `;
  const longContentRows = await db.$queryRaw<{ cnt: bigint }[]>`
    SELECT COUNT(*) AS cnt FROM "FilingSection" WHERE LENGTH("content") > 500
  `;

  console.log(`[cleanup] FilingSection total rows:        ${totalRows[0].cnt}`);
  console.log(`[cleanup] Rows with rawHtml to clear:      ${rawHtmlRows[0].cnt}`);
  console.log(`[cleanup] Rows with content > 500 chars:   ${longContentRows[0].cnt}`);

  if (args.dryRun) {
    console.log("[cleanup] --dry-run: skipping updates.");
    return;
  }

  // Clear rawHtml for ALL rows (nullable field — full HTML no longer stored in DB)
  console.log("[cleanup] Clearing rawHtml for ALL rows...");
  const htmlResult = await db.$executeRaw`
    UPDATE "FilingSection"
    SET "rawHtml" = NULL
    WHERE "rawHtml" IS NOT NULL
  `;
  console.log(`[cleanup] Cleared rawHtml for ${htmlResult} rows.`);

  // Truncate content to preview for ALL rows (full text served from R2/SEC)
  console.log("[cleanup] Truncating content to preview for ALL rows...");
  const contentResult = await db.$executeRaw`
    UPDATE "FilingSection"
    SET "content" = COALESCE("contentPreview", LEFT("content", 500))
    WHERE LENGTH("content") > 500
  `;
  console.log(`[cleanup] Truncated content for ${contentResult} rows.`);
}

async function main() {
  const args = parseArgs();
  console.log("[cleanup] Starting FinancialFact + FilingSection cleanup");
  console.log(`[cleanup] dry-run=${args.dryRun} batchSize=${args.batchSize} step=${args.step}`);

  // Show current sizes
  const sizesBefore = await estimateSizes();
  console.log("\n[cleanup] Current table sizes:");
  for (const row of sizesBefore) {
    console.log(`  ${row.table_name}: ${row.total_size}`);
  }

  if (args.step === "all" || args.step === "delete") {
    await stepDeleteNonWhitelist(args);
  }
  if (args.step === "all" || args.step === "json") {
    await stepClearJsonFields(args);
  }
  if (args.step === "all" || args.step === "section") {
    await stepCleanFilingSection(args);
  }

  if (!args.dryRun) {
    console.log("\n[cleanup] ✅ Done! Next step: run VACUUM FULL in Supabase SQL Editor:");
    console.log('  VACUUM FULL "FinancialFact";');
    console.log('  VACUUM FULL "FilingSection";');
    console.log("\n[cleanup] ⚠️  VACUUM FULL locks the table during execution (5–15 min).");
    console.log("[cleanup] Run during low-traffic hours.");
  } else {
    console.log("\n[cleanup] --dry-run complete. Re-run without --dry-run to execute.");
  }
}

main()
  .catch((err) => {
    const msg = err instanceof Error ? err.stack ?? err.message : String(err);
    console.error(`[cleanup] fatal: ${msg}`);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
