/**
 * Export Buffett shareholder + partnership letters from Supabase (Source/Chunk)
 * into GBrain-compatible markdown files with frontmatter.
 *
 * Usage:
 *   tsx scripts/export-letters-gbrain.ts
 *   tsx scripts/export-letters-gbrain.ts --out /tmp/letters_import
 */
import fs from "node:fs";
import path from "node:path";
import prisma from "../src/lib/prisma";

const OUT_DIR = process.argv.includes("--out")
  ? process.argv[process.argv.indexOf("--out") + 1]
  : "/tmp/letters_import";

function slugify(type: string, year: number, date: string | null, counter: number): string {
  const prefix = type === "partnership" ? "partner" : "shareholder";
  const suffix = date ? `_${date.replace(/\//g, "-")}` : counter > 1 ? `_${counter}` : "";
  return `buffett_${prefix}_${year}${suffix}`;
}

function buildFrontmatter(source: { type: string; year: number; title: string }): string {
  return [
    "---",
    `title: "${source.title.replace(/"/g, "'")}"`,
    `master: buffett`,
    `year: "${source.year}"`,
    `type: ${source.type}`,
    "---",
    "",
    "",
  ].join("\n");
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const sources = await prisma.source.findMany({
    orderBy: [{ type: "asc" }, { year: "asc" }],
    include: {
      chunks: {
        orderBy: { order: "asc" },
        select: { order: true, title: true, contentEn: true },
      },
    },
  });

  console.log(`Found ${sources.length} sources`);

  // Track counter per (type, year) to handle multiple letters in same year
  const counters = new Map<string, number>();

  let exported = 0;
  let skipped = 0;

  for (const source of sources) {
    const key = `${source.type}_${source.year}`;
    const counter = (counters.get(key) ?? 0) + 1;
    counters.set(key, counter);
    const validChunks = source.chunks.filter(
      (c) => c.contentEn && c.contentEn.trim().length > 0,
    );

    if (validChunks.length === 0) {
      console.warn(`  SKIP (no content): ${source.year} ${source.type}`);
      skipped++;
      continue;
    }

    const body = validChunks
      .map((c) => {
        const header = c.title ? `## ${c.title}\n\n` : "";
        return header + c.contentEn.trim();
      })
      .join("\n\n---\n\n");

    const slug = slugify(source.type, source.year, source.date ?? null, counter);
    const filename = `${slug}.md`;
    const filepath = path.join(OUT_DIR, filename);

    fs.writeFileSync(filepath, buildFrontmatter(source) + body, "utf8");
    console.log(`  ✓ ${filename} (${validChunks.length} chunks)`);
    exported++;
  }

  console.log(`\nDone: ${exported} files → ${OUT_DIR} (${skipped} skipped)`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
