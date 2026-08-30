/**
 * Import annual 10-K/20-F/40-F filings using edgartools for filing discovery
 * and primary HTML retrieval, while preserving the existing Prisma/R2 storage
 * contract.
 *
 * Usage:
 *   npm run import:10k -- --ticker AAPL --from 2025 --to 2025
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fetchFilingIndexFiles, fetchSecText } from "./lib/filing-archive";
import { ImportTimer } from "./lib/import-timer";
import {
  archiveFilingArtifacts,
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

// upsertFilingSectionsFromHtml() takes a concurrency for its per-section R2 +
// DB writes but defaults to 1 when the caller omits it — this call site never
// passed one, so ~20 sections/filing ran fully serial (each artifact write is
// a Prisma lookup + R2 PutObject + Prisma upsert, all network round trips).
// 6 keeps well under R2/Supabase connection limits while cutting onboarding
// wall-clock meaningfully (see handoff.md "效率问题" P2).
const SECTION_CONCURRENCY = 6;

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
  const filingConcurrency = parsePositiveInt(getArg("--filing-concurrency"), 1);
  const extractTimeoutMs = parsePositiveInt(getArg("--extract-timeout-ms"), 8 * 60 * 1000);
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

  return { ticker, fromYear, toYear, filingConcurrency, extractTimeoutMs, noHtml, python };
}

function runEdgarToolsHelper(params: {
  python: string;
  args: string[];
  timeoutMs: number;
}) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(params.python, params.args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`edgartools helper timed out after ${params.timeoutMs}ms`));
    }, params.timeoutMs);

    child.stdout.on("data", (chunk) => process.stdout.write(chunk));
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(err);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`edgartools helper exited with code ${code ?? "unknown"}`));
    });
  });
}

async function extractWithEdgarTools(params: {
  ticker: string;
  fromYear: number;
  toYear: number;
  python: string;
  extractTimeoutMs: number;
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

    await runEdgarToolsHelper({ python: params.python, args, timeoutMs: params.extractTimeoutMs });

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
  filingConcurrency: number;
  extractTimeoutMs: number;
  noHtml: boolean;
  python: string;
}) {
  const importTimer = new ImportTimer("[10K]");
  const extracted = await importTimer.time(
    "extract edgartools",
    () => extractWithEdgarTools(params),
    (payload) => `filings=${payload.filings.length}`,
  );
  if (!extracted.cik || !extracted.title) {
    throw new Error(`edgartools did not return company identity for ${params.ticker}`);
  }

  const cik = extracted.cik;
  const ticker = extracted.ticker || params.ticker;
  console.log(`Ticker ${ticker} -> CIK ${cik} (${extracted.title}) via edgartools ${extracted.toolVersion ?? "unknown"}`);

  const companyEntity = await importTimer.time("upsert company", () => upsertCompanyEntity(cik, ticker, extracted.title, extracted.profile));
  const facts = await importTimer.time("fetch companyfacts", () => getCompanyFacts(cik));
  const targetFilings = extracted.filings
    .filter((filing) => {
      const y = new Date(filing.reportDate).getUTCFullYear();
      return y >= params.fromYear && y <= params.toYear;
    })
    .sort((a, b) => (a.reportDate < b.reportDate ? 1 : -1));

  console.log(`Found ${targetFilings.length} annual filings from edgartools (${params.fromYear}-${params.toYear})`);
  console.log(
    `Filing concurrency: ${params.filingConcurrency}; archive strategy: standard (primary/index + section text/blocks; attachment metadata only)`,
  );

  await mapLimit(targetFilings, params.filingConcurrency, async (filing) => {
    const filingTimer = new ImportTimer(`[10K ${ticker} ${filing.reportDate} ${filing.accession}]`, "    ");
    const extSource = await filingTimer.time("upsert source", () => upsertExtSource(companyEntity.id, cik, filing));
    const primaryUrl = filing.primaryUrl ?? `${filing.filingUrlBase}/${filing.primaryDocument}`;

    const html = await filingTimer.time(
      filing.html ? "load primary html from edgartools" : "fetch primary html",
      async () => filing.html || await fetchSecText(primaryUrl),
      (body) => `bytes=${Buffer.byteLength(body, "utf8").toLocaleString()}`,
    );
    const inlineDoc = filingTimer.timeSync(
      "parse inline facts",
      () => parseInlineXbrlDocument(html),
      (doc) => `facts=${doc.facts.length}, contexts=${doc.contexts.size}`,
    );

    const sectionCount = await filingTimer.time(
      "extract/store sections",
      () => upsertFilingSectionsFromHtml(
        companyEntity.id,
        extSource.id,
        cik,
        filing.accession,
        html,
        extSource.kind as "10k" | "20f" | "40f",
        primaryUrl,
        filingTimer,
        SECTION_CONCURRENCY,
      ),
      (count) => `sections=${count}`,
    );

    const { html: indexHtml, files: indexFiles } = await filingTimer.time(
      "fetch filing index",
      () => fetchFilingIndexFiles(cik, filing.accession),
      (index) => `files=${index.files.length}`,
    );
    const attachmentSectionCount =
      extSource.kind === "40f"
        ? await filingTimer.time(
            "extract/store 40-F attachment sections",
            () => upsert40FAttachmentSections(companyEntity.id, extSource.id, cik, filing.accession, indexFiles),
            (count) => `sections=${count}`,
          )
        : 0;
    const attachmentCount = await filingTimer.time(
      "store attachments",
      () => upsertFilingAttachments(
        companyEntity.id,
        extSource.id,
        indexFiles.filter((file) => file.category === "attachment"),
      ),
      (count) => `attachments=${count}`,
    );
    await filingTimer.time("archive artifacts", () => archiveFilingArtifacts({
        entityId: companyEntity.id,
        sourceId: extSource.id,
        cik,
        accession: filing.accession,
        primaryDocument: filing.primaryDocument,
        filingUrlBase: filing.filingUrlBase,
        primaryHtml: html,
        indexHtml,
        indexFiles,
      }),
      (artifacts) => `artifacts=${artifacts.length}`,
    );

    await filingTimer.time("update source metadata", () => db.extSource.update({
        where: { id: extSource.id },
        data: {
          metadata: {
            ...(extSource.metadata as Record<string, unknown>),
            // tocJson is intentionally not stored: reader TOC comes from
            // FilingSection.outlineJson; inlining it here ballooned ExtSource to 51MB.
            importedBy: "import-10k-edgartools",
            edgartools: {
              version: extracted.toolVersion,
              indexUrl: filing.indexUrl,
              isXbrl: filing.isXbrl,
              isInlineXbrl: filing.isInlineXbrl,
              attachmentCount,
            },
          },
        },
      }));

    let upserted = 0;
    let missing = 0;
    let fallbackUsed = 0;

    await filingTimer.time("upsert derived financials", async () => {
      const results = await mapLimit(LINE_ITEMS, 5, async (item) => {
        const companyFactsValue = findBestFactValue(
          facts,
          item.tagsUsGaap,
          item.tagsIfrs,
          item.unitCandidates,
          filing.reportDate,
        );

        let value = companyFactsValue;
        let unit = item.unitCandidates[0];
        let usedFallback = false;
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
            usedFallback = true;
          }
        }

        if (value == null) return { upserted: 0, missing: 1, fallbackUsed: 0 };

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
        return { upserted: 1, missing: 0, fallbackUsed: usedFallback ? 1 : 0 };
      });

      for (const result of results) {
        upserted += result.upserted;
        missing += result.missing;
        fallbackUsed += result.fallbackUsed;
      }
    }, () => `derived=${upserted}, missing=${missing}, fallback=${fallbackUsed}`);

    console.log(
      `  ${filing.reportDate} (${filing.accession}) -> sections ${sectionCount}+${attachmentSectionCount}, attachments ${attachmentCount}, derived ${upserted}, missing ${missing}, fallback ${fallbackUsed}`,
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
