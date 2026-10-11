/**
 * Backfill DividendsPaid from SEC CompanyFacts for imported US annual periods.
 * Defaults to dry-run; pass --apply to write missing rows.
 *
 * Usage:
 *   tsx scripts/backfill-dividends-paid.ts --company AAPL [--apply]
 *   tsx scripts/backfill-dividends-paid.ts --all [--apply]
 */

import prisma from "../src/lib/prisma";
import {
  LINE_ITEMS,
  decimalFromNumber,
  findBestFactValue,
  getCompanyFacts,
} from "./lib/annual-report-import-core";

function getDividendsConfig() {
  const item = LINE_ITEMS.find((lineItem) => lineItem.key === "DividendsPaid");
  if (!item) throw new Error("DividendsPaid line item config missing in LINE_ITEMS");
  return item;
}

const DIVIDENDS = getDividendsConfig();

function getArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const companyQuery = getArg("--company");
  const all = hasFlag("--all");
  const dryRun = !hasFlag("--apply") || hasFlag("--dry-run");

  if (!companyQuery && !all) {
    console.error(
      "Usage: tsx scripts/backfill-dividends-paid.ts --company <ticker|cik> | --all [--apply]",
    );
    process.exit(1);
  }

  const entities = await prisma.entity.findMany({
    where: {
      type: "company",
      market: "us",
      cik: { not: null },
      ...(companyQuery
        ? {
            OR: [
              { ticker: companyQuery.toUpperCase() },
              { cik: companyQuery },
              { canonicalName: { contains: companyQuery, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    select: { id: true, cik: true, ticker: true, canonicalName: true },
    orderBy: { canonicalName: "asc" },
  });

  if (!entities.length) {
    console.error(`No US company entities found${companyQuery ? ` for: ${companyQuery}` : ""}`);
    process.exit(1);
  }

  console.log(
    `Backfilling DividendsPaid for ${entities.length} US company(s)${dryRun ? " [DRY-RUN]" : ""}\n`,
  );

  let totalInserted = 0;
  let totalMissingFacts = 0;
  let totalAlreadyPresent = 0;
  let companiesSkipped = 0;

  for (const entity of entities) {
    const label = `${entity.canonicalName}${entity.ticker ? ` (${entity.ticker})` : ""}`;
    const annualRows = await prisma.financial.findMany({
      where: {
        entityId: entity.id,
        periodType: "FY",
        lineItem: "NetIncome",
        periodEnd: { gte: new Date("2020-01-01T00:00:00.000Z") },
      },
      select: { periodEnd: true, sourceId: true },
      orderBy: { periodEnd: "asc" },
    });
    if (!annualRows.length) {
      companiesSkipped += 1;
      continue;
    }

    const existingDividendRows = await prisma.financial.findMany({
      where: { entityId: entity.id, periodType: "FY", lineItem: "DividendsPaid" },
      select: { periodEnd: true },
    });
    const existingPeriods = new Set(
      existingDividendRows.map((row) => row.periodEnd.toISOString().slice(0, 10)),
    );

    let facts: Awaited<ReturnType<typeof getCompanyFacts>>;
    try {
      facts = await getCompanyFacts(entity.cik!);
    } catch (err) {
      console.error(
        `--- ${label}: companyfacts fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    let inserted = 0;
    let missingFacts = 0;
    let alreadyPresent = 0;
    for (const row of annualRows) {
      const reportDate = row.periodEnd.toISOString().slice(0, 10);
      if (existingPeriods.has(reportDate)) {
        alreadyPresent += 1;
        continue;
      }

      const value = findBestFactValue(
        facts,
        DIVIDENDS.tagsUsGaap,
        DIVIDENDS.tagsIfrs,
        DIVIDENDS.unitCandidates,
        reportDate,
      );
      if (value == null) {
        missingFacts += 1;
        continue;
      }

      if (!dryRun) {
        await prisma.financial.create({
          data: {
            entityId: entity.id,
            sourceId: row.sourceId,
            periodEnd: row.periodEnd,
            periodType: "FY",
            lineItem: "DividendsPaid",
            value: decimalFromNumber(value),
            unit: "USD",
            mappingRule: [
              ...DIVIDENDS.tagsUsGaap.map((tag) => `us-gaap:${tag}`),
              ...DIVIDENDS.tagsIfrs.map((tag) => `ifrs-full:${tag}`),
            ].join("|"),
          },
        });
      }
      inserted += 1;
    }

    console.log(
      `--- ${label}: ${inserted} ${dryRun ? "would be " : ""}inserted, ${missingFacts} without a reported fact, ${alreadyPresent} already present`,
    );
    totalInserted += inserted;
    totalMissingFacts += missingFacts;
    totalAlreadyPresent += alreadyPresent;
    await sleep(200);
  }

  console.log(
    `\nDone: ${totalInserted} ${dryRun ? "would be " : ""}inserted, ${totalMissingFacts} without a reported fact, ${totalAlreadyPresent} already present, ${companiesSkipped} companies without FY NetIncome skipped.`,
  );
  if (dryRun) console.log("No database rows were changed. Re-run with --apply to write missing rows.");
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[backfill-dividends-paid] fatal", err);
  await prisma.$disconnect();
  process.exit(1);
});
