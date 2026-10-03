#!/usr/bin/env tsx
/**
 * Classify existing companies (onboardPhase >= 1) using 7-way sector model logic
 * Usage:
 *   node --env-file=.env.local ./node_modules/.bin/tsx scripts/classify-existing-companies.ts
 *   node --env-file=.env.local ./node_modules/.bin/tsx scripts/classify-existing-companies.ts --dry-run
 */

import prisma from "../src/lib/prisma";
import { detectSectorModel7, SectorModelType7 } from "../src/lib/sector-classification";

const isDryRun = process.argv.includes("--dry-run");

interface EntityRow {
  id: string;
  canonicalName: string;
  ticker: string | null;
  sector: string | null;
  industry: string | null;
  nameZh: string | null;
  sectorModelType: string | null;
}

async function classifyExistingCompanies() {
  console.log(`🔍 Fetching companies with onboardPhase >= 1... ${isDryRun ? "[DRY-RUN]" : ""}`);
  const startFetch = Date.now();

  // Optimized query: extracts only industry and nameZh from JSON, reducing network payload from ~100MB to ~150KB
  const companies = await prisma.$queryRaw<EntityRow[]>`
    SELECT 
      id, 
      "canonicalName", 
      ticker, 
      sector, 
      metadata->>'industry' AS industry, 
      metadata->>'nameZh' AS "nameZh", 
      "sectorModelType"
    FROM "Entity"
    WHERE "onboardPhase" >= 1 AND type = 'company'
    ORDER BY ticker ASC NULLS LAST, id ASC;
  `;

  const totalCount = companies.length;
  console.log(`✓ Fetched ${totalCount} companies in ${Date.now() - startFetch}ms.\n`);

  const stats: Record<SectorModelType7, number> = {
    consumer_brand: 0,
    technology: 0,
    industrial: 0,
    bank_insurance: 0,
    utilities: 0,
    cyclical: 0,
    conglomerate: 0,
  };

  const sampleBySector: Record<SectorModelType7, string[]> = {
    consumer_brand: [],
    technology: [],
    industrial: [],
    bank_insurance: [],
    utilities: [],
    cyclical: [],
    conglomerate: [],
  };

  const pendingUpdates: Array<{
    id: string;
    ticker: string | null;
    name: string;
    oldType: string | null;
    newType: SectorModelType7;
    label: string;
  }> = [];

  let unchangedCount = 0;

  for (const company of companies) {
    const fullName = [company.canonicalName, company.nameZh].filter(Boolean).join(" ");
    const result = detectSectorModel7(company.sector, company.industry, fullName);
    stats[result.type]++;

    if (sampleBySector[result.type].length < 4) {
      sampleBySector[result.type].push(
        `${company.ticker || company.canonicalName.slice(0, 16)} (${company.nameZh || company.canonicalName.slice(0, 16)})`
      );
    }

    if (company.sectorModelType === result.type) {
      unchangedCount++;
    } else {
      pendingUpdates.push({
        id: company.id,
        ticker: company.ticker,
        name: company.canonicalName,
        oldType: company.sectorModelType,
        newType: result.type,
        label: result.label,
      });
    }
  }

  console.log(`Evaluation summary:`);
  console.log(`  Total: ${totalCount}`);
  console.log(`  Already matching: ${unchangedCount}`);
  console.log(`  Need update: ${pendingUpdates.length}`);

  if (isDryRun) {
    console.log("\n[DRY RUN] Showing sample of 15 updates that would be made:");
    pendingUpdates.slice(0, 15).forEach((u) => {
      const ticker = (u.ticker || u.name).padEnd(12);
      console.log(`  ${ticker} → ${u.label.padEnd(8)} (${u.newType}) [was: ${u.oldType || "null"}]`);
    });
  } else if (pendingUpdates.length > 0) {
    console.log(`\nWriting ${pendingUpdates.length} updates to database in parallel batches (concurrency: 15)...`);
    const startUpdate = Date.now();
    const CONCURRENCY = 15;
    let completed = 0;

    for (let i = 0; i < pendingUpdates.length; i += CONCURRENCY) {
      const chunk = pendingUpdates.slice(i, i + CONCURRENCY);
      await Promise.all(
        chunk.map((item) =>
          prisma.entity.update({
            where: { id: item.id },
            data: { sectorModelType: item.newType },
          })
        )
      );
      completed += chunk.length;
      if (completed % 250 === 0 || completed === pendingUpdates.length) {
        const pct = ((completed / pendingUpdates.length) * 100).toFixed(1);
        console.log(`  Progress: ${completed}/${pendingUpdates.length} (${pct}%)`);
      }
    }
    console.log(`  ✓ All ${pendingUpdates.length} updates written in ${((Date.now() - startUpdate) / 1000).toFixed(1)}s.`);
  }

  console.log("\n=======================================================");
  console.log("             7 大行业分类最终全库分布统计               ");
  console.log("=======================================================");
  Object.entries(stats)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      const pct = ((count / totalCount) * 100).toFixed(1);
      const label =
        type === "consumer_brand"
          ? "消费品牌"
          : type === "technology"
          ? "科技平台"
          : type === "cyclical"
          ? "强周期资源"
          : type === "industrial"
          ? "工业制造"
          : type === "bank_insurance"
          ? "银行保险"
          : type === "utilities"
          ? "公用事业"
          : "多元化控股";
      console.log(`${label.padEnd(8)} (${type.padEnd(16)}): ${count.toString().padStart(4)} 家 (${pct.padStart(5)}%) | 标的示例: ${sampleBySector[type as SectorModelType7].join(", ")}`);
    });
  console.log("=======================================================\n");
}

classifyExistingCompanies()
  .then(() => {
    console.log("🎉 Classification process complete!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Classification failed:", error);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });
