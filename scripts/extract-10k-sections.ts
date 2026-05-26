/**
 * Extract 10-K text sections (Business, MD&A, Risk Factors, Notes) from SEC EDGAR HTML.
 *
 * Usage:
 *   npx tsx scripts/extract-10k-sections.ts              # all pending
 *   npx tsx scripts/extract-10k-sections.ts --ticker AAPL # single ticker
 *   npx tsx scripts/extract-10k-sections.ts --limit 50    # batch limit
 */

import prisma from "../src/lib/prisma";
import { TARGET_SECTIONS, extractTargetSections } from "./lib/extract-10k-sections";

const HEADERS = {
  "User-Agent": "buffett-tribe research walkklaw@gmail.com",
  Accept: "text/html,*/*",
};

const CONCURRENCY = 3;
const REQUEST_DELAY_MS = 300;

async function processSource(source: { id: string; url: string; filerEntityId: string | null }) {
  if (!source.url || !source.filerEntityId) return { sections: 0, skipped: true };

  // Check which sections already exist
  const existing = await prisma.filingSection.findMany({
    where: { sourceId: source.id },
    select: { section: true },
  });
  const existingSet = new Set(existing.map((e) => e.section));
  const neededSections = TARGET_SECTIONS.filter((t) => !existingSet.has(t.key));
  if (neededSections.length === 0) return { sections: 0, skipped: true };

  try {
    const res = await fetch(source.url, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
    if (!res.ok) {
      console.warn(`  HTTP ${res.status} for ${source.url}`);
      return { sections: 0, skipped: false };
    }

    const html = await res.text();
    if (html.length < 1000) {
      console.warn(`  Too short HTML (${html.length} bytes)`);
      return { sections: 0, skipped: false };
    }

    const sections = extractTargetSections(html);
    let upserted = 0;

    for (const [key, content] of Object.entries(sections)) {
      await prisma.filingSection.upsert({
        where: { sourceId_section: { sourceId: source.id, section: key } },
        update: {
          content,
          extractedAt: new Date(),
        },
        create: {
          entityId: source.filerEntityId,
          sourceId: source.id,
          section: key,
          content,
          rawHtml: null, // Do not store raw HTML to save space; source.url is the truth
          extractedAt: new Date(),
        },
      });
      upserted++;
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
  const limitArg = args.find((_, i) => args[i - 1] === "--limit");
  const limit = limitArg ? parseInt(limitArg, 10) : undefined;

  // Build query
  const where: Record<string, unknown> = {
    kind: { in: ["10k", "20f", "40f"] },
    url: { not: null },
  };

  if (tickerArg) {
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
    select: { id: true, url: true, filerEntityId: true, periodYear: true, kind: true },
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
