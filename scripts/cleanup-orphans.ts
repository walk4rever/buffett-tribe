import * as fs from "fs";
import * as path from "path";
import prisma from "../src/lib/prisma";
import { buildInsightImportData } from "./lib/insight-import";

// Mapping from file prefix to database source
const SOURCE_MAP: Record<string, string> = {
  CI: "Invest Like the Best",
  CB: "Business Breakdowns",
  AQ: "Acquired",
  CF: "Founders",
};

async function main() {
  const vaultDir = "/Users/rafael/R129/Vault/Podcasts";
  if (!fs.existsSync(vaultDir)) {
    throw new Error(`Vault folder not found: ${vaultDir}`);
  }

  // 1. Scan the local folder for all active Chinese translated files and calculate their slugs
  const files = fs.readdirSync(vaultDir);
  const activeSlugs = new Set<string>();

  console.log("[cleanup-orphans] Scanning local podcasts folder...");
  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    
    // Check if it's one of our podcast prefixes
    const prefix = file.substring(0, 2);
    if (!SOURCE_MAP[prefix]) continue;

    // Check if it contains Chinese characters (meaning it's the translated version)
    if (!/[\u4e00-\u9fff]/.test(file)) continue;

    const filePath = path.join(vaultDir, file);
    try {
      const rawContent = fs.readFileSync(filePath, "utf8");
      // Use the helper to parse data exactly how it is imported
      const mockArgs = {
        filePath,
        dryRun: true,
        status: "published" as const,
        format: "markdown" as const,
      };
      const data = buildInsightImportData(rawContent, mockArgs);
      activeSlugs.add(data.slug);
    } catch (e) {
      console.warn(`[cleanup-orphans] Warning: Failed to parse slug for file ${file}:`, e);
    }
  }

  console.log(`[cleanup-orphans] Found ${activeSlugs.size} active slugs locally.`);

  // 2. Fetch all insight posts in the DB from these sources
  const sources = Object.values(SOURCE_MAP);
  const dbPosts = await prisma.insightPost.findMany({
    where: {
      source: { in: sources },
    },
    select: {
      id: true,
      slug: true,
      title: true,
      source: true,
    },
  });

  console.log(`[cleanup-orphans] Found ${dbPosts.length} posts in the database from podcast sources.`);

  // 3. Identify orphans
  const orphans = dbPosts.filter(post => !activeSlugs.has(post.slug));

  if (orphans.length === 0) {
    console.log("[cleanup-orphans] Success: No orphaned posts found in the database!");
    return;
  }

  console.log(`[cleanup-orphans] Found ${orphans.length} orphaned records to delete:`);
  for (const orphan of orphans) {
    console.log(`  - [${orphan.source}] Slug: ${orphan.slug} | Title: "${orphan.title}"`);
  }

  // 4. Perform deletion
  const isDryRun = process.argv.includes("--dry-run");
  if (isDryRun) {
    console.log("[cleanup-orphans] --dry-run specified. Skipping deletion.");
    return;
  }

  console.log(`[cleanup-orphans] Deleting ${orphans.length} records from database...`);
  const deleteResult = await prisma.insightPost.deleteMany({
    where: {
      id: { in: orphans.map(o => o.id) },
    },
  });

  console.log(`[cleanup-orphans] Success: Deleted ${deleteResult.count} orphaned records.`);
}

main()
  .catch((err) => {
    console.error("[cleanup-orphans] Fatal error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
