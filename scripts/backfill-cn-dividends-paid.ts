/**
 * Preview or backfill A-share DividendsPaid rows from structured AkShare data.
 * Defaults to read-only; existing conflicting values are never overwritten.
 *
 * Usage:
 *   npm run backfill:cn-dividends:dry -- --company 600519
 *   npm run backfill:cn-dividends:dry -- --all --limit 10
 *   npm run backfill:cn-dividends -- --company 600519 --apply
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Prisma } from "@prisma/client";
import db from "../src/lib/prisma";

type FinancialRecord = {
  periodEnd: string;
  periodType: "FY";
  lineItem: "DividendsPaid";
  value: number | null;
  unit: "CNY";
  mappingRule?: string;
  confidence?: number;
  sourcePrecision?: number | null;
};

type CompanyRecord = {
  id: string;
  ticker: string | null;
  code: string;
  canonicalName: string;
};

function getArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function parseLimit(): number | undefined {
  const raw = getArg("--limit");
  if (!raw) return undefined;
  const limit = Number.parseInt(raw, 10);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("--limit must be a positive integer");
  }
  return limit;
}

function fetchAkShareDividends(code: string): FinancialRecord[] {
  const tempDir = mkdtempSync(path.join(tmpdir(), `cn-akshare-dividends-${code}-`));
  const python =
    process.env.PYTHON ??
    (existsSync(path.resolve(".venv/bin/python"))
      ? path.resolve(".venv/bin/python")
      : "python3");
  const jsonPath = path.join(tempDir, `${code}.json`);

  try {
    execFileSync(
      python,
      [
        "scripts/fetch-cn-hk-financials-ak.py",
        "--code",
        code,
        "--market",
        "cn",
        "--currency",
        "CNY",
        "--from-year",
        "2020",
        "--dividends-only",
        "--out-dir",
        tempDir,
        "--keep-file",
      ],
      { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return JSON.parse(readFileSync(jsonPath, "utf8")) as FinancialRecord[];
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function periodKey(periodEnd: Date): string {
  return periodEnd.toISOString().slice(0, 10);
}

async function main() {
  const companyQuery = getArg("--company");
  const all = hasFlag("--all");
  const dryRun = !hasFlag("--apply") || hasFlag("--dry-run");
  const limit = parseLimit();

  if ((!companyQuery && !all) || (companyQuery && all)) {
    throw new Error(
      "Usage: backfill-cn-dividends-paid.ts --company <code|ticker|name> | --all [--limit N] [--apply]",
    );
  }

  const rawCompanies = await db.entity.findMany({
    where: {
      type: "company",
      market: "cn",
      code: { not: null },
      financials: {
        some: {
          periodType: "FY",
          periodEnd: { gte: new Date("2020-01-01T00:00:00.000Z") },
        },
      },
      ...(companyQuery
        ? {
            OR: [
              { code: companyQuery },
              { ticker: companyQuery.toUpperCase() },
              { canonicalName: { contains: companyQuery, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    select: { id: true, ticker: true, code: true, canonicalName: true },
    orderBy: { code: "asc" },
  });
  const companies = (limit ? rawCompanies.slice(0, limit) : rawCompanies) as CompanyRecord[];
  if (!companies.length) {
    throw new Error(`No onboarded A-share companies found${companyQuery ? ` for ${companyQuery}` : ""}`);
  }

  console.log(
    `A-share AkShare DividendsPaid: ${companies.length} company(s) [${dryRun ? "DRY-RUN" : "APPLY"}]`,
  );
  const preview: Array<Record<string, unknown>> = [];
  let hasFailures = false;

  for (const company of companies) {
    const label = `${company.canonicalName} (${company.code})`;
    try {
      const records = fetchAkShareDividends(company.code);
      const existingRows = await db.financial.findMany({
        where: {
          entityId: company.id,
          periodType: "FY",
          lineItem: "DividendsPaid",
          periodEnd: { gte: new Date("2020-01-01T00:00:00.000Z") },
        },
        select: { periodEnd: true, value: true },
      });
      const existingByPeriod = new Map(
        existingRows.map((row) => [periodKey(row.periodEnd), row.value?.toNumber() ?? null]),
      );

      let sourceId: string | null = null;
      const rows = [];
      for (const record of records) {
        const existingValue = existingByPeriod.get(record.periodEnd);
        const hasExisting = existingByPeriod.has(record.periodEnd);
        const tolerance = (record.sourcePrecision ?? 0) / 2 + 1;
        let action: string;

        if (record.value === null) {
          action = "unresolved-amount";
        } else if (hasExisting && existingValue !== null && existingValue !== undefined) {
          action =
            Math.abs(existingValue - record.value) <= tolerance
              ? "already-current-at-source-precision"
              : "existing-value-conflict";
        } else {
          action = hasExisting ? "fill-null" : "upsert";
        }

        if (
          !dryRun &&
          record.value !== null &&
          (action === "upsert" || action === "fill-null")
        ) {
          if (!sourceId) {
            const source = await db.extSource.upsert({
              where: {
                ExtSource_filer_accession_unique: {
                  filerEntityId: company.id,
                  accessionNumber: "akshare-annual",
                },
              },
              create: {
                kind: "akshare",
                filerEntityId: company.id,
                accessionNumber: "akshare-annual",
                metadata: {
                  ticker: company.ticker,
                  market: "cn",
                  code: company.code,
                  dividendDataSources: ["CNINFO", "THS via AkShare"],
                },
              },
              update: {
                metadata: {
                  ticker: company.ticker,
                  market: "cn",
                  code: company.code,
                  dividendDataSources: ["CNINFO", "THS via AkShare"],
                },
              },
              select: { id: true },
            });
            sourceId = source.id;
          }

          const periodEnd = new Date(`${record.periodEnd}T00:00:00.000Z`);
          await db.financial.upsert({
            where: {
              entityId_periodEnd_periodType_lineItem: {
                entityId: company.id,
                periodEnd,
                periodType: "FY",
                lineItem: "DividendsPaid",
              },
            },
            create: {
              entityId: company.id,
              sourceId,
              periodEnd,
              periodType: "FY",
              lineItem: "DividendsPaid",
              value: new Prisma.Decimal(record.value),
              unit: record.unit,
              mappingRule: record.mappingRule,
              confidence: record.confidence,
            },
            update: {
              sourceId,
              value: new Prisma.Decimal(record.value),
              unit: record.unit,
              mappingRule: record.mappingRule,
              confidence: record.confidence,
            },
          });
        }

        rows.push({
          periodEnd: record.periodEnd,
          value: record.value,
          sourcePrecision: record.sourcePrecision,
          action,
        });
      }

      preview.push({
        company: label,
        implementedPaymentYears: records.length,
        rows,
        issues: rows.filter(
          (row) =>
            row.action === "unresolved-amount" ||
            row.action === "existing-value-conflict",
        ),
      });
      console.log(`--- ${label}: ${rows.length} FY row(s)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      hasFailures = true;
      preview.push({ company: label, error: message });
      console.error(`--- ${label}: failed: ${message}`);
    }
  }

  const outputPath =
    getArg("--output") ??
    path.join(
      tmpdir(),
      `cn-akshare-dividends-${dryRun ? "preview" : "apply"}-${new Date()
        .toISOString()
        .replace(/[:.]/g, "-")}.json`,
    );
  writeFileSync(
    outputPath,
    JSON.stringify(
      { generatedAt: new Date().toISOString(), mode: dryRun ? "dry-run" : "apply", companies: preview },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`\nPreview written to ${outputPath}`);
  if (dryRun) {
    console.log("No database rows were changed. Review the preview before passing --apply.");
  }
  if (hasFailures) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("[backfill-cn-dividends-paid] fatal", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
