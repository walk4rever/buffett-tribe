/**
 * Clean up database to reduce storage usage
 *
 * Phase 1: Conservative cleanup
 * - Delete section_text artifacts (replaced by FilingSection)
 * - Delete CN/HK primary_pdf artifacts (will use external links)
 * - Archive old StockPrice data (keep only 5 years)
 *
 * Usage:
 *   npx tsx scripts/cleanup-database-phase1.ts [--dry-run]
 */

import prisma from "../src/lib/prisma";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  console.log("=== Database Cleanup Phase 1 ===");
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}\n`);

  // 1. Delete section_text artifacts (replaced by FilingSection)
  console.log("Step 1: Checking section_text artifacts...");
  const sectionTextCount = await prisma.filingArtifact.count({
    where: { kind: "section_text" },
  });
  console.log(`  Found: ${sectionTextCount} section_text artifacts`);

  if (!DRY_RUN && sectionTextCount > 0) {
    const deleted1 = await prisma.filingArtifact.deleteMany({
      where: { kind: "section_text" },
    });
    console.log(`  ✓ Deleted: ${deleted1.count} artifacts\n`);
  } else {
    console.log(`  [DRY RUN] Would delete: ${sectionTextCount} artifacts\n`);
  }

  // 2. Delete CN/HK primary_pdf artifacts
  console.log("Step 2: Checking CN/HK primary_pdf artifacts...");
  const cnhkPdfCount = await prisma.filingArtifact.count({
    where: {
      kind: "primary_pdf",
      source: {
        kind: {
          in: ["cn-annual-report", "cn-interim-report", "cn-prospectus",
               "hk-annual-report", "hk-interim-report"],
        },
      },
    },
  });
  console.log(`  Found: ${cnhkPdfCount} CN/HK PDF artifacts`);

  if (!DRY_RUN && cnhkPdfCount > 0) {
    const deleted2 = await prisma.filingArtifact.deleteMany({
      where: {
        kind: "primary_pdf",
        source: {
          kind: {
            in: ["cn-annual-report", "cn-interim-report", "cn-prospectus",
                 "hk-annual-report", "hk-interim-report"],
          },
        },
      },
    });
    console.log(`  ✓ Deleted: ${deleted2.count} PDF artifacts\n`);
  } else {
    console.log(`  [DRY RUN] Would delete: ${cnhkPdfCount} PDF artifacts\n`);
  }

  // 3. Archive old StockPrice data (keep from 2020-01-01 onwards)
  console.log("Step 3: Checking old StockPrice data...");
  const cutoffDate = new Date("2020-01-01");

  const oldPriceCount = await prisma.stockPrice.count({
    where: { date: { lt: cutoffDate } },
  });
  console.log(`  Found: ${oldPriceCount} prices older than 2020-01-01`);

  if (!DRY_RUN && oldPriceCount > 0) {
    const deleted3 = await prisma.stockPrice.deleteMany({
      where: { date: { lt: cutoffDate } },
    });
    console.log(`  ✓ Deleted: ${deleted3.count} old prices\n`);
  } else {
    console.log(`  [DRY RUN] Would delete: ${oldPriceCount} old prices\n`);
  }

  // Summary
  console.log("=== Summary ===");
  if (DRY_RUN) {
    console.log("Total items that would be deleted:");
    console.log(`  - section_text artifacts: ${sectionTextCount}`);
    console.log(`  - CN/HK PDF artifacts: ${cnhkPdfCount}`);
    console.log(`  - Old stock prices: ${oldPriceCount}`);
    console.log(`  - Total: ${sectionTextCount + cnhkPdfCount + oldPriceCount}`);
    console.log("\nRun without --dry-run to actually delete");
  } else {
    console.log("Cleanup completed!");
    console.log("Database should now be smaller. Check Supabase dashboard for updated size.");
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Error during cleanup:", err);
  process.exit(1);
});
