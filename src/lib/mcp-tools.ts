import { z } from "zod";
import prisma from "@/lib/prisma";
import { searchChunks } from "@/lib/search";

// ── search ────────────────────────────────────────────────────────────────────

export const searchParams = z.object({
  query: z.string().describe("Question or topic to search for in the Buffett Tribe knowledge base"),
  yearFrom: z.number().int().optional().describe("Earliest year (inclusive)"),
  yearTo: z.number().int().optional().describe("Latest year (inclusive)"),
  limit: z.number().int().min(1).max(20).optional().default(7).describe("Max chunks to return"),
});

export async function toolSearch(params: z.infer<typeof searchParams>) {
  const result = await searchChunks(params.query);

  let chunks = result.chunks;
  if (params.yearFrom != null) chunks = chunks.filter((c) => c.year >= params.yearFrom!);
  if (params.yearTo != null) chunks = chunks.filter((c) => c.year <= params.yearTo!);
  chunks = chunks.slice(0, params.limit);

  if (chunks.length === 0) {
    return { found: 0, chunks: [] };
  }

  return {
    found: chunks.length,
    chunks: chunks.map((c) => ({
      id: c.id,
      year: c.year,
      sourceType: c.sourceType,
      title: c.title ?? null,
      excerpt: c.contentEn.slice(0, 600),
      excerptZh: c.contentZh ? c.contentZh.slice(0, 400) : null,
      retrieval: c.retrieval,
    })),
  };
}

// ── get_document ──────────────────────────────────────────────────────────────

const PAGE_SIZE = 10;

export const getDocumentParams = z.object({
  sourceId: z.string().optional().describe("Exact source ID"),
  year: z.number().int().optional().describe("Year of the document"),
  type: z.string().optional().describe("Document type: shareholder | partnership"),
  page: z.number().int().min(1).optional().default(1).describe("Page number (10 chunks per page)"),
});

export async function toolGetDocument(params: z.infer<typeof getDocumentParams>) {
  const source = params.sourceId
    ? await prisma.source.findUnique({ where: { id: params.sourceId } })
    : await prisma.source.findFirst({
        where: {
          ...(params.year != null ? { year: params.year } : {}),
          ...(params.type ? { type: params.type } : {}),
        },
        orderBy: { year: "desc" },
      });

  if (!source) {
    return { error: "Document not found" };
  }

  const page = params.page ?? 1;
  const chunks = await prisma.chunk.findMany({
    where: { sourceId: source.id },
    orderBy: { order: "asc" },
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    select: { id: true, order: true, title: true, contentEn: true, contentZh: true },
  });

  const total = await prisma.chunk.count({ where: { sourceId: source.id } });
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return {
    source: {
      id: source.id,
      year: source.year,
      type: source.type,
      title: source.title,
    },
    page,
    totalPages,
    totalChunks: total,
    chunks: chunks.map((c) => ({
      id: c.id,
      order: c.order,
      title: c.title ?? null,
      contentEn: c.contentEn,
      contentZh: c.contentZh ?? null,
    })),
  };
}

