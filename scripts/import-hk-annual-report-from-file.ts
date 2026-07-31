import { readFileSync } from "node:fs";
import db from "../src/lib/prisma";
import { buildStoredTextOnlyFilingSectionData } from "./lib/filing-section-storage";
import { archiveFilingArtifact } from "./lib/filing-archive";

type ReportRecord = { periodYear: number; url: string; lang?: string; pdfPath: string; chunks: string[] };

function getArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  return args.find((_, i) => args[i - 1] === flag);
}

async function main() {
  const filePath = process.argv[2];
  const ticker = getArg("--ticker");
  const code = getArg("--code");
  const market = getArg("--market");

  if (!filePath || !ticker || !code || !market) {
    console.error("Usage: tsx import-hk-annual-report-from-file.ts <json-file> --ticker <T> --code <C> --market hk");
    process.exit(1);
  }

  const reports = JSON.parse(readFileSync(filePath, "utf-8")) as ReportRecord[];
  if (!reports.length) {
    console.error("Empty reports file");
    process.exit(1);
  }

  const entity = await db.entity.findFirst({
    where: { type: "company", market, code },
    select: { id: true, cik: true },
  });
  if (!entity) {
    console.error(`No Entity found for market=${market} code=${code} — run the seed_entity step first`);
    process.exit(1);
  }

  let totalSections = 0;
  for (const report of reports) {
    // Stable accessionNumber per year so reruns reuse the same ExtSource row
    // instead of accumulating duplicates — same idempotency pattern as the
    // akshare financials importer's "akshare-annual" key.
    const accessionNumber = `hk-annual-report-${report.periodYear}`;
    // form shows a real label on the company page's reference card instead of
    // falling back to the raw kind string ("HK-ANNUAL-REPORT") — see
    // src/app/company/[id]/page.tsx's card head. lang records which language
    // version of the filing was fetched (HKEX files zh/en as separate PDFs;
    // older imports predate the field and default to "en").
    const lang = report.lang ?? "en";
    const metadata = { ticker, market, code, form: lang === "zh" ? "年報" : "Annual Report", lang };
    const extSource = await db.extSource.upsert({
      where: { ExtSource_filer_accession_unique: { filerEntityId: entity.id, accessionNumber } },
      create: {
        kind: "hk-annual-report",
        filerEntityId: entity.id,
        accessionNumber,
        periodYear: report.periodYear,
        url: report.url,
        metadata,
      },
      update: { url: report.url, metadata },
    });

    // Archive the original PDF to R2 — HKEXnews itself is too slow to link
    // to directly for a reading page (~85KB/s observed), so the reading page
    // needs its own copy. cik falls back to entityId, matching the same
    // null-cik pattern buildStoredTextOnlyFilingSectionData's caller already
    // uses one level up for CN/HK entities (which have no SEC CIK).
    const pdfBuffer = readFileSync(report.pdfPath);
    await archiveFilingArtifact(db, {
      sourceId: extSource.id,
      kind: "primary_pdf",
      cik: entity.cik ?? entity.id,
      accession: accessionNumber,
      originalName: `${code}_${report.periodYear}.pdf`,
      contentType: "application/pdf",
      body: pdfBuffer,
      sourceUrl: report.url,
      metadata: { entityId: entity.id, periodYear: report.periodYear },
    });

    for (const [index, content] of report.chunks.entries()) {
      if (!content.trim()) continue;
      const section = `hk_annual_report_${index + 1}`;
      const data = await buildStoredTextOnlyFilingSectionData(
        db,
        { entityId: entity.id, sourceId: extSource.id, cik: entity.cik, accession: accessionNumber },
        section,
        content,
        null,
      );
      await db.filingSection.upsert({
        where: { sourceId_section: { sourceId: extSource.id, section } },
        create: data,
        update: data,
      });
      totalSections++;
    }
    console.log(`FY${report.periodYear}: wrote ${report.chunks.length} sections`);
  }

  console.log(`Wrote ${totalSections} FilingSection rows for entity ${entity.id}`);
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
