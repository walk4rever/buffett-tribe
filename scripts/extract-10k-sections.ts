/**
 * Extract 10-K text sections (Business, MD&A, Risk Factors, Notes) from SEC EDGAR HTML.
 *
 * Usage:
 *   npx tsx scripts/extract-10k-sections.ts              # all pending
 *   npx tsx scripts/extract-10k-sections.ts --ticker AAPL # single ticker
 *   npx tsx scripts/extract-10k-sections.ts --limit 50    # batch limit
 */

import prisma from "../src/lib/prisma";

const HEADERS = {
  "User-Agent": "buffett-tribe research walkklaw@gmail.com",
  Accept: "text/html,*/*",
};

const CONCURRENCY = 3;
const REQUEST_DELAY_MS = 300;

// Sections we care about, mapped from SEC Item numbers
const TARGET_SECTIONS: Array<{ key: string; itemNum: string; label: string }> = [
  { key: "item_1_business", itemNum: "1", label: "BUSINESS" },
  { key: "item_1a_risk_factors", itemNum: "1A", label: "RISK FACTORS" },
  { key: "item_1b_staff_comments", itemNum: "1B", label: "UNRESOLVED STAFF COMMENTS" },
  { key: "item_2_properties", itemNum: "2", label: "PROPERTIES" },
  { key: "item_3_legal", itemNum: "3", label: "LEGAL PROCEEDINGS" },
  { key: "item_7_mda", itemNum: "7", label: "MANAGEMENT" },
  { key: "item_7a_market_risk", itemNum: "7A", label: "MARKET RISK" },
  { key: "item_8_notes", itemNum: "8", label: "FINANCIAL STATEMENTS" },
];

function normalizeHtmlToText(html: string): string {
  return (
    html
      // Remove XBRL metadata that pollutes text (before other stripping)
      .replace(/<ix:hidden[\s\S]*?<\/ix:hidden>/gi, "")
      .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, "")
      // Remove script, style, head, noscript
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<head[\s\S]*?<\/head>/gi, "")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
      // Convert block tags to newlines
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/tr>/gi, "\n")
      .replace(/<td[^\u003e]*>/gi, " ")
      // Strip remaining tags
      .replace(/<[^\u003e]+>/g, "")
      // Decode common entities
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      // Clean whitespace
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n\s*\n+/g, "\n\n")
      .trim()
  );
}

function findItemBoundaries(text: string): Array<{ itemNum: string; position: number }> {
  const boundaries: Array<{ itemNum: string; position: number }> = [];
  // Match "ITEM 1." / "ITEM 1A." / "ITEM 1 BUSINESS" / "ITEM 1A RISK FACTORS" etc.
  const regex = /\bITEM\s+(\d+[A-Z]?)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    boundaries.push({ itemNum: match[1].toUpperCase(), position: match.index });
  }
  return boundaries;
}

function extractTargetSections(html: string): Record<string, string> {
  const text = normalizeHtmlToText(html);
  const allBoundaries = findItemBoundaries(text);
  if (allBoundaries.length === 0) return {};

  // Strategy: the real document sections have much more content than TOC entries.
  // Find the occurrence of each itemNum that has the largest distance to the next boundary.
  const bestBoundaries = new Map<string, { position: number; distance: number }>();
  for (let i = 0; i < allBoundaries.length - 1; i++) {
    const b = allBoundaries[i];
    const dist = allBoundaries[i + 1].position - b.position;
    const existing = bestBoundaries.get(b.itemNum);
    if (!existing || dist > existing.distance) {
      bestBoundaries.set(b.itemNum, { position: b.position, distance: dist });
    }
  }
  // Handle last boundary (no next boundary)
  const last = allBoundaries[allBoundaries.length - 1];
  if (!bestBoundaries.has(last.itemNum)) {
    bestBoundaries.set(last.itemNum, { position: last.position, distance: text.length - last.position });
  }

  const sorted = [...bestBoundaries.entries()]
    .map(([num, data]) => ({ num, pos: data.position }))
    .sort((a, b) => a.pos - b.pos);

  const result: Record<string, string> = {};

  for (const target of TARGET_SECTIONS) {
    const idx = sorted.findIndex((s) => s.num === target.itemNum);
    if (idx === -1) continue;

    const start = sorted[idx].pos;
    const end = idx < sorted.length - 1 ? sorted[idx + 1].pos : text.length;
    let content = text.slice(start, end).trim();

    // Strip the leading "ITEM X. TITLE" header line
    const headerRegex = new RegExp(
      `^ITEM\\s+${target.itemNum.replace(".", "\\.")}\\s*[.\\-]?\\s*${target.label.replace(/\s/g, "\\s*")}[^\\n]*`,
      "i",
    );
    content = content.replace(headerRegex, "").trim();

    // Skip if too short (likely a false match)
    if (content.length < 200) continue;

    result[target.key] = content;
  }

  return result;
}

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
