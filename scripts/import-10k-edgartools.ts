/**
 * Import annual 10-K/20-F/40-F filings using edgartools for filing discovery
 * and primary HTML retrieval, while preserving the existing Prisma/R2 storage
 * contract.
 *
 * Usage:
 *   npm run import:10k -- --ticker AAPL --from 2025 --to 2025
 */
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildAnnualReportToc } from "../src/lib/annual-report-html";
import { fetchFilingIndexFiles, fetchSecText } from "./lib/filing-archive";
import {
  archiveFilingArtifacts,
  batchUpsertFinancialFactsFromApi,
  batchUpsertFinancialFactsFromInline,
  db,
  decimalFromNumber,
  findBestFactValue,
  getCompanyFacts,
  LINE_ITEMS,
  mapLimit,
  normalizeTicker,
  parseInlineXbrlDocument,
  pickInlineFactWithUnit,
  upsert40FAttachmentSections,
  upsertCompanyEntity,
  upsertExtSource,
  upsertFilingAttachments,
  upsertFilingSectionsFromHtml,
} from "./lib/annual-report-import-core";

type EdgarToolsProfile = {
  name: string | null;
  tickers: string[];
  exchanges: string[];
  sic: string | null;
  sicDescription: string | null;
  category: string | null;
  fiscalYearEnd: string | null;
  stateOfIncorporation: string | null;
  stateOfIncorporationDescription: string | null;
};

type EdgarToolsFiling = {
  accession: string;
  form: string;
  filedAt: string;
  reportDate: string;
  primaryDocument: string;
  primaryUrl: string | null;
  filingUrlBase: string;
  indexUrl: string;
  isXbrl: boolean;
  isInlineXbrl: boolean;
  size: number | null;
  attachments: Array<{
    category: "attachment" | "data_file";
    sequence: string;
    description: string;
    documentName: string;
    documentType: string;
    url: string;
  }>;
  html: string | null;
};

type EdgarToolsPayload = {
  tool: "edgartools";
  toolVersion: string | null;
  ticker: string;
  cik: string;
  title: string;
  profile: EdgarToolsProfile;
  filings: EdgarToolsFiling[];
};

function getArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  return args.find((_, i) => args[i - 1] === flag);
}

function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer: ${value}`);
  }
  return parsed;
}

function parseArgs(args: string[]) {
  const ticker = normalizeTicker(args.find((_, i) => args[i - 1] === "--ticker") ?? "");
  const fromArg = args.find((_, i) => args[i - 1] === "--from");
  const toArg = args.find((_, i) => args[i - 1] === "--to");
  const yearsArg = args.find((_, i) => args[i - 1] === "--years");
  const archiveConcurrency = parsePositiveInt(getArg("--archive-concurrency"), 4);
  const filingConcurrency = parsePositiveInt(getArg("--filing-concurrency"), 1);
  const skipAttachmentArchive = hasFlag("--skip-attachment-archive");
  const noHtml = hasFlag("--no-edgartools-html");
  const python = getArg("--python") ?? (process.env.EDGARTOOLS_PYTHON || path.join(process.cwd(), ".venv/bin/python"));

  if (!ticker) throw new Error("Missing --ticker. Example: --ticker AAPL");
  if ((fromArg && !toArg) || (!fromArg && toArg)) throw new Error("--from and --to must be used together.");

  let fromYear: number;
  let toYear: number;
  if (fromArg && toArg) {
    fromYear = Number.parseInt(fromArg, 10);
    toYear = Number.parseInt(toArg, 10);
    if (!Number.isFinite(fromYear) || !Number.isFinite(toYear)) throw new Error("Invalid --from/--to year.");
    if (fromYear > toYear) throw new Error("--from cannot be greater than --to.");
  } else {
    const years = yearsArg ? Number.parseInt(yearsArg, 10) : 5;
    toYear = new Date().getUTCFullYear();
    fromYear = toYear - years + 1;
  }

  return { ticker, fromYear, toYear, archiveConcurrency, filingConcurrency, skipAttachmentArchive, noHtml, python };
}

async function extractWithEdgarTools(params: {
  ticker: string;
  fromYear: number;
  toYear: number;
  python: string;
  noHtml: boolean;
}) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "buffett-edgartools-"));
  const outputPath = path.join(tempDir, "annual-report.json");
  try {
    const args = [
      "scripts/edgartools_annual_report_extract.py",
      "--ticker",
      params.ticker,
      "--from",
      String(params.fromYear),
      "--to",
      String(params.toYear),
      "--output",
      outputPath,
    ];
    if (params.noHtml) args.push("--no-html");

    const res = spawnSync(params.python, args, {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    if (res.stdout) process.stdout.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);
    if (res.status !== 0) {
      throw new Error(`edgartools helper exited with code ${res.status ?? "unknown"}`);
    }

    const raw = await readFile(outputPath, "utf8");
    return JSON.parse(raw) as EdgarToolsPayload;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function normalizeInlineUnitRef(unitRef: string | null) {
  if (!unitRef) return null;
  const trimmed = unitRef.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === "pure") return "pure";
  const perShare = trimmed.match(/^([A-Za-z]{3})perShare$/i);
  if (perShare) return `${perShare[1].toUpperCase()}/shares`;
  const slashShare = trimmed.match(/^([A-Za-z]{3})\/shares$/i);
  if (slashShare) return `${slashShare[1].toUpperCase()}/shares`;
  return trimmed.toUpperCase();
}

async function importEdgarToolsAnnualReports(params: {
  ticker: string;
  fromYear: number;
  toYear: number;
  archiveConcurrency: number;
  filingConcurrency: number;
  skipAttachmentArchive: boolean;
  noHtml: boolean;
  python: string;
}) {
  const extracted = await extractWithEdgarTools(params);
  if (!extracted.cik || !extracted.title) {
    throw new Error(`edgartools did not return company identity for ${params.ticker}`);
  }

  const cik = extracted.cik;
  const ticker = extracted.ticker || params.ticker;
  console.log(`Ticker ${ticker} -> CIK ${cik} (${extracted.title}) via edgartools ${extracted.toolVersion ?? "unknown"}`);

  const companyEntity = await upsertCompanyEntity(cik, ticker, extracted.title, extracted.profile);
  const facts = await getCompanyFacts(cik);
  const targetFilings = extracted.filings
    .filter((filing) => {
      const y = new Date(filing.reportDate).getUTCFullYear();
      return y >= params.fromYear && y <= params.toYear;
    })
    .sort((a, b) => (a.reportDate < b.reportDate ? 1 : -1));

  console.log(`Found ${targetFilings.length} annual filings from edgartools (${params.fromYear}-${params.toYear})`);
  console.log(
    `Filing concurrency: ${params.filingConcurrency}; archive concurrency: ${params.archiveConcurrency}; skip attachment archive: ${params.skipAttachmentArchive}`,
  );

  await mapLimit(targetFilings, params.filingConcurrency, async (filing) => {
    const extSource = await upsertExtSource(companyEntity.id, cik, filing);
    const primaryUrl = filing.primaryUrl ?? `${filing.filingUrlBase}/${filing.primaryDocument}`;

    const apiFactCount = await batchUpsertFinancialFactsFromApi(companyEntity.id, extSource.id, facts, filing);
    const html = filing.html || await fetchSecText(primaryUrl);
    const tocJson = buildAnnualReportToc(html);
    const inlineDoc = parseInlineXbrlDocument(html);
    const inlineFactCount = await batchUpsertFinancialFactsFromInline(companyEntity.id, extSource.id, inlineDoc, filing);

    const sectionCount = await upsertFilingSectionsFromHtml(
      companyEntity.id,
      extSource.id,
      cik,
      filing.accession,
      html,
      extSource.kind as "10k" | "20f" | "40f",
      primaryUrl,
    );

    const { html: indexHtml, files: indexFiles } = await fetchFilingIndexFiles(cik, filing.accession);
    const attachmentSectionCount =
      extSource.kind === "40f"
        ? await upsert40FAttachmentSections(companyEntity.id, extSource.id, cik, filing.accession, indexFiles)
        : 0;
    const attachmentCount = await upsertFilingAttachments(
      companyEntity.id,
      extSource.id,
      indexFiles.filter((file) => file.category === "attachment"),
    );
    await archiveFilingArtifacts({
      entityId: companyEntity.id,
      sourceId: extSource.id,
      cik,
      accession: filing.accession,
      primaryDocument: filing.primaryDocument,
      filingUrlBase: filing.filingUrlBase,
      primaryHtml: html,
      indexHtml,
      indexFiles,
      concurrency: params.archiveConcurrency,
      skipAttachmentArchive: params.skipAttachmentArchive,
    });

    await db.extSource.update({
      where: { id: extSource.id },
      data: {
        metadata: {
          ...(extSource.metadata as Record<string, unknown>),
          tocJson,
          importedBy: "import-10k-edgartools",
          edgartools: {
            version: extracted.toolVersion,
            indexUrl: filing.indexUrl,
            isXbrl: filing.isXbrl,
            isInlineXbrl: filing.isInlineXbrl,
            attachmentCount: filing.attachments.length,
          },
        },
      },
    });

    let upserted = 0;
    let missing = 0;
    let fallbackUsed = 0;

    for (const item of LINE_ITEMS) {
      const companyFactsValue = findBestFactValue(
        facts,
        item.tagsUsGaap,
        item.tagsIfrs,
        item.unitCandidates,
        filing.reportDate,
      );

      let value = companyFactsValue;
      let unit = item.unitCandidates[0];
      if (value == null) {
        const inlineFact = pickInlineFactWithUnit(
          inlineDoc,
          item.tagsUsGaap,
          item.tagsIfrs,
          filing.reportDate,
          item.periodType,
          item.unitCandidates,
        );
        if (inlineFact) {
          value = inlineFact.value;
          unit = inlineFact.unit ? normalizeInlineUnitRef(inlineFact.unit) ?? unit : unit;
          fallbackUsed++;
        }
      }

      if (value == null) {
        missing++;
        continue;
      }

      await db.financial.upsert({
        where: {
          entityId_periodEnd_periodType_lineItem: {
            entityId: companyEntity.id,
            periodEnd: new Date(filing.reportDate),
            periodType: "FY",
            lineItem: item.key,
          },
        },
        create: {
          entityId: companyEntity.id,
          sourceId: extSource.id,
          periodEnd: new Date(filing.reportDate),
          periodType: "FY",
          lineItem: item.key,
          value: decimalFromNumber(value),
          unit,
        },
        update: {
          sourceId: extSource.id,
          value: decimalFromNumber(value),
          unit,
        },
      });
      upserted++;
    }

    console.log(
      `  ${filing.reportDate} (${filing.accession}) -> facts(API ${apiFactCount}, Inline ${inlineFactCount}), sections ${sectionCount}+${attachmentSectionCount}, attachments ${attachmentCount}, derived ${upserted}, missing ${missing}, fallback ${fallbackUsed}`,
    );
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await importEdgarToolsAnnualReports(args);
  console.log("Done.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((err) => {
      console.error("Fatal:", err);
      process.exit(1);
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
