import * as fs from "fs";
import prisma from "../src/lib/prisma";
import {
  buildInsightImportData,
  getInsightImportUsage,
  parseInsightImportArgs,
} from "./lib/insight-import";

async function main() {
  const args = parseInsightImportArgs(process.argv.slice(2));
  console.log(`[import-insight] Reading file: ${args.filePath}`);

  if (!fs.existsSync(args.filePath)) {
    throw new Error(`File not found: ${args.filePath}`);
  }

  const rawContent = fs.readFileSync(args.filePath, "utf8");
  const data = buildInsightImportData(rawContent, args);

  console.log(`[import-insight] Title: ${data.title}`);
  console.log(`[import-insight] Slug: ${data.slug}`);
  console.log(`[import-insight] Status: ${data.status}`);
  if (data.publishedAt) console.log(`[import-insight] Published: ${data.publishedAt.toISOString().slice(0, 10)}`);
  if (data.source) console.log(`[import-insight] Source: ${data.source}`);
  if (data.sourceUrl) console.log(`[import-insight] Source URL: ${data.sourceUrl}`);
  if (data.tags.length > 0) console.log(`[import-insight] Tags: ${data.tags.join(", ")}`);

  if (args.dryRun) {
    console.log("[import-insight] --dry-run: no database changes.");
    return;
  }

  console.log("[import-insight] Upserting to database...");
  const post = await prisma.insightPost.upsert({
    where: data.externalId ? { externalId: data.externalId } : { slug: data.slug },
    create: data,
    update: data,
    select: {
      id: true,
      slug: true,
      title: true,
      status: true,
      updatedAt: true,
    },
  });

  console.log(`[import-insight] Success: ${post.id}`);
  console.log(`[import-insight] URL: /insights/${post.slug}`);
}

main()
  .catch((err) => {
    console.error("[import-insight] Fatal error:", err instanceof Error ? err.message : err);
    console.error(getInsightImportUsage());
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
