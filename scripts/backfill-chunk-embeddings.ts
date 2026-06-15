/**
 * Backfill embeddings for Chunks that are missing them.
 * Uses the same volcengine doubao-embedding-large API as import-markdown.ts.
 *
 * Usage:
 *   tsx scripts/backfill-chunk-embeddings.ts            # dry-run
 *   tsx scripts/backfill-chunk-embeddings.ts --apply    # embed + persist
 *   tsx scripts/backfill-chunk-embeddings.ts --limit 20 # cap batch size
 */

import prisma from "../src/lib/prisma";

const DRY_RUN = !process.argv.includes("--apply");
const LIMIT = (() => {
  const idx = process.argv.indexOf("--limit");
  const n = idx !== -1 ? parseInt(process.argv[idx + 1], 10) : 0;
  return !isNaN(n) && n > 0 ? n : 0;
})();

const EMBEDDING_API_KEY = process.env.EMBEDDING_API_KEY || process.env.AI_API_KEY!;
const EMBEDDING_API_BASE_URL = process.env.EMBEDDING_API_BASE_URL || process.env.AI_API_BASE_URL!;
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "doubao-embedding-large";

async function getEmbedding(text: string): Promise<number[]> {
  const res = await fetch(`${EMBEDDING_API_BASE_URL}/embeddings/multimodal`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${EMBEDDING_API_KEY}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: [{ type: "text", text: text.slice(0, 4000) }],
      dimensions: 1024,
      encoding_format: "float",
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Embedding API ${res.status}: ${errText}`);
  }

  const data = await res.json();
  return data.data.embedding as number[];
}

async function main() {
  if (DRY_RUN) console.log("[backfill-embeddings] dry-run mode (pass --apply to persist)");

  const cap = LIMIT > 0 ? LIMIT : 10000;
  const missing = await prisma.$queryRaw<{ id: string; contentZh: string | null; contentEn: string }[]>`
    SELECT id, "contentZh", "contentEn"
    FROM "Chunk"
    WHERE embedding IS NULL AND "skipEmbedding" = false
    ORDER BY "createdAt" ASC
    LIMIT ${cap}
  `;

  console.log(`[backfill-embeddings] ${missing.length} chunks to embed${LIMIT > 0 ? ` (limit ${LIMIT})` : ""}`);
  if (DRY_RUN || missing.length === 0) {
    await prisma.$disconnect();
    return;
  }

  let ok = 0;
  let fail = 0;
  for (const chunk of missing) {
    const text = chunk.contentZh || chunk.contentEn;
    try {
      const embedding = await getEmbedding(text);
      await prisma.$executeRaw`
        UPDATE "Chunk"
        SET embedding = ${JSON.stringify(embedding)}::vector,
            "updatedAt" = NOW()
        WHERE id = ${chunk.id}
      `;
      ok++;
      if (ok % 10 === 0) console.log(`  [${ok}/${missing.length}] done`);
      await new Promise((r) => setTimeout(r, 100));
    } catch (err) {
      console.error(`  [fail] chunk ${chunk.id}: ${err}`);
      fail++;
    }
  }

  console.log(`[backfill-embeddings] done: ${ok} embedded, ${fail} failed`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[backfill-embeddings] fatal", err);
  await prisma.$disconnect();
  process.exit(1);
});
