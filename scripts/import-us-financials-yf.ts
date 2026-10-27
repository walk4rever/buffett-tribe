/**
 * scripts/import-us-financials-yf.ts
 *
 * Imports financials from yfinance for US companies that lack XBRL 10-K/10-Q
 * in SEC CompanyFacts (e.g. Foreign Private Issuers, recent IPOs like Bending Spoons).
 *
 * Usage:
 *   node --env-file=.env.local ./node_modules/.bin/tsx scripts/import-us-financials-yf.ts --ticker BSP
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs";
import * as path from "node:path";
import db from "../src/lib/prisma";
import { normalizeCurrencyCode } from "../src/lib/fx-rates-core";
import { persistReportingCurrency } from "../src/lib/reporting-currency";
import { upsertFinancialRows } from "./lib/upsert-financial-rows";
import {
  financialRecordKey,
  filterYfinanceFinancialRecords,
} from "./lib/yfinance-financial-record-filter";

const execFileAsync = promisify(execFile);

function getArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

function resolvePythonCmd(): string {
  const venvPy = path.join(process.cwd(), ".venv", "bin", "python");
  if (fs.existsSync(venvPy)) return venvPy;
  const venvPy2 = path.join(process.cwd(), "venv", "bin", "python");
  if (fs.existsSync(venvPy2)) return venvPy2;
  return "python3";
}

interface FinancialRecord {
  periodEnd: string;
  periodType: string;
  lineItem: string;
  value: number;
  unit: string;
}

interface YfOutput {
  ticker: string;
  currency: string;
  records: FinancialRecord[];
}

type ImportOptions = {
  lineItems?: string[];
  missingOnly?: boolean;
  annualOnly?: boolean;
  dryRun?: boolean;
  mappingTag?: string;
  verbose?: boolean;
  excludeZero?: boolean;
};

export function alignFiscalPeriod(
  periodEnd: string,
  existingPeriods: readonly string[],
  toleranceDays = 7,
) {
  const target = new Date(periodEnd).getTime();
  if (!Number.isFinite(target)) return periodEnd;
  let best: { periodEnd: string; distance: number } | null = null;
  for (const existingPeriod of existingPeriods) {
    const distance =
      Math.abs(new Date(existingPeriod).getTime() - target) / 86_400_000;
    if (
      distance <= toleranceDays &&
      (!best || distance < best.distance)
    ) {
      best = { periodEnd: existingPeriod, distance };
    }
  }
  return best?.periodEnd ?? periodEnd;
}

export async function importUsFinancialsFromYfinance(
  ticker: string,
  options: ImportOptions = {},
): Promise<number> {
  const upperTicker = ticker.trim().toUpperCase();
  const entity = await db.entity.findFirst({
    where: {
      type: "company",
      OR: [{ ticker: upperTicker }, { code: upperTicker }],
    },
    select: { id: true, canonicalName: true, market: true, reportingCurrency: true },
  });

  if (!entity) {
    throw new Error(`Entity not found for ticker: ${upperTicker}`);
  }

  const py = resolvePythonCmd();
  const scriptPath = path.join(process.cwd(), "scripts", "fetch-us-financials-yf.py");

  const { stdout } = await execFileAsync(py, [scriptPath, "--ticker", upperTicker], {
    maxBuffer: 10 * 1024 * 1024,
  });

  const parsed: YfOutput = JSON.parse(stdout);
  if (!parsed.records || parsed.records.length === 0) {
    console.log(`[yfinance-financials] No financials returned for ${upperTicker}`);
    return 0;
  }
  const reportingCurrency =
    (options.missingOnly && normalizeCurrencyCode(entity.reportingCurrency)) ||
    normalizeCurrencyCode(parsed.currency);
  if (!options.dryRun && (!options.missingOnly || !entity.reportingCurrency)) {
    await persistReportingCurrency(entity.id, entity.market, reportingCurrency);
  }

  // Create or retrieve stable ExtSource row
  const accessionNumber = "yfinance-financials";
  const extSource = options.dryRun
    ? { id: "dry-run" }
    : await db.extSource.upsert({
        where: {
          ExtSource_filer_accession_unique: {
            filerEntityId: entity.id,
            accessionNumber,
          },
        },
        create: {
          kind: "yfinance",
          filerEntityId: entity.id,
          accessionNumber,
          metadata: {
            ticker: upperTicker,
            source: "yfinance",
            financialCurrency: parsed.currency,
          },
        },
        update: {
          metadata: {
            ticker: upperTicker,
            source: "yfinance",
            financialCurrency: parsed.currency,
            updatedAt: new Date().toISOString(),
          },
        },
      });

  // Clean up legacy non-standard keys if present
  if (!options.dryRun) {
    await db.financial.deleteMany({
      where: {
        entityId: entity.id,
        lineItem: { in: ["DilutedEPS", "BasicEPS", "StockholdersEquity"] },
      },
    });
  }

  const candidateRecords = options.annualOnly
    ? parsed.records.filter((record) => record.periodType === "FY")
    : parsed.records;
  const existingRows = await db.financial.findMany({
    where: {
      entityId: entity.id,
      periodType: "FY",
    },
    select: {
      periodEnd: true,
      periodType: true,
      lineItem: true,
    },
  });
  const existingPeriods = [
    ...new Set(
      existingRows.map((row) =>
        row.periodEnd.toISOString().slice(0, 10),
      ),
    ),
  ];

  // Deduplicate records after aligning source dates to the canonical SEC fiscal
  // period. Providers commonly differ by a few days for the same FY.
  const uniqueRecords = new Map<string, FinancialRecord>();
  for (const r of candidateRecords) {
    const alignedRecord = {
      ...r,
      periodEnd: alignFiscalPeriod(r.periodEnd, existingPeriods),
    };
    const key = financialRecordKey(alignedRecord);
    if (!uniqueRecords.has(key)) {
      uniqueRecords.set(key, alignedRecord);
    }
  }

  const existingKeys = new Set<string>();
  if (options.missingOnly) {
    const requestedLineItems = new Set(
      options.lineItems?.length
        ? options.lineItems
        : candidateRecords.map((record) => record.lineItem),
    );
    for (const row of existingRows) {
      if (!requestedLineItems.has(row.lineItem)) continue;
      existingKeys.add(
        financialRecordKey({
          periodEnd: row.periodEnd.toISOString().slice(0, 10),
          periodType: row.periodType,
          lineItem: row.lineItem,
        }),
      );
    }
  }

  const selectedRecords = filterYfinanceFinancialRecords(
    uniqueRecords.values(),
    {
      lineItems: options.lineItems,
      missingOnly: options.missingOnly,
      existingKeys,
    },
  );

  const rowsToUpsert: Array<{
    entityId: string;
    sourceId: string;
    periodEnd: Date;
    periodType: string;
    lineItem: string;
    value: number;
    unit: string | null;
    mappingRule: string;
    confidence: number;
  }> = [];

  for (const record of selectedRecords) {
    if (options.excludeZero && record.value === 0) continue;
    const periodEndDate = new Date(record.periodEnd);
    if (Number.isNaN(periodEndDate.getTime())) continue;

    const unitToPersist =
      record.unit === "shares" || record.unit?.includes("/shares") || record.unit?.includes("/share")
        ? record.unit
        : (normalizeCurrencyCode(record.unit) ?? reportingCurrency);

    rowsToUpsert.push({
      entityId: entity.id,
      sourceId: extSource.id,
      periodEnd: periodEndDate,
      periodType: record.periodType,
      lineItem: record.lineItem,
      value: record.value,
      unit: unitToPersist,
      mappingRule: `yfinance:standardized:${record.lineItem}${options.mappingTag ?? ""}`,
      confidence: 0.9,
    });
    if (options.verbose) {
      console.log(
        `[yfinance-preview] ${upperTicker} ${record.periodEnd} ${record.periodType} ${record.lineItem}=${record.value} ${unitToPersist ?? ""}`,
      );
    }
  }

  if (!options.dryRun && rowsToUpsert.length > 0) {
    await upsertFinancialRows(db, rowsToUpsert, {
      skipInterimGc: Boolean(options.lineItems?.length),
    });
  }

  const selection = options.lineItems?.length
    ? `, line items: ${options.lineItems.join(", ")}`
    : "";
  const missingOnly = options.missingOnly ? ", missing only" : "";
  const dryRun = options.dryRun ? ", dry run" : "";
  console.log(
    `${options.dryRun ? "○" : "✓"} [yfinance] ${options.dryRun ? "Would write" : "Wrote"} ${rowsToUpsert.length} financial records for ${upperTicker} (${entity.canonicalName}${selection}${missingOnly}${dryRun})`,
  );
  return rowsToUpsert.length;
}

async function main() {
  const ticker = getArg("--ticker");
  const lineItems = getArg("--line-items")
    ?.split(",")
    .map((lineItem) => lineItem.trim())
    .filter(Boolean);
  const missingOnly = process.argv.includes("--missing-only");
  const annualOnly = process.argv.includes("--annual-only");
  const dryRun = process.argv.includes("--dry-run");
  const verbose = process.argv.includes("--verbose");
  const excludeZero = process.argv.includes("--exclude-zero");
  if (!ticker) {
    console.error(
      "Usage: tsx scripts/import-us-financials-yf.ts --ticker <TICKER> [--line-items EPSBasic,EPSDiluted] [--missing-only] [--annual-only] [--dry-run] [--verbose] [--exclude-zero]",
    );
    process.exit(1);
  }

  try {
    const count = await importUsFinancialsFromYfinance(ticker, {
      lineItems,
      missingOnly,
      annualOnly,
      dryRun,
      verbose,
      excludeZero,
    });
    console.log(`Done. ${count} records processed.`);
  } catch (err) {
    console.error("Failed to import financials from yfinance:", err);
    process.exit(1);
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1]?.endsWith("import-us-financials-yf.ts")) {
  main();
}
