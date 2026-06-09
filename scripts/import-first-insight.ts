import * as fs from "fs";
import prisma from "../src/lib/prisma";
import { parseInsightFrontmatter, normalizeInsightSlug } from "../src/lib/insights";

async function main() {
  const filePath = "/Users/rafael/R129/Vault/Podcasts/CI001 维权投资 (Jeff Gramm).md";
  console.log(`[import-first-insight] Reading file from: ${filePath}`);

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const rawContent = fs.readFileSync(filePath, "utf8");
  const { content, metadata } = parseInsightFrontmatter(rawContent);

  const title = metadata.title || "维权投资 (Jeff Gramm)";
  const slug = normalizeInsightSlug(title);

  console.log(`[import-first-insight] Title: ${title}`);
  console.log(`[import-first-insight] Slug: ${slug}`);

  const publishedAt = metadata.date ? new Date(metadata.date) : new Date("2016-09-12");

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

  console.log(`[import-first-insight] Upserting to database...`);
  const post = await prisma.insightPost.upsert({
    where: { slug },
    create: data,
    update: data,
  });

  console.log(`[import-first-insight] Success! Created/Updated post ID: ${post.id}`);
}

main()
  .catch((err) => {
    console.error("[import-first-insight] Fatal error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
