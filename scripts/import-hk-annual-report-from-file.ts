import { readFileSync } from "node:fs";
import db from "../src/lib/prisma";
import { buildStoredTextOnlyFilingSectionData } from "./lib/filing-section-storage";

type ReportRecord = { periodYear: number; chunks: string[] };

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
    const extSource = await db.extSource.upsert({
      where: { ExtSource_filer_accession_unique: { filerEntityId: entity.id, accessionNumber } },
      create: {
        kind: "hk-annual-report",
        filerEntityId: entity.id,
        accessionNumber,
        periodYear: report.periodYear,
        metadata: { ticker, market, code },
      },
      update: { metadata: { ticker, market, code } },
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
