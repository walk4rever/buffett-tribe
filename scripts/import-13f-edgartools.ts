/**
 * Import 13F-HR holdings using edgartools for filing discovery and holdings
 * extraction, while preserving the existing database storage contract.
 */
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  db,
  FILERS,
  importFiling,
  normalizeCusip,
  parseQuarterListArg,
  parseQuarterToken,
  parseReportDate,
  quarterKey,
  quarterRange,
  seedEntityCache,
  upsertFilerEntity,
  type InfoTableEntry,
} from "./lib/13f-import-core";

type EdgarTools13FFiling = {
  accession: string;
  filedAt: string;
  reportDate: string;
  form: string;
  company: string | null;
  cik: string | null;
  url: string | null;
  totalHoldings: number;
  totalValue: string;
  holdings: Array<{
    nameOfIssuer: string;
    titleOfClass: string;
    cusip: string;
    ticker?: string | null;
    value: string;
    shares: string;
    investmentDiscretion: string;
    putCall?: string | null;
  }>;
};

type EdgarTools13FPayload = {
  tool: "edgartools";
  toolVersion: string | null;
  cik: string;
  filings: EdgarTools13FFiling[];
};

function getArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  return args.find((_, i) => args[i - 1] === flag);
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer: ${value}`);
  }
  return parsed;
}

function parseArgs() {
  const filerArg = getArg("--filer") ?? getArg("--investor");
  const quartersArg = getArg("--quarters");
  const quarterListArg = getArg("--quarter-list") ?? getArg("--quarters-list");
  const fromArg = getArg("--from");
  const toArg = getArg("--to");
  const python = getArg("--python") ?? (process.env.EDGARTOOLS_PYTHON || path.join(process.cwd(), ".venv/bin/python"));
  const maxQuarters = parsePositiveInt(quartersArg, 4);

  if (quarterListArg && (fromArg || toArg)) throw new Error("Use either --quarter-list or --from/--to, not both.");
  if ((fromArg && !toArg) || (!fromArg && toArg)) throw new Error("Both --from and --to are required when using quarter range mode.");

  let quarterList: Array<{ year: number; quarter: number }> = [];
  if (quarterListArg) {
    quarterList = parseQuarterListArg(quarterListArg);
  } else if (fromArg && toArg) {
    const from = parseQuarterToken(fromArg);
    const to = parseQuarterToken(toArg);
    if (!from || !to) throw new Error("Invalid --from/--to value. Use format like 2024Q1, 2025Q4.");
    quarterList = quarterRange(from, to);
  }

  const filersToRun = filerArg ? FILERS.filter((f) => f.tribeId === filerArg) : [...FILERS];
  if (filerArg && filersToRun.length === 0) {
    throw new Error(`Unknown filer: ${filerArg}. Use buffett, lilu, or duan.`);
  }

  return { filersToRun, maxQuarters, quarterList, python };
}

async function extractWithEdgarTools(params: {
  cik: string;
  maxFilings: number;
  python: string;
}) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "buffett-13f-edgartools-"));
  const outputPath = path.join(tempDir, "13f.json");
  try {
    const res = spawnSync(params.python, [
      "scripts/edgartools_13f_extract.py",
      "--cik",
      params.cik,
      "--max-filings",
      String(params.maxFilings),
      "--output",
      outputPath,
    ], {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    if (res.stdout) process.stdout.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);
    if (res.status !== 0) {
      throw new Error(`edgartools 13F helper exited with code ${res.status ?? "unknown"}`);
    }
    return JSON.parse(await readFile(outputPath, "utf8")) as EdgarTools13FPayload;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function toEntry(row: EdgarTools13FFiling["holdings"][number]): InfoTableEntry {
  return {
    nameOfIssuer: row.nameOfIssuer,
    titleOfClass: row.titleOfClass,
    cusip: normalizeCusip(row.cusip),
    ticker: row.ticker ?? null,
    value: BigInt(row.value || "0"),
    shares: BigInt(row.shares || "0"),
    investmentDiscretion: row.investmentDiscretion || "SOLE",
    putCall: row.putCall || undefined,
  };
}

function filterFilings(params: {
  filings: EdgarTools13FFiling[];
  quarterList: Array<{ year: number; quarter: number }>;
}) {
  const { filings, quarterList } = params;
  if (!quarterList.length) return filings;

  const quarterSet = new Set(quarterList.map((q) => quarterKey(q.year, q.quarter)));
  return filings.filter((filing) => {
    const { year, quarter } = parseReportDate(filing.reportDate);
    return quarterSet.has(quarterKey(year, quarter));
  });
}

function warnMissingQuarters(params: {
  requested: Array<{ year: number; quarter: number }>;
  filings: EdgarTools13FFiling[];
}) {
  if (!params.requested.length) return;
  const foundSet = new Set(params.filings.map((filing) => {
    const { year, quarter } = parseReportDate(filing.reportDate);
    return quarterKey(year, quarter);
  }));
  const missing = params.requested.map((q) => quarterKey(q.year, q.quarter)).filter((key) => !foundSet.has(key));
  if (missing.length) console.warn(`  Missing requested quarters in fetched window: ${missing.join(", ")}`);
}

async function main() {
  const { filersToRun, maxQuarters, quarterList, python } = parseArgs();
  await seedEntityCache();

  for (const filer of filersToRun) {
    console.log(`\n── ${filer.name} (CIK ${filer.cik}) ──`);
    const filerEntity = await upsertFilerEntity(filer);
    console.log(`  Entity: ${filerEntity.id}`);

    const fetchCount = quarterList.length > 0 ? 120 : maxQuarters;
    const payload = await extractWithEdgarTools({ cik: filer.cik, maxFilings: fetchCount, python });
    console.log(`  Found ${payload.filings.length} 13F filings via edgartools ${payload.toolVersion ?? "unknown"} (fetched window: ${fetchCount})`);

    const filingsToImport = filterFilings({ filings: payload.filings, quarterList });
    warnMissingQuarters({ requested: quarterList, filings: filingsToImport });

    for (const filing of filingsToImport) {
      console.log(`  Filing ${filing.accession} (${filing.reportDate}, filed ${filing.filedAt})`);
      try {
        const started = Date.now();
        const entries = filing.holdings.map(toEntry).filter((entry) => entry.cusip);
        console.log(`    Parsed ${entries.length} positions`);
        if (!entries.length) {
          console.warn("    No positions parsed - check edgartools 13F object");
          continue;
        }

        const { imported, year, quarter } = await importFiling(
          filerEntity.id,
          filing.accession,
          filer.cik,
          filing.filedAt,
          filing.reportDate,
          entries,
        );
        const elapsed = ((Date.now() - started) / 1000).toFixed(1);
        console.log(`    ✓ ${imported} holdings saved for Q${quarter} ${year} (${elapsed}s)`);
      } catch (err) {
        console.error(`    ✗ Error: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  console.log("\nDone.");
}

main()
  .catch((err) => {
    console.error("[import-13f-edgartools] fatal", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
