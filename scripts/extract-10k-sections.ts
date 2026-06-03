/**
 * Extract annual filing text sections from SEC EDGAR HTML.
 *
 * Usage:
 *   npx tsx scripts/extract-10k-sections.ts               # all pending
 *   npx tsx scripts/extract-10k-sections.ts --ticker AAPL # single ticker
 *   npx tsx scripts/extract-10k-sections.ts --source-id <ID> # single filing
 *   npx tsx scripts/extract-10k-sections.ts --limit 50    # batch limit
 */

import prisma from "../src/lib/prisma";
import { extractTargetSections } from "./lib/extract-10k-sections";
import { buildAnnualReportToc } from "../src/lib/annual-report-html";
import { buildStoredFilingSectionData } from "./lib/filing-section-storage";

const HEADERS = {
  "User-Agent": "buffett-tribe research walkklaw@gmail.com",
  Accept: "text/html,*/*",
};

const CONCURRENCY = 3;
const REQUEST_DELAY_MS = 300;

async function processSource(source: {
  id: string;
  url: string;
  filerEntityId: string | null;
  metadata: unknown;
  kind: string;
  accessionNumber: string | null;
  filer: { cik: string | null } | null;
}) {
  if (!source.url || !source.filerEntityId) return { sections: 0, skipped: true };

  try {
    const label = `${source.id} ${source.kind}`;
    console.log(`  ${label}: fetching ${source.url}`);
    const timeoutMs = source.kind === "20f" || source.kind === "40f" ? 120000 : 30000;
    const res = await fetch(source.url, { headers: HEADERS, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
      console.warn(`  HTTP ${res.status} for ${source.url}`);
      return { sections: 0, skipped: false };
    }

    const html = await res.text();
    if (html.length < 1000) {
      console.warn(`  Too short HTML (${html.length} bytes)`);
      return { sections: 0, skipped: false };
    }

    console.log(`  ${label}: extracting from ${html.length.toLocaleString()} bytes`);
    const sections = extractTargetSections(html, source.url, source.kind as "10k" | "20f" | "40f");
    const tocJson = buildAnnualReportToc(html);
    let upserted = 0;
    const keys = Object.keys(sections);
    console.log(`  ${label}: extracted ${keys.length} sections`);

    if (keys.length) {
      await prisma.filingSection.deleteMany({
        where: {
          sourceId: source.id,
          section: { notIn: keys },
        },
      });
    }

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
      upserted++;
    }

    if (tocJson.length) {
      await prisma.extSource.update({
        where: { id: source.id },
        data: {
          metadata: {
            ...(source.metadata && typeof source.metadata === "object" && !Array.isArray(source.metadata) ? source.metadata : {}),
            tocJson,
          },
        },
      });
    }

    return { sections: upserted, skipped: false };
  } catch (err) {
    console.warn(`  Error: ${err instanceof Error ? err.message : String(err)}`);
    return { sections: 0, skipped: false };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const tickerArg = args.find((_, i) => args[i - 1] === "--ticker");
  const sourceIdArg = args.find((_, i) => args[i - 1] === "--source-id");
  const limitArg = args.find((_, i) => args[i - 1] === "--limit");
  const limit = limitArg ? parseInt(limitArg, 10) : undefined;

  // Build query
  const where: Record<string, unknown> = {
    kind: { in: ["10k", "20f", "40f"] },
    url: { not: null },
  };

  if (sourceIdArg) {
    where.id = sourceIdArg;
  } else if (tickerArg) {
    const companies = await prisma.entity.findMany({
      where: { ticker: { equals: tickerArg, mode: "insensitive" } },
      select: { id: true },
    });
    if (!companies.length) throw new Error(`Company not found: ${tickerArg}`);
    where.filerEntityId = { in: companies.map((c) => c.id) };
  }

    const sources = await prisma.extSource.findMany({
      where,
      orderBy: [{ filerEntityId: "asc" }, { periodYear: "desc" }],
      take: limit,
      select: {
        id: true,
        url: true,
        filerEntityId: true,
        periodYear: true,
        kind: true,
        metadata: true,
        accessionNumber: true,
        filer: { select: { cik: true } },
      },
    });

  console.log(`Found ${sources.length} filings to process`);

  let processed = 0;
  let skipped = 0;
  let totalSections = 0;

  for (let i = 0; i < sources.length; i += CONCURRENCY) {
    const batch = sources.slice(i, i + CONCURRENCY);
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

    if (i + CONCURRENCY < sources.length) {
      await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
    }
  }

  console.log(`\nDone. Processed ${processed}, skipped ${skipped}, total sections ${totalSections}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
