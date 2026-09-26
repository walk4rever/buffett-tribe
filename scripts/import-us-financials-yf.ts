/**
 * scripts/import-us-financials-yf.ts
 *
 * Imports financials from yfinance for US companies that lack XBRL 10-K/10-Q
 * in SEC CompanyFacts (e.g. Foreign Private Issuers, recent IPOs like Bending Spoons).
 *
 * Usage:
 *   node --env-file=.env.local ./node_modules/.bin/tsx scripts/import-us-financials-yf.ts --ticker BSP
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs";
import * as path from "node:path";
import db from "../src/lib/prisma";
import { Prisma } from "@prisma/client";

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

export async function importUsFinancialsFromYfinance(ticker: string): Promise<number> {
  const upperTicker = ticker.trim().toUpperCase();
  const entity = await db.entity.findFirst({
    where: {
      type: "company",
      market: "us",
      OR: [{ ticker: upperTicker }, { code: upperTicker }],
    },
    select: { id: true, canonicalName: true },
  });

  if (!entity) {
    throw new Error(`Entity not found for US ticker: ${upperTicker}`);
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

  // Create or retrieve stable ExtSource row
  const accessionNumber = "yfinance-financials";
  const extSource = await db.extSource.upsert({
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

  // Deduplicate records by (periodEnd, periodType, lineItem)
  const uniqueRecords = new Map<string, FinancialRecord>();
  for (const r of parsed.records) {
    const key = `${r.periodEnd}|${r.periodType}|${r.lineItem}`;
    if (!uniqueRecords.has(key)) {
      uniqueRecords.set(key, r);
    }
  }

  let written = 0;
  const recordList = Array.from(uniqueRecords.values());
  for (const record of recordList) {
    const periodEndDate = new Date(record.periodEnd);
    if (Number.isNaN(periodEndDate.getTime())) continue;

    await db.financial.upsert({
      where: {
        entityId_periodEnd_periodType_lineItem: {
          entityId: entity.id,
          periodEnd: periodEndDate,
          periodType: record.periodType,
          lineItem: record.lineItem,
        },
      },
      create: {
        entityId: entity.id,
        sourceId: extSource.id,
        periodEnd: periodEndDate,
        periodType: record.periodType,
        lineItem: record.lineItem,
        value: new Prisma.Decimal(record.value),
        unit: record.unit || parsed.currency || "USD",
        confidence: 1,
      },
      update: {
        value: new Prisma.Decimal(record.value),
        unit: record.unit || parsed.currency || "USD",
      },
    });
    written++;
  }

  console.log(`✓ [yfinance] Wrote ${written} financial records for ${upperTicker} (${entity.canonicalName})`);
  return written;
}

async function main() {
  const ticker = getArg("--ticker");
  if (!ticker) {
    console.error("Usage: tsx scripts/import-us-financials-yf.ts --ticker <TICKER>");
    process.exit(1);
  }

  try {
    const count = await importUsFinancialsFromYfinance(ticker);
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
