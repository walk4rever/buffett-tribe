/**
 * Backfill annual period-end shares for the CN/HK validation universe.
 *
 * CN uses AkShare/Sina's explicit `outstanding_share` field. HK uses the
 * standardized yfinance share-count column. Both paths are missing-only,
 * default to dry-run, and require a batch id for writes so rows can be rolled
 * back by batch.
 *
 * Usage:
 *   npm run backfill:market-shares
 *   npm run backfill:market-shares -- --market hk
 *   npm run backfill:market-shares -- --execute --batch-id shares-20261026
 */
import { execFile } from "node:child_process";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { Prisma } from "@prisma/client";
import db from "../src/lib/prisma";
import { importUsFinancialsFromYfinance } from "./import-us-financials-yf";
import { buildStrictBatchTag } from "./rollback-batch-financials";
import { upsertFinancialRows } from "./lib/upsert-financial-rows";

const execFileAsync = promisify(execFile);
const SUITE_PATH = path.join(
  process.cwd(),
  "scripts",
  "lib",
  "metric-validation-suite.json",
);

type SuiteCompany = {
  ticker: string;
  market: "us" | "cn" | "hk";
};

type CnShareRecord = {
  periodEnd: string;
  periodType: string;
  lineItem: "CommonStockSharesOutstanding";
  value: number;
};

type Args = {
  market: "all" | "cn" | "hk";
  execute: boolean;
  batchId?: string;
  fromYear: number;
  tickers?: Set<string>;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const valueAfter = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const market = valueAfter("--market") ?? "all";
  if (!["all", "cn", "hk"].includes(market)) {
    throw new Error(`Unsupported --market ${market}; expected cn, hk or all`);
  }
  const execute = argv.includes("--execute");
  const batchId = valueAfter("--batch-id")?.trim();
  if (execute && (!batchId || !/^[a-zA-Z0-9_-]+$/.test(batchId))) {
    throw new Error("--execute requires a safe --batch-id");
  }
  const tickerList = valueAfter("--tickers") ?? valueAfter("--ticker");
  const fromYear = Number(valueAfter("--from-year") ?? 2021);
  if (!Number.isInteger(fromYear) || fromYear < 1990 || fromYear > 2030) {
    throw new Error("--from-year must be an integer between 1990 and 2030");
  }
  return {
    market: market as Args["market"],
    execute,
    batchId,
    fromYear,
    tickers: tickerList
      ? new Set(tickerList.split(",").map((ticker) => ticker.trim()))
      : undefined,
  };
}

async function targetCompanies(args: Args) {
  const marketFilter = args.market === "all" ? undefined : args.market;
  if (args.tickers?.size) {
    return db.entity.findMany({
      where: {
        type: "company",
        ...(marketFilter ? { market: marketFilter } : { market: { in: ["cn", "hk"] } }),
        ticker: { in: [...args.tickers] },
      },
      select: {
        id: true,
        ticker: true,
        code: true,
        market: true,
        canonicalName: true,
      },
      orderBy: [{ market: "asc" }, { ticker: "asc" }],
    });
  }
  const suite = JSON.parse(
    readFileSync(SUITE_PATH, "utf8"),
  ) as { companies: SuiteCompany[] };
  const validationTickers = suite.companies
    .filter(
      (company) =>
        ["cn", "hk"].includes(company.market) &&
        (!marketFilter || company.market === marketFilter),
    )
    .map((company) => company.ticker);
  return db.entity.findMany({
    where: {
      type: "company",
      ticker: { in: validationTickers },
    },
    select: {
      id: true,
      ticker: true,
      code: true,
      market: true,
      canonicalName: true,
    },
    orderBy: [{ market: "asc" }, { ticker: "asc" }],
  });
}

async function backfillCn(
  companies: Awaited<ReturnType<typeof targetCompanies>>,
  args: Args,
) {
  if (!companies.length) return { planned: 0, written: 0 };
  const python = process.env.PYTHON ?? ".venv/bin/python";
  const codesFile = `/tmp/metric-share-codes-${process.pid}.json`;
  const outputFile = `/tmp/metric-share-output-${process.pid}.json`;
  const codes = companies.map((company) => company.code).filter(Boolean);
  writeFileSync(codesFile, JSON.stringify(codes), "utf8");
  try {
    await execFileAsync(
      python,
      [
        "scripts/extract-cn-shares.py",
        "--codes",
        codesFile,
        "--out",
        outputFile,
        "--from-year",
        String(args.fromYear),
      ],
      { maxBuffer: 10 * 1024 * 1024 },
    );
    const extracted = JSON.parse(
      readFileSync(outputFile, "utf8"),
    ) as Record<string, CnShareRecord[]>;
    const batchTag = args.batchId ? buildStrictBatchTag(args.batchId) : "";
    const pending: Array<Prisma.FinancialCreateManyInput & { ticker: string }> = [];

    for (const company of companies) {
      const records = (extracted[company.code ?? ""] ?? []).filter(
        (record) => record.periodType === "FY" && record.value > 0,
      );
      if (!records.length) continue;
      const existing = await db.financial.findMany({
        where: {
          entityId: company.id,
          periodType: "FY",
          lineItem: "CommonStockSharesOutstanding",
        },
        select: { periodEnd: true },
      });
      const existingPeriods = new Set(
        existing.map((row) => row.periodEnd.toISOString().slice(0, 10)),
      );
      const missing = records.filter(
        (record) => !existingPeriods.has(record.periodEnd),
      );
      if (!missing.length) continue;

      const source = args.execute
        ? await db.extSource.upsert({
            where: {
              ExtSource_filer_accession_unique: {
                filerEntityId: company.id,
                accessionNumber: "akshare-market-shares",
              },
            },
            create: {
              kind: "akshare",
              filerEntityId: company.id,
              accessionNumber: "akshare-market-shares",
              metadata: {
                ticker: company.ticker,
                source: "stock_zh_a_daily.outstanding_share",
              },
            },
            update: {},
          })
        : null;
      for (const record of missing) {
        pending.push({
          ticker: company.ticker ?? company.id,
          entityId: company.id,
          sourceId: source?.id ?? "dry-run",
          periodEnd: new Date(`${record.periodEnd}T00:00:00.000Z`),
          periodType: "FY",
          lineItem: "CommonStockSharesOutstanding",
          value: record.value,
          unit: "shares",
          mappingRule: `akshare:stock_zh_a_daily:outstanding_share${batchTag}`,
          confidence: 1,
        });
      }
    }

    for (const row of pending.slice(0, 10)) {
      const periodEnd =
        row.periodEnd instanceof Date
          ? row.periodEnd.toISOString().slice(0, 10)
          : String(row.periodEnd).slice(0, 10);
      console.log(
        `[cn] ${row.ticker} ${periodEnd} shares=${row.value}`,
      );
    }
    if (!args.execute || !pending.length) {
      return { planned: pending.length, written: 0 };
    }
    const written = await upsertFinancialRows(
      db,
      pending.map((row) => ({
        entityId: row.entityId,
        sourceId: row.sourceId,
        periodEnd: row.periodEnd,
        periodType: row.periodType,
        lineItem: row.lineItem,
        value: row.value,
        unit: row.unit,
        mappingRule: row.mappingRule,
        confidence: row.confidence,
      })),
      { skipInterimGc: true },
    );
    return { planned: pending.length, written };
  } finally {
    for (const file of [codesFile, outputFile]) {
      try {
        unlinkSync(file);
      } catch {
        // The extractor may not have reached the output file.
      }
    }
  }
}

async function backfillHk(
  companies: Awaited<ReturnType<typeof targetCompanies>>,
  args: Args,
) {
  let written = 0;
  for (const company of companies) {
    if (!company.ticker) continue;
    const count = await importUsFinancialsFromYfinance(company.ticker, {
      lineItems: ["CommonStockSharesOutstanding"],
      missingOnly: true,
      annualOnly: true,
      dryRun: !args.execute,
      mappingTag: args.batchId
        ? buildStrictBatchTag(args.batchId)
        : undefined,
    });
    written += count;
  }
  return { planned: written, written: args.execute ? written : 0 };
}

async function main() {
  const args = parseArgs();
  const companies = await targetCompanies(args);
  const cn = companies.filter((company) => company.market === "cn");
  const hk = companies.filter((company) => company.market === "hk");
  console.log(
    `Market shares: ${companies.length} companies, ${args.execute ? "EXECUTE" : "DRY-RUN"}`,
  );
  const cnResult = cn.length ? await backfillCn(cn, args) : { planned: 0, written: 0 };
  const hkResult = hk.length ? await backfillHk(hk, args) : { planned: 0, written: 0 };
  console.log(
    `Planned CN/HK rows: ${cnResult.planned}/${hkResult.planned}; written: ${cnResult.written}/${hkResult.written}`,
  );
}

main()
  .catch((error) => {
    console.error("Market share backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
