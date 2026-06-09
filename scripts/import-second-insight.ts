import * as fs from "fs";
import prisma from "../src/lib/prisma";
import { parseInsightFrontmatter, normalizeInsightSlug } from "../src/lib/insights";

async function main() {
  const filePath = "/Users/rafael/R129/Vault/Podcasts/CI002 积极资产管理 (Michael Mauboussin).md";
  console.log(`[import-second-insight] Reading file from: ${filePath}`);

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const rawContent = fs.readFileSync(filePath, "utf8");
  const { content, metadata } = parseInsightFrontmatter(rawContent);

  const title = metadata.title || "积极资产管理 (Michael Mauboussin)";
  const slug = normalizeInsightSlug(title);

  console.log(`[import-second-insight] Title: ${title}`);
  console.log(`[import-second-insight] Slug: ${slug}`);

  const publishedAt = metadata.date ? new Date(metadata.date) : new Date("2016-09-20");

  const data = {
    slug,
    title,
    description: metadata.description || null,
    source: "Invest Like the Best",
    sourceUrl: metadata.sourceUrl || metadata.source || null,
    author: metadata.author || "Colossus",
    publishedAt,
    tags: metadata.tags || [],
    format: "markdown",
    contentRaw: content,
    status: "published",
  };

  console.log(`[import-second-insight] Upserting to database...`);
  const post = await prisma.insightPost.upsert({
    where: { slug },
    create: data,
    update: data,
  });

  console.log(`[import-second-insight] Success! Created/Updated post ID: ${post.id}`);
}

main()
  .catch((err) => {
    console.error("[import-second-insight] Fatal error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
