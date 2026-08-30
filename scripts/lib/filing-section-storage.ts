import { Prisma, type PrismaClient } from "@prisma/client";
import type { ExtractedSection, FilingBlock } from "./extract-10k-sections";
import { archiveFilingArtifact } from "./filing-archive";

const CONTENT_PREVIEW_CHARS = 8_000;
export const FILING_SECTION_EXTRACTION_VERSION = 3;

type FilingSectionArtifactContext = {
  entityId: string;
  sourceId: string;
  cik: string | null | undefined;
  accession: string | null | undefined;
  sourceUrl?: string | null;
};

type StoredSectionData = {
  entityId: string;
  sourceId: string;
  section: string;
  content: string;
  rawHtml: null;
  outlineJson: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
  blocksJson: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
  contentPreview: string;
  contentTextLength: number;
  blockCount: number;
  extractionVersion: number;
  textArtifactId: string | null;
  blocksArtifactId: string | null;
  htmlArtifactId: string | null;
  extractedAt: Date;
};

function normalizeKeyPartFallback(value: string | null | undefined, fallback: string) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

export function makeContentPreview(content: string) {
  if (content.length <= CONTENT_PREVIEW_CHARS) return content;
  return content.slice(0, CONTENT_PREVIEW_CHARS).trimEnd();
}

export function stripBlockHtml(block: FilingBlock) {
  const lightBlock = { ...(block as Omit<FilingBlock, "html"> & { html?: string }) };
  delete lightBlock.html;
  return lightBlock;
}

export function stripBlocksHtml(blocks: FilingBlock[]) {
  return blocks.map(stripBlockHtml);
}

async function archiveSectionTextArtifact(
  db: PrismaClient,
  context: FilingSectionArtifactContext,
  section: string,
  content: string,
) {
  return archiveFilingArtifact(db, {
    sourceId: context.sourceId,
    kind: "section_text",
    cik: normalizeKeyPartFallback(context.cik, context.entityId),
    accession: normalizeKeyPartFallback(context.accession, context.sourceId),
    originalName: `${section}.v${FILING_SECTION_EXTRACTION_VERSION}.txt`,
    contentType: "text/plain; charset=utf-8",
    body: Buffer.from(content, "utf8"),
    sourceUrl: context.sourceUrl ?? null,
    metadata: {
      entityId: context.entityId,
      section,
      extractionVersion: FILING_SECTION_EXTRACTION_VERSION,
    },
  });
}

// section_blocks archival was retired 2026-08-30 — the reader has pointed at
// primary_html (not per-section blocks) since 9722cc8a (2026-06-13), and
// grepping the app + agent tool code turned up zero consumers of
// blocksArtifactId. Each block already duplicates its section's HTML, which
// is the bulk of what made this the single largest artifact kind by storage
// (2.5GB / 13,986 objects at the time of retirement). blockCount is kept as
// metadata (how many blocks the extractor found), just no longer backed by
// an uploaded artifact.
export async function buildStoredFilingSectionData(
  db: PrismaClient,
  context: FilingSectionArtifactContext,
  section: string,
  extracted: Pick<ExtractedSection, "content" | "rawHtml" | "outline" | "blocks">,
): Promise<StoredSectionData> {
  const textArtifact = await archiveSectionTextArtifact(db, context, section, extracted.content);
  const preview = makeContentPreview(extracted.content);

  return {
    entityId: context.entityId,
    sourceId: context.sourceId,
    section,
    content: preview,
    rawHtml: null,
    outlineJson: extracted.outline as Prisma.InputJsonValue,
    blocksJson: Prisma.JsonNull,
    contentPreview: preview,
    contentTextLength: extracted.content.length,
    blockCount: extracted.blocks.length,
    extractionVersion: FILING_SECTION_EXTRACTION_VERSION,
    textArtifactId: textArtifact.id,
    blocksArtifactId: null,
    htmlArtifactId: null,
    extractedAt: new Date(),
  };
}

export async function buildStoredTextOnlyFilingSectionData(
  db: PrismaClient,
  context: FilingSectionArtifactContext,
  section: string,
  content: string,
  rawHtml: string | null,
): Promise<StoredSectionData> {
  void rawHtml;
  const textArtifact = await archiveSectionTextArtifact(db, context, section, content);
  const preview = makeContentPreview(content);

  return {
    entityId: context.entityId,
    sourceId: context.sourceId,
    section,
    content: preview,
    rawHtml: null,
    outlineJson: Prisma.JsonNull,
    blocksJson: Prisma.JsonNull,
    contentPreview: preview,
    contentTextLength: content.length,
    blockCount: 0,
    extractionVersion: FILING_SECTION_EXTRACTION_VERSION,
    textArtifactId: textArtifact.id,
    blocksArtifactId: null,
    htmlArtifactId: null,
    extractedAt: new Date(),
  };
}
