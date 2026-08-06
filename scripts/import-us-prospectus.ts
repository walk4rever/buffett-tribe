/**
 * Bootstrap evidence for a freshly-IPO'd US company that has no 10-K/20-F/40-F
 * yet (import:10k finds zero annual filings — e.g. SpaceX/SPCX, listed 2026-06,
 * first 10-K not due until FY2026 closes). Downloads the most recent IPO
 * prospectus (424B4 preferred, falling back through 424B3/424B1/S-1/A/S-1) and
 * stores it as plain-text FilingSection rows.
 *
 * Deliberately NOT reusing extract-10k-sections.ts's Item-boundary scanning —
 * a prospectus has no Item 1/1A/2/3 structure (SpaceX's runs "prospectus
 * summary" -> "risk factors" -> "MD&A" -> ... as narrative, and its financial
 * tables are rendered as images, not inline XBRL, so there is no numeric
 * extraction here either — that's a separate, harder problem left alone for
 * now). Same lightweight "mechanically chunk the raw text" approach already
 * proven out for CN/HK annual reports (see fetch-cn-annual-report.py) via the
 * shared buildStoredTextOnlyFilingSectionData() helper — good enough to
 * unblock generate:company-profile / generate:business-model (which only
 * require *some* usable filing text, not Financial rows — see
 * hasUsableFilingEvidence() in scripts/lib/company-generation.ts).
 *
 * Usage:
 *   node --env-file=.env.local ./node_modules/.bin/tsx scripts/import-us-prospectus.ts --ticker SPCX
 */
import * as cheerio from "cheerio";
import db from "../src/lib/prisma";
import { fetchFilingIndexFiles, fetchSecText } from "./lib/filing-archive";
import { archiveFilingArtifacts } from "./lib/annual-report-import-core";
import { buildStoredTextOnlyFilingSectionData } from "./lib/filing-section-storage";

const SEC_HEADERS = {
  "User-Agent": "buffett-tribe research walkklaw@gmail.com",
  Accept: "application/json",
};

// Priority order, not chronological — a 424B4 (the final, effective prospectus)
// supersedes the S-1/A drafts that preceded it; only fall back to an S-1/A or
// bare S-1 when no 424B has been filed yet.
const PREFERRED_FORMS = ["424B4", "424B3", "424B1", "S-1/A", "S-1"];
const CHUNK_COUNT = 4;
export const EXT_SOURCE_KIND = "us-prospectus";

function getArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  return args.find((_, i) => args[i - 1] === flag);
}

type Filing = {
  form: string;
  accession: string;
  filingDate: string;
  primaryDocument: string;
};

async function fetchSubmissions(cik: string): Promise<{
  filings?: { recent?: { form: string[]; filingDate: string[]; accessionNumber: string[]; primaryDocument: string[] } };
}> {
  const padded = cik.padStart(10, "0");
  const res = await fetch(`https://data.sec.gov/submissions/CIK${padded}.json`, { headers: SEC_HEADERS });
  if (!res.ok) throw new Error(`SEC submissions fetch failed for CIK ${cik}: ${res.status}`);
  return res.json();
}

function pickProspectusFiling(recent: { form: string[]; filingDate: string[]; accessionNumber: string[]; primaryDocument: string[] } | undefined): Filing | null {
  if (!recent) return null;
  for (const wantedForm of PREFERRED_FORMS) {
    let bestIdx = -1;
    let bestDate = "";
    for (let i = 0; i < recent.form.length; i++) {
      if (recent.form[i] === wantedForm && recent.filingDate[i] > bestDate) {
        bestDate = recent.filingDate[i];
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      return {
        form: recent.form[bestIdx],
        accession: recent.accessionNumber[bestIdx],
        filingDate: recent.filingDate[bestIdx],
        primaryDocument: recent.primaryDocument[bestIdx],
      };
    }
  }
  return null;
}

function htmlToPlainText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style").remove();
  return $("body")
    .text()
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function chunkText(text: string, count: number): string[] {
  const size = Math.ceil(text.length / count);
  const chunks: string[] = [];
  for (let i = 0; i < count; i++) {
    const chunk = text.slice(i * size, (i + 1) * size).trim();
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

async function main() {
  const ticker = getArg("--ticker")?.trim().toUpperCase();
  if (!ticker) {
    console.error("Usage: tsx import-us-prospectus.ts --ticker <T>");
    process.exit(1);
  }

  const entity = await db.entity.findFirst({
    where: { type: "company", ticker: { equals: ticker, mode: "insensitive" } },
    select: { id: true, cik: true, canonicalName: true },
  });
  if (!entity || !entity.cik) {
    console.error(`No Entity with a CIK found for ticker ${ticker} — run import:10k first to seed the Entity.`);
    process.exit(1);
  }

  const submissions = await fetchSubmissions(entity.cik);
  const filing = pickProspectusFiling(submissions.filings?.recent);
  if (!filing) {
    console.error(`No prospectus filing (${PREFERRED_FORMS.join("/")}) found for ${ticker} (CIK ${entity.cik}).`);
    process.exit(1);
  }
  console.log(`Selected ${filing.form} filed ${filing.filingDate} (${filing.accession}) for ${entity.canonicalName}`);

  const accnoPath = filing.accession.replace(/-/g, "");
  const primaryUrl = `https://www.sec.gov/Archives/edgar/data/${entity.cik}/${accnoPath}/${filing.primaryDocument}`;
  const html = await fetchSecText(primaryUrl);
  console.log(`  downloaded ${html.length.toLocaleString()} bytes`);

  const text = htmlToPlainText(html);
  console.log(`  extracted ${text.length.toLocaleString()} chars of plain text`);
  if (!text) {
    console.error("Extracted text is empty — refusing to write empty FilingSection rows.");
    process.exit(1);
  }

  const chunks = chunkText(text, CHUNK_COUNT);

  const existingSource = await db.extSource.findFirst({
    where: { filerEntityId: entity.id, accessionNumber: filing.accession },
  });
  const extSource =
    existingSource ??
    (await db.extSource.create({
      data: {
        kind: EXT_SOURCE_KIND,
        filerEntityId: entity.id,
        accessionNumber: filing.accession,
        periodYear: new Date(filing.filingDate).getUTCFullYear(),
        ts: new Date(filing.filingDate),
        filedAt: new Date(filing.filingDate),
        url: primaryUrl,
        metadata: { accession: filing.accession, primaryDocument: filing.primaryDocument, form: filing.form },
      },
    }));

  for (let i = 0; i < chunks.length; i++) {
    const section = `us_prospectus_${i + 1}`;
    const stored = await buildStoredTextOnlyFilingSectionData(
      db,
      { entityId: entity.id, sourceId: extSource.id, cik: entity.cik, accession: filing.accession, sourceUrl: primaryUrl },
      section,
      chunks[i],
      null,
    );
    await db.filingSection.upsert({
      where: { sourceId_section: { sourceId: extSource.id, section } },
      create: stored,
      update: stored,
    });
  }

  console.log(`Wrote ${chunks.length} FilingSection rows (kind=${EXT_SOURCE_KIND}) for entity ${entity.id}`);

  // Archive the primary document HTML (+ filing index) to R2 so the same
  // FilingReader used for 10-K/20-F/40-F can render this filing's own
  // "annual report" page — a 424B4/S-1 is a normal SEC HTML filing, not a
  // PDF, so no PdfFilingReader branch is needed (unlike HK/CN annual
  // reports, which really are PDF-extracted text).
  const filingUrlBase = `https://www.sec.gov/Archives/edgar/data/${entity.cik}/${accnoPath}`;
  const { html: indexHtml, files: indexFiles } = await fetchFilingIndexFiles(entity.cik, filing.accession);
  await archiveFilingArtifacts({
    entityId: entity.id,
    sourceId: extSource.id,
    cik: entity.cik,
    accession: filing.accession,
    primaryDocument: filing.primaryDocument,
    filingUrlBase,
    primaryHtml: html,
    indexHtml,
    indexFiles,
  });
  console.log(`  archived primary_html + index_html artifacts`);

  await db.$disconnect();
}

main().catch(async (err) => {
  console.error("Fatal:", err);
  await db.$disconnect();
  process.exit(1);
});
