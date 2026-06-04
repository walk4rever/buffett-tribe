import { Prisma, type PrismaClient } from "@prisma/client";
import type { ExtractedSection, FilingBlock } from "./extract-10k-sections";
import { archiveFilingArtifact } from "./filing-archive";

const CONTENT_PREVIEW_CHARS = 8_000;
export const FILING_SECTION_EXTRACTION_VERSION = 2;

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
    originalName: `${section}.txt`,
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

async function archiveSectionBlocksArtifact(
  db: PrismaClient,
  context: FilingSectionArtifactContext,
  section: string,
  blocks: unknown[],
) {
  return archiveFilingArtifact(db, {
    sourceId: context.sourceId,
    kind: "section_blocks",
    cik: normalizeKeyPartFallback(context.cik, context.entityId),
    accession: normalizeKeyPartFallback(context.accession, context.sourceId),
    originalName: `${section}.blocks.json`,
    contentType: "application/json; charset=utf-8",
    body: Buffer.from(JSON.stringify(blocks), "utf8"),
    sourceUrl: context.sourceUrl ?? null,
    metadata: {
      entityId: context.entityId,
      section,
      extractionVersion: FILING_SECTION_EXTRACTION_VERSION,
    },
  });
}

export async function buildStoredFilingSectionData(
  db: PrismaClient,
  context: FilingSectionArtifactContext,
  section: string,
  extracted: Pick<ExtractedSection, "content" | "rawHtml" | "outline" | "blocks">,
): Promise<StoredSectionData> {
  const lightBlocks = stripBlocksHtml(extracted.blocks);
  const [textArtifact, blocksArtifact] = await Promise.all([
    archiveSectionTextArtifact(db, context, section, extracted.content),
    lightBlocks.length ? archiveSectionBlocksArtifact(db, context, section, lightBlocks) : Promise.resolve(null),
  ]);
  const preview = makeContentPreview(extracted.content);

  return {
    entityId: context.entityId,
    sourceId: context.sourceId,
    section,
    content: preview,
    rawHtml: null,
    outlineJson: extracted.outline as Prisma.InputJsonValue,
    blocksJson: lightBlocks.length ? lightBlocks as Prisma.InputJsonValue : Prisma.JsonNull,
    contentPreview: preview,
    contentTextLength: extracted.content.length,
    blockCount: lightBlocks.length,
    extractionVersion: FILING_SECTION_EXTRACTION_VERSION,
    textArtifactId: textArtifact.id,
    blocksArtifactId: blocksArtifact?.id ?? null,
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
