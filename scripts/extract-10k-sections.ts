/**
 * Extract annual filing text sections from SEC EDGAR HTML.
 *
 * Usage:
 *   npx tsx scripts/extract-10k-sections.ts               # all pending
 *   npx tsx scripts/extract-10k-sections.ts --ticker AAPL # single ticker
 *   npx tsx scripts/extract-10k-sections.ts --source-id <ID> # single filing
 *   npx tsx scripts/extract-10k-sections.ts --limit 50    # batch limit
 *   npx tsx scripts/extract-10k-sections.ts --kinds 10k   # only 10-K filings
 */

import { pathToFileURL } from "node:url";
import prisma from "../src/lib/prisma";
import { extractTargetSections } from "./lib/extract-10k-sections";
import { buildStoredFilingSectionData, FILING_SECTION_EXTRACTION_VERSION } from "./lib/filing-section-storage";
import { Prisma } from "@prisma/client";
import { getR2ObjectBuffer } from "../src/lib/r2";

const HEADERS = {
  "User-Agent": "buffett-tribe research walkklaw@gmail.com",
  Accept: "text/html,*/*",
};

const DEFAULT_CONCURRENCY = 3;
const REQUEST_DELAY_MS = 300;
const DEFAULT_KINDS = ["10k", "20f", "40f"] as const;

export const FILING_SOURCE_SELECT = {
  id: true,
  url: true,
  filerEntityId: true,
  periodYear: true,
  kind: true,
  metadata: true,
  accessionNumber: true,
  filer: { select: { cik: true } },
  artifacts: {
    where: { kind: "primary_html" },
    select: { objectKey: true, publicUrl: true },
    orderBy: { createdAt: "asc" },
    take: 1,
  },
} as const;

export type FilingSectionBackfillSource = {
  id: string;
  url: string | null;
  filerEntityId: string | null;
  metadata: unknown;
  kind: string;
  accessionNumber: string | null;
  filer: { cik: string | null } | null;
  artifacts: Array<{ objectKey: string; publicUrl: string | null }>;
};

export type ProcessFilingSourceResult = {
  sections: number;
  skipped: boolean;
};

function parsePositiveInt(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseKinds(value: string | undefined) {
  if (!value) return [...DEFAULT_KINDS];
  const allowed = new Set<string>(DEFAULT_KINDS);
  const kinds = value.split(",").map((kind) => kind.trim().toLowerCase()).filter(Boolean);
  const invalid = kinds.filter((kind) => !allowed.has(kind));
  if (invalid.length) throw new Error(`Invalid --kinds value: ${invalid.join(", ")}`);
  return [...new Set(kinds)];
}

function isConnectionClosedError(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  if (code === "P1017") return true;
  const message = error instanceof Error ? error.message : String(error);
  return /server has closed the connection|connection.*closed|P1017/i.test(message);
}

async function retryDb<T>(label: string, fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (error) {
    if (!isConnectionClosedError(error)) throw error;
    console.warn(`  DB retry after closed connection: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    return fn();
  }
}

async function fetchHtmlWithFallback(params: {
  objectKey: string | null | undefined;
  publicUrl: string | null | undefined;
  sourceUrl: string;
}) {
  let lastError: unknown;

  if (params.objectKey) {
    try {
      console.log(`  fetching R2 object ${params.objectKey}`);
      const buffer = await getR2ObjectBuffer(params.objectKey);
      const html = buffer.toString("utf8");
      if (html.length >= 1000) return html;
      lastError = new Error(`Too short R2 object (${html.length} bytes) for ${params.objectKey}`);
      console.warn(`  Too short R2 object (${html.length} bytes) for ${params.objectKey}`);
    } catch (error) {
      lastError = error;
      console.warn(`  R2 object fetch failed for ${params.objectKey}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const uniqueUrls = [...new Set([params.publicUrl, params.sourceUrl].filter((url): url is string => Boolean(url)))];
  for (const url of uniqueUrls) {
    try {
      const timeoutMs = 300000;
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status} for ${url}`);
        console.warn(`  HTTP ${res.status} for ${url}`);
        continue;
      }

      const html = await res.text();
      if (html.length < 1000) {
        lastError = new Error(`Too short HTML (${html.length} bytes) for ${url}`);
        console.warn(`  Too short HTML (${html.length} bytes) for ${url}`);
        continue;
      }

      return html;
    } catch (error) {
      lastError = error;
      console.warn(`  Fetch failed for ${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function processSource(
  source: FilingSectionBackfillSource,
  options: { throwOnError?: boolean } = {},
): Promise<ProcessFilingSourceResult> {
  if (!source.url || !source.filerEntityId) return { sections: 0, skipped: true };
  const touchedSections: string[] = [];

  try {
    const label = `${source.id} ${source.kind}`;
    const primaryHtmlArtifact = source.artifacts[0];
    const htmlUrl = primaryHtmlArtifact?.publicUrl ?? source.url;
    console.log(`  ${label}: fetching ${htmlUrl}`);
    const html = await fetchHtmlWithFallback({
      objectKey: primaryHtmlArtifact?.objectKey,
      publicUrl: primaryHtmlArtifact?.publicUrl,
      sourceUrl: source.url,
    });

    console.log(`  ${label}: extracting from ${html.length.toLocaleString()} bytes`);
    const sections = extractTargetSections(html, source.url, source.kind as "10k" | "20f" | "40f");
    let upserted = 0;
    const keys = Object.keys(sections);
    console.log(`  ${label}: extracted ${keys.length} sections`);

    if (!keys.length) {
      await prisma.extSource.update({
        where: { id: source.id },
        data: {
          metadata: {
            ...(source.metadata && typeof source.metadata === "object" && !Array.isArray(source.metadata) ? source.metadata : {}),
            filingSectionExtraction: {
              version: FILING_SECTION_EXTRACTION_VERSION,
              status: "no_sections",
              attemptedAt: new Date().toISOString(),
            },
          },
        },
      });
      return { sections: 0, skipped: true };
    }

    await prisma.filingSection.deleteMany({
      where: {
        sourceId: source.id,
        section: { notIn: keys },
      },
    });

    for (const [key, extracted] of Object.entries(sections)) {
      console.log(
        `  ${label}: upserting ${key} (${extracted.content.length.toLocaleString()} content chars, ${extracted.rawHtml.length.toLocaleString()} raw chars)`,
      );
      const data = await buildStoredFilingSectionData(prisma, {
        entityId: source.filerEntityId,
        sourceId: source.id,
        cik: source.filer?.cik,
        accession: source.accessionNumber,
        sourceUrl: source.url,
      }, key, extracted);

      await prisma.filingSection.upsert({
        where: { sourceId_section: { sourceId: source.id, section: key } },
        update: data,
        create: data,
      });
      touchedSections.push(key);
      upserted++;
    }

    // tocJson is intentionally not stored: reader TOC comes from
    // FilingSection.outlineJson; inlining it here ballooned ExtSource to 51MB.
    await prisma.extSource.update({
      where: { id: source.id },
      data: {
        metadata: {
          ...(source.metadata && typeof source.metadata === "object" && !Array.isArray(source.metadata) ? source.metadata : {}),
          filingSectionExtraction: {
            version: FILING_SECTION_EXTRACTION_VERSION,
            status: "success",
            sectionCount: upserted,
            attemptedAt: new Date().toISOString(),
          },
        },
      },
    });

    return { sections: upserted, skipped: false };
  } catch (err) {
    console.warn(`  Error: ${err instanceof Error ? err.message : String(err)}`);
    if (touchedSections.length) {
      await prisma.filingSection.deleteMany({
        where: {
          sourceId: source.id,
          section: { in: touchedSections },
          extractionVersion: FILING_SECTION_EXTRACTION_VERSION,
        },
      });
      console.warn(`  Rolled back ${touchedSections.length} partially written sections for ${source.id}`);
    }
    if (options.throwOnError) throw err;
    return { sections: 0, skipped: false };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const tickerArg = args.find((_, i) => args[i - 1] === "--ticker");
  const sourceIdArg = args.find((_, i) => args[i - 1] === "--source-id");
  const limitArg = args.find((_, i) => args[i - 1] === "--limit");
  const kindsArg = args.find((_, i) => args[i - 1] === "--kinds" || args[i - 1] === "--kind");
  const concurrencyArg = args.find((_, i) => args[i - 1] === "--concurrency");
  const limit = limitArg ? parseInt(limitArg, 10) : undefined;
  const kinds = parseKinds(kindsArg);
  const concurrency = parsePositiveInt(concurrencyArg, DEFAULT_CONCURRENCY);
  const needsCurrentVersion = args.includes("--needs-current-version");

  // Build query
  const where: Record<string, unknown> = {
    kind: { in: kinds },
    url: { not: null },
  };

  if (needsCurrentVersion) {
    where.OR = [
      { sections: { none: {} } },
      { sections: { some: { extractionVersion: { lt: FILING_SECTION_EXTRACTION_VERSION } } } },
    ];
  }

  if (sourceIdArg) {
    where.id = sourceIdArg;
  } else if (tickerArg) {
    const companies = await retryDb("find companies by ticker", () => prisma.entity.findMany({
      where: { ticker: { equals: tickerArg, mode: "insensitive" } },
      select: { id: true },
    }));
    if (!companies.length) throw new Error(`Company not found: ${tickerArg}`);
    where.filerEntityId = { in: companies.map((c) => c.id) };
  }

  if (needsCurrentVersion && !sourceIdArg && !tickerArg) {
    const rows = await retryDb("find section backfill candidates", () => prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT es.id
      FROM "ExtSource" es
      WHERE es.kind IN (${Prisma.join(kinds)})
        AND es.url IS NOT NULL
        AND (
          NOT EXISTS (
            SELECT 1 FROM "FilingSection" fs
            WHERE fs."sourceId" = es.id
          )
          OR EXISTS (
            SELECT 1 FROM "FilingSection" fs
            WHERE fs."sourceId" = es.id
              AND fs."extractionVersion" < ${FILING_SECTION_EXTRACTION_VERSION}
          )
        )
        AND NOT COALESCE((
          es.metadata->'filingSectionExtraction'->>'status' = 'no_sections'
          AND (es.metadata->'filingSectionExtraction'->>'version')::int >= ${FILING_SECTION_EXTRACTION_VERSION}
        ), false)
      ORDER BY es."filerEntityId" ASC NULLS LAST, es."periodYear" DESC NULLS LAST, es."createdAt" ASC
      LIMIT ${limit ?? 100}
    `));
    where.id = { in: rows.map((row) => row.id) };
    delete where.OR;
  }

  const sources = await retryDb("load filing sources", () => prisma.extSource.findMany({
    where,
    orderBy: [{ filerEntityId: "asc" }, { periodYear: "desc" }],
    take: limit,
      select: {
        ...FILING_SOURCE_SELECT,
      },
    }));

  console.log(`Found ${sources.length} filings to process`);

  let processed = 0;
  let skipped = 0;
  let totalSections = 0;

  for (let i = 0; i < sources.length; i += concurrency) {
    const batch = sources.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (source) => {
        const result = await processSource(source);
        processed++;
        if (result.skipped) skipped++;
        totalSections += result.sections;
        console.log(
          `[${processed}/${sources.length}] ${source.filerEntityId} ${source.periodYear} ${source.kind} -> sections ${result.sections}${result.skipped ? " (skipped)" : ""}`,
        );
        return result;
      }),
    );

    if (i + concurrency < sources.length) {
      await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
    }
  }

  console.log(`\nDone. Processed ${processed}, skipped ${skipped}, total sections ${totalSections}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
