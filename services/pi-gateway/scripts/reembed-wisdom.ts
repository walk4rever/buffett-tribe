/**
 * Re-embed GBrain's content_chunks with DashScope (search_wisdom's embedding provider).
 *
 * By default only backfills chunks with a NULL embedding — run this after any
 * `gbrain import`/`sync` job, since GBrain's own ingestion still writes via its
 * own (currently broken) embedding_model config and leaves new chunks
 * unembedded rather than mixing in a different vector space. Use --all to
 * force a full re-embed (e.g. after switching embedding models/providers).
 *
 * Usage:
 *   tsx --env-file=.env scripts/reembed-wisdom.ts            # dry-run
 *   tsx --env-file=.env scripts/reembed-wisdom.ts --apply    # embed + persist
 *   tsx --env-file=.env scripts/reembed-wisdom.ts --apply --all
 *   tsx --env-file=.env scripts/reembed-wisdom.ts --apply --limit 50
 */
import { pool } from "../src/db.js";

const DRY_RUN = !process.argv.includes("--apply");
const ALL = process.argv.includes("--all");
const LIMIT = (() => {
  const idx = process.argv.indexOf("--limit");
  const n = idx !== -1 ? parseInt(process.argv[idx + 1], 10) : 0;
  return !isNaN(n) && n > 0 ? n : 0;
})();

const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY;
const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 150;

interface ChunkRow {
  id: string;
  chunk_text: string;
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const res = await fetch("https://dashscope-intl.aliyuncs.com/compatible-mode/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${DASHSCOPE_API_KEY}` },
    body: JSON.stringify({ model: "text-embedding-v4", input: texts, dimensions: 1536 }),
  });
  if (!res.ok) throw new Error(`DashScope embedding ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { data: { index: number; embedding: number[] }[] };
  return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

async function main() {
  if (!DASHSCOPE_API_KEY) throw new Error("DASHSCOPE_API_KEY env var is required");
  if (DRY_RUN) console.log("[reembed-wisdom] dry-run mode (pass --apply to persist)");

  const where = ALL ? "" : "WHERE embedding IS NULL";
  const cap = LIMIT > 0 ? LIMIT : 10000;
  const rows = (
    await pool.query<ChunkRow>(
      `SELECT id, chunk_text FROM content_chunks ${where} ORDER BY id LIMIT $1`,
      [cap],
    )
  ).rows;

  console.log(`[reembed-wisdom] ${rows.length} chunk(s) to embed${ALL ? " (--all)" : " (missing only)"}`);
  if (DRY_RUN || rows.length === 0) {
    await pool.end();
    return;
  }

  let ok = 0;
  const failedIds: string[] = [];

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const texts = batch.map((r) => r.chunk_text.slice(0, 4000));
    try {
      const embeddings = await embedBatch(texts);
      for (let j = 0; j < batch.length; j++) {
        await pool.query(`UPDATE content_chunks SET embedding = $1::vector WHERE id = $2`, [
          `[${embeddings[j].join(",")}]`,
          batch[j].id,
        ]);
        ok++;
      }
    } catch (err) {
      console.error(`  [batch fail @ offset ${i}]`, err instanceof Error ? err.message : err);
      failedIds.push(...batch.map((r) => r.id));
    }
    if ((i / BATCH_SIZE) % 10 === 0) {
      console.log(`  [${ok}/${rows.length}] done, ${failedIds.length} failed so far`);
    }
    await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
  }

  console.log(`\n[reembed-wisdom] done: ${ok} embedded, ${failedIds.length} failed`);
  if (failedIds.length > 0) console.log("failed ids:", failedIds);

  await pool.end();
}

main().catch(async (err) => {
  console.error("[reembed-wisdom] fatal", err);
  await pool.end();
  process.exit(1);
});
