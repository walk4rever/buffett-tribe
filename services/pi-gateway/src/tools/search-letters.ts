import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import pg from "pg";

const { Pool } = pg;

const DIRECT_URL = process.env.DIRECT_URL;
const EMBEDDING_API_KEY = process.env.EMBEDDING_API_KEY;
const EMBEDDING_API_BASE_URL = process.env.EMBEDDING_API_BASE_URL ?? "https://ark.cn-beijing.volces.com/api/v3";
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "doubao-embedding-large";

if (!DIRECT_URL) throw new Error("DIRECT_URL env var is required");
if (!EMBEDDING_API_KEY) throw new Error("EMBEDDING_API_KEY env var is required");

// Strip sslmode/sslaccept params from the URL so the Pool's ssl option takes effect
const cleanUrl = DIRECT_URL.replace(/[?&]sslmode=[^&]*/g, "").replace(/[?&]sslaccept=[^&]*/g, "");
const pool = new Pool({ connectionString: cleanUrl, ssl: { rejectUnauthorized: false } });

const SOURCE_TYPES = ["shareholder", "partnership"];
const SOURCE_TYPES_SQL = SOURCE_TYPES.map((t) => `'${t}'`).join(", ");

async function getEmbedding(text: string): Promise<number[]> {
  const res = await fetch(`${EMBEDDING_API_BASE_URL}/embeddings/multimodal`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${EMBEDDING_API_KEY}` },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: [{ type: "text", text: text.slice(0, 4000) }],
      dimensions: 1024,
      encoding_format: "float",
    }),
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`Embedding API ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { data: { embedding: number[] } };
  return data.data.embedding;
}

type ChunkRow = {
  id: string;
  year: number;
  title: string | null;
  sourceType: string;
  contentEn: string;
  score: number;
};

async function vectorSearch(
  embedding: number[],
  yearFrom: number | null,
  yearTo: number | null,
  limit: number,
): Promise<ChunkRow[]> {
  const result = await pool.query<ChunkRow>(
    `
    SELECT
      s."id",
      l."year",
      s."title",
      l."type" AS "sourceType",
      s."contentEn",
      1 - (s."embedding" <=> $1::vector) AS score
    FROM "Chunk" s
    JOIN "Source" l ON l."id" = s."sourceId"
    WHERE s."embedding" IS NOT NULL
      AND l."type" IN (${SOURCE_TYPES_SQL})
      AND ($2::int IS NULL OR l."year" >= $2)
      AND ($3::int IS NULL OR l."year" <= $3)
    ORDER BY s."embedding" <=> $1::vector
    LIMIT $4
    `,
    [JSON.stringify(embedding), yearFrom ?? null, yearTo ?? null, limit],
  );
  return result.rows.filter((r) => r.score >= 0.3);
}

function formatChunks(chunks: ChunkRow[]): string {
  if (chunks.length === 0) return "No relevant passages found.";
  return chunks
    .map(
      (c) =>
        `[${c.sourceType} letter, ${c.year}${c.title ? ` — ${c.title}` : ""}]\n${c.contentEn.trim()}`,
    )
    .join("\n\n---\n\n");
}

export const searchLettersTool = defineTool({
  name: "search_letters",
  label: "Search Letters",
  description:
    "Search Buffett's shareholder and partnership letters for relevant passages. Use this before answering any question about Buffett's views, decisions, or investments.",
  promptSnippet: "search_letters(query, year_from?, year_to?) → relevant letter passages",
  parameters: Type.Object({
    query: Type.String({ description: "What to search for in the letters" }),
    year_from: Type.Optional(Type.Number({ description: "Earliest year to include (e.g. 1990)" })),
    year_to: Type.Optional(Type.Number({ description: "Latest year to include (e.g. 2005)" })),
  }),
  async execute(_toolCallId, params, signal) {
    const { query, year_from, year_to } = params;

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

    let chunks: ChunkRow[];
    try {
      chunks = await vectorSearch(embedding, year_from ?? null, year_to ?? null, 8);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: `Search failed: ${msg}` }], details: null };
    }

    return { content: [{ type: "text" as const, text: formatChunks(chunks) }], details: { count: chunks.length } };
  },
});
