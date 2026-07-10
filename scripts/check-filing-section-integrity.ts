/**
 * check-filing-section-integrity.ts
 *
 * Read-only health report for FilingSection full-text availability.
 *
 * FilingSection.content is a lightweight preview/legacy field, not the full
 * section text (see incident notes in services/pi-gateway/src/tools/search-filings.ts:
 * content was silently truncated to ~3000 chars in production for over a
 * month with no detection). search_filings now re-derives full text on
 * demand from FilingArtifact(kind=primary_html) instead of trusting
 * `content`. That shifts the failure mode: a FilingSection with real
 * extracted content but a parent ExtSource missing its primary_html artifact
 * would silently fall back to the same lightweight preview again. This
 * check flags exactly that gap.
 *
 * Usage:
 *   npm run check:filing-section:integrity
 *   npm run check:filing-section:integrity -- --strict   # exit 1 if any gaps found
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const strict = process.argv.includes("--strict");

async function main() {
  const sources = await db.extSource.findMany({
    where: {
      kind: { in: ["10k", "20f", "40f"] },
      sections: { some: { contentTextLength: { gt: 100 } } },
    },
    select: {
      id: true,
      kind: true,
      periodYear: true,
      accessionNumber: true,
      filer: { select: { canonicalName: true, ticker: true } },
      artifacts: { where: { kind: "primary_html" }, select: { id: true } },
      _count: { select: { sections: true } },
    },
  });

  const missingPrimaryHtml = sources.filter((s) => s.artifacts.length === 0);

  const samples = missingPrimaryHtml.slice(0, 30).map((s) => ({
    sourceId: s.id,
    ticker: s.filer?.ticker ?? null,
    name: s.filer?.canonicalName ?? null,
    kind: s.kind,
    year: s.periodYear,
    accession: s.accessionNumber,
    sectionCount: s._count.sections,
  }));

  console.log(
    JSON.stringify(
      {
        filingsWithSections: sources.length,
        filingsMissingPrimaryHtml: missingPrimaryHtml.length,
        samples,
      },
      null,
      2,
    ),
  );

  await db.$disconnect();

  if (strict && missingPrimaryHtml.length > 0) {
    process.exitCode = 1;
  }
}

main().catch(async (err) => {
  console.error("[check-filing-section-integrity] fatal", err);
  await db.$disconnect();
  process.exitCode = 1;
});
