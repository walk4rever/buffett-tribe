import { readFileSync } from "node:fs";
import { Prisma } from "@prisma/client";
import db from "../src/lib/prisma";
import { buildStoredTextOnlyFilingSectionData } from "./lib/filing-section-storage";
import { archiveFilingArtifact } from "./lib/filing-archive";

type PeriodicRecord = {
  periodYear: number;
  periodQuarter: number;
  kind: "hk-interim-report" | "hk-quarterly-report";
  form: string;
  title: string;
  url: string;
  pdfPath: string;
  chunks?: string[];
  metadata?: Record<string, unknown>;
};

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
    console.error("Usage: tsx import-hk-interim-report-from-file.ts <json-file> --ticker <T> --code <C> --market hk");
    process.exit(1);
  }

  const reports = JSON.parse(readFileSync(filePath, "utf-8")) as PeriodicRecord[];
  if (!reports.length) {
    console.error("Empty reports file");
    process.exit(1);
  }

  // Look for entity by code or leading-zero variations (e.g. 09992 or 9992, 00700 or 700)
  const codeVariants = [code, String(Number.parseInt(code, 10)), code.padStart(5, "0")];
  const entity = await db.entity.findFirst({
    where: { type: "company", market, code: { in: codeVariants } },
    select: { id: true, cik: true, code: true },
  });
  if (!entity) {
    console.error(`No Entity found for market=${market} code=${code} — run seed_entity step first`);
    process.exit(1);
  }

  let totalSections = 0;
  for (const report of reports) {
    const qLabel = report.periodQuarter === 2 ? "h1" : `q${report.periodQuarter}`;
    const accessionNumber = `${report.kind}-${report.periodYear}-${qLabel}`;
    const metadata = {
      ticker,
      market,
      code: entity.code ?? code,
      form: report.form,
      lang: "zh",
      title: report.title,
      ...(report.metadata ? { extraction: report.metadata } : {}),
    };

    const extSource = await db.extSource.upsert({
      where: { ExtSource_filer_accession_unique: { filerEntityId: entity.id, accessionNumber } },
      create: {
        kind: report.kind,
        filerEntityId: entity.id,
        accessionNumber,
        periodYear: report.periodYear,
        periodQuarter: report.periodQuarter,
        url: report.url,
        metadata: metadata as Prisma.InputJsonValue,
      },
      update: {
        url: report.url,
        periodYear: report.periodYear,
        periodQuarter: report.periodQuarter,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });

    const pdfBuffer = readFileSync(report.pdfPath);
    await archiveFilingArtifact(db, {
      sourceId: extSource.id,
      kind: "primary_pdf",
      cik: entity.cik ?? entity.id,
      accession: accessionNumber,
      originalName: `${entity.code ?? code}_${report.periodYear}_${qLabel.toUpperCase()}.pdf`,
      contentType: "application/pdf",
      body: pdfBuffer,
      sourceUrl: report.url,
      metadata: { entityId: entity.id, periodYear: report.periodYear, periodQuarter: report.periodQuarter },
    });

    if (report.chunks && report.chunks.length > 0) {
      for (const [idx, chunkText] of report.chunks.entries()) {
        const sectionName = `${report.kind}_${qLabel}_${idx + 1}`;
        const data = await buildStoredTextOnlyFilingSectionData(
          db,
          { entityId: entity.id, sourceId: extSource.id, cik: entity.cik, accession: accessionNumber },
          sectionName,
          chunkText,
        );
        await db.filingSection.upsert({
          where: { sourceId_section: { sourceId: extSource.id, section: sectionName } },
          create: data,
          update: data,
        });
        totalSections++;
      }
    }

    console.log(`  Archived ${report.title} (${accessionNumber}) to R2 and DB.`);
  }

  console.log(`Successfully imported ${reports.length} periodic reports (${totalSections} sections) for ${code}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
