/**
 * Move existing FilingSection large payloads to FilingArtifact.
 *
 * Usage:
 *   npm run migrate:filing-sections:artifacts
 *   npm run migrate:filing-sections:artifacts -- --dry-run
 *   npm run migrate:filing-sections:artifacts -- --limit 50
 */

import { PrismaClient, Prisma } from "@prisma/client";
import {
  FILING_SECTION_EXTRACTION_VERSION,
  makeContentPreview,
  stripBlocksHtml,
} from "./lib/filing-section-storage";
import { archiveFilingArtifact } from "./lib/filing-archive";
import type { FilingBlock } from "./lib/extract-10k-sections";

const db = new PrismaClient();

function parseArgs() {
  const args = process.argv.slice(2);
  const limitArg = args.find((_, index) => args[index - 1] === "--limit");
  const concurrencyArg = args.find((_, index) => args[index - 1] === "--concurrency");
  return {
    dryRun: args.includes("--dry-run"),
    limit: limitArg ? Number.parseInt(limitArg, 10) : undefined,
    concurrency: Math.max(1, concurrencyArg ? Number.parseInt(concurrencyArg, 10) : 4),
  };
}

function isBlockArray(value: unknown): value is FilingBlock[] {
  return Array.isArray(value) && value.every((item) => item && typeof item === "object" && "type" in item);
}

function normalizeKeyPartFallback(value: string | null | undefined, fallback: string) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

async function archiveExistingSectionArtifact(params: {
  sourceId: string;
  entityId: string;
  cik: string | null;
  accession: string | null;
  section: string;
  kind: "section_text" | "section_blocks" | "section_html";
  originalName: string;
  contentType: string;
  body: Buffer;
  sourceUrl: string | null;
}) {
  return archiveFilingArtifact(db, {
    sourceId: params.sourceId,
    kind: params.kind,
    cik: normalizeKeyPartFallback(params.cik, params.entityId),
    accession: normalizeKeyPartFallback(params.accession, params.sourceId),
    originalName: params.originalName,
    contentType: params.contentType,
    body: params.body,
    sourceUrl: params.sourceUrl,
    metadata: {
      entityId: params.entityId,
      section: params.section,
      extractionVersion: FILING_SECTION_EXTRACTION_VERSION,
      migratedFromFilingSection: true,
    },
  });
}

async function migrateOne(id: string, dryRun: boolean) {
  const row = await db.filingSection.findUnique({
    where: { id },
    select: {
      id: true,
      entityId: true,
      sourceId: true,
      section: true,
      content: true,
      rawHtml: true,
      blocksJson: true,
      textArtifactId: true,
      blocksArtifactId: true,
      htmlArtifactId: true,
      entity: { select: { cik: true, ticker: true } },
      source: { select: { accessionNumber: true, url: true, periodYear: true } },
    },
  });
  if (!row) return { migrated: false, label: id };

  const lightBlocks = isBlockArray(row.blocksJson) ? stripBlocksHtml(row.blocksJson) : [];
  const preview = makeContentPreview(row.content);
  const label = `${row.entity.ticker ?? row.entityId} ${row.source.periodYear ?? ""} ${row.section}`;

  if (dryRun) {
    return {
      migrated: true,
      label,
      contentChars: row.content.length,
      rawChars: row.rawHtml?.length ?? 0,
      blocks: lightBlocks.length,
    };
  }

  const [textArtifact, blocksArtifact, htmlArtifact] = await Promise.all([
    row.textArtifactId
      ? db.filingArtifact.findUniqueOrThrow({ where: { id: row.textArtifactId } })
      : archiveExistingSectionArtifact({
        sourceId: row.sourceId,
        entityId: row.entityId,
        cik: row.entity.cik,
        accession: row.source.accessionNumber,
        section: row.section,
        kind: "section_text",
        originalName: `${row.section}.txt`,
        contentType: "text/plain; charset=utf-8",
        body: Buffer.from(row.content, "utf8"),
        sourceUrl: row.source.url,
      }),
    row.blocksArtifactId
      ? db.filingArtifact.findUnique({ where: { id: row.blocksArtifactId } })
      : lightBlocks.length
        ? archiveExistingSectionArtifact({
          sourceId: row.sourceId,
          entityId: row.entityId,
          cik: row.entity.cik,
          accession: row.source.accessionNumber,
          section: row.section,
          kind: "section_blocks",
          originalName: `${row.section}.blocks.json`,
          contentType: "application/json; charset=utf-8",
          body: Buffer.from(JSON.stringify(lightBlocks), "utf8"),
          sourceUrl: row.source.url,
        })
        : Promise.resolve(null),
    row.htmlArtifactId
      ? db.filingArtifact.findUnique({ where: { id: row.htmlArtifactId } })
      : row.rawHtml
        ? archiveExistingSectionArtifact({
          sourceId: row.sourceId,
          entityId: row.entityId,
          cik: row.entity.cik,
          accession: row.source.accessionNumber,
          section: row.section,
          kind: "section_html",
          originalName: `${row.section}.html`,
          contentType: "text/html; charset=utf-8",
          body: Buffer.from(row.rawHtml, "utf8"),
          sourceUrl: row.source.url,
        })
        : Promise.resolve(null),
  ]);

  await db.filingSection.update({
    where: { id: row.id },
    data: {
      content: preview,
      rawHtml: null,
      blocksJson: lightBlocks.length ? lightBlocks as Prisma.InputJsonValue : Prisma.JsonNull,
      contentPreview: preview,
      contentTextLength: row.content.length,
      blockCount: lightBlocks.length,
      extractionVersion: FILING_SECTION_EXTRACTION_VERSION,
      textArtifactId: textArtifact.id,
      blocksArtifactId: blocksArtifact?.id ?? null,
      htmlArtifactId: htmlArtifact?.id ?? null,
      extractedAt: new Date(),
    },
  });

  return {
    migrated: true,
    label,
    contentChars: row.content.length,
    rawChars: row.rawHtml?.length ?? 0,
    blocks: lightBlocks.length,
  };
}

async function main() {
  const { dryRun, limit, concurrency } = parseArgs();
  const candidates = await db.filingSection.findMany({
    where: {
      OR: [
        { textArtifactId: null },
        { rawHtml: { not: null } },
        { extractionVersion: { lt: FILING_SECTION_EXTRACTION_VERSION } },
      ],
    },
    select: { id: true },
    orderBy: [{ sourceId: "asc" }, { section: "asc" }],
    take: limit,
  });

  console.log(`Found ${candidates.length} filing sections to migrate${dryRun ? " (dry-run)" : ""}`);
  console.log(`Concurrency: ${concurrency}`);

  let migrated = 0;
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < candidates.length) {
      const index = nextIndex++;
      const candidate = candidates[index];
      if (!candidate) continue;
      const result = await migrateOne(candidate.id, dryRun);
      if (result.migrated) migrated++;
      console.log(`[${index + 1}/${candidates.length}] ${result.label}`);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, () => worker()));

  console.log(`Done. Migrated ${migrated}/${candidates.length}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
