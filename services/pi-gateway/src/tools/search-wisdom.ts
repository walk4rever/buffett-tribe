import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { pool } from "../db.js";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY env var is required");

async function getEmbedding(text: string): Promise<number[]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({ model: "text-embedding-3-large", input: text.slice(0, 8000), dimensions: 1536 }),
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`OpenAI embedding ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { data: { embedding: number[] }[] };
  return data.data[0].embedding;
}

type WisdomRow = {
  chunk_text: string;
  title: string | null;
  slug: string;
  frontmatter: Record<string, unknown>;
  score: number;
};

async function vectorSearch(embedding: number[], master: string | null, limit: number): Promise<WisdomRow[]> {
  // Embed as a literal: pg's extended query protocol doesn't support ::vector cast for user-defined types.
  // The embedding comes from OpenAI (not user input) so interpolation is safe.
  const embLiteral = `'[${embedding.join(",")}]'::vector`;
  const result = await pool.query<WisdomRow>(
    `
    SELECT
      cc.chunk_text,
      p.title,
      p.slug,
      p.frontmatter,
      1 - (cc.embedding <=> ${embLiteral}) AS score
    FROM content_chunks cc
    JOIN pages p ON p.id = cc.page_id
    WHERE cc.embedding IS NOT NULL
      AND p.deleted_at IS NULL
      AND ($1::text IS NULL OR p.frontmatter->>'master' = $1)
    ORDER BY cc.embedding <=> ${embLiteral}
    LIMIT $2
    `,
    [master ?? null, limit],
  );
  return result.rows.filter((r) => r.score >= 0.3);
}

function formatChunks(chunks: WisdomRow[]): string {
  if (chunks.length === 0) return "No relevant passages found in the wisdom library.";
  return chunks
    .map((c) => {
      const fm = c.frontmatter ?? {};
      const master = fm["master"] as string | undefined;
      const year = fm["year"] as string | number | undefined;
      const label = [master, year, c.title].filter(Boolean).join(" · ");
      return `[${label}]\n${c.chunk_text.trim()}`;
    })
    .join("\n\n---\n\n");
}

export const searchWisdomTool = defineTool({
  name: "search_wisdom",
  label: "Search Wisdom Library",
  description:
    "Search the master investors' knowledge library — annual meeting transcripts, PDFs, and key documents. Use this to find what Buffett, Munger, Li Lu, or Duan Yongping said on any topic.",
  promptSnippet: "search_wisdom(query, master?) → relevant passages from master investor documents",
  parameters: Type.Object({
    query: Type.String({ description: "Topic or question to search for" }),
    master: Type.Optional(
      Type.String({
        description: "Filter by master: buffett | munger | lilu | duanyongping",
      }),
    ),
  }),
  async execute(_toolCallId, params, signal) {
    const { query, master } = params;

    let embedding: number[];
    try {
      embedding = await getEmbedding(query);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: `Embedding failed: ${msg}` }], details: null };
    }

    if (signal?.aborted) {
      return { content: [{ type: "text" as const, text: "Search cancelled." }], details: null };
    }

    let chunks: WisdomRow[];
    try {
      chunks = await vectorSearch(embedding, master ?? null, 6);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: `Search failed: ${msg}` }], details: null };
    }

    return { content: [{ type: "text" as const, text: formatChunks(chunks) }], details: { count: chunks.length } };
  },
});
