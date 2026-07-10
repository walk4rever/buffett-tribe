/**
 * Backfill CapEx Financial rows for already-imported companies.
 * One SEC companyfacts API request per company — no 10-K re-import needed.
 * For each existing FY OperatingCashFlow row, looks up CapEx at the same
 * periodEnd and upserts it with the same sourceId (same filing lineage).
 *
 * Usage:
 *   tsx scripts/backfill-capex.ts --company MCO [--dry-run]
 *   tsx scripts/backfill-capex.ts --all [--dry-run]
 */

import prisma from "../src/lib/prisma";
import {
  LINE_ITEMS,
  decimalFromNumber,
  findBestFactValue,
  getCompanyFacts,
} from "./lib/annual-report-import-core";

function requireLineItem(key: string): (typeof LINE_ITEMS)[number] {
  const item = LINE_ITEMS.find((i) => i.key === key);
  if (!item) throw new Error(`${key} line item config missing in LINE_ITEMS`);
  return item;
}

const CAPEX = requireLineItem("CapEx");

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
  const dryRun = hasFlag("--dry-run");

  if (!companyQuery && !all) {
    console.error("Usage: tsx scripts/backfill-capex.ts --company <ticker|cik> | --all [--dry-run]");
    process.exit(1);
  }

  const entities = await prisma.entity.findMany({
    where: {
      type: "company",
      cik: { not: null },
      ...(companyQuery
        ? {
            OR: [
              { ticker: companyQuery.toUpperCase() },
              { cik: companyQuery },
              { canonicalName: { contains: companyQuery, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: { id: true, cik: true, ticker: true, canonicalName: true },
    orderBy: { canonicalName: "asc" },
  });

  if (!entities.length) {
    console.error(`No company entities found${companyQuery ? ` for: ${companyQuery}` : ""}`);
    process.exit(1);
  }

  console.log(`Backfilling CapEx for ${entities.length} company(s)${dryRun ? " [DRY-RUN]" : ""}\n`);

  let totalUpserted = 0;
  let totalMissing = 0;
  let companiesSkipped = 0;

  for (const entity of entities) {
    const label = `${entity.canonicalName}${entity.ticker ? ` (${entity.ticker})` : ""}`;

    const ocfRows = await prisma.financial.findMany({
      where: { entityId: entity.id, periodType: "FY", lineItem: "OperatingCashFlow" },
      select: { periodEnd: true, sourceId: true },
      orderBy: { periodEnd: "asc" },
    });
    if (!ocfRows.length) {
      companiesSkipped += 1;
      continue;
    }

    let facts: Awaited<ReturnType<typeof getCompanyFacts>>;
    try {
      facts = await getCompanyFacts(entity.cik!);
    } catch (err) {
      console.error(`--- ${label}: companyfacts fetch failed: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    let upserted = 0;
    let missing = 0;
    for (const row of ocfRows) {
      const reportDate = row.periodEnd.toISOString().slice(0, 10);
      const value = findBestFactValue(facts, CAPEX.tagsUsGaap, CAPEX.tagsIfrs, CAPEX.unitCandidates, reportDate);
      if (value == null) {
        missing += 1;
        continue;
      }
      if (!dryRun) {
        await prisma.financial.upsert({
          where: {
            entityId_periodEnd_periodType_lineItem: {
              entityId: entity.id,
              periodEnd: row.periodEnd,
              periodType: "FY",
              lineItem: "CapEx",
            },
          },
          create: {
            entityId: entity.id,
            sourceId: row.sourceId,
            periodEnd: row.periodEnd,
            periodType: "FY",
            lineItem: "CapEx",
            value: decimalFromNumber(value),
            unit: "USD",
            mappingRule: CAPEX.tagsUsGaap.map((t) => `us-gaap:${t}`).join("|"),
          },
          update: {
            value: decimalFromNumber(value),
            unit: "USD",
          },
        });
      }
      upserted += 1;
    }

    console.log(`--- ${label}: ${upserted} CapEx rows${dryRun ? " (would be) " : " "}upserted, ${missing} FY periods without CapEx facts`);
    totalUpserted += upserted;
    totalMissing += missing;

    // SEC fair-use rate limit (10 req/s allowed; stay well under)
    await sleep(200);
  }

  console.log(`\nDone: ${totalUpserted} upserted, ${totalMissing} missing, ${companiesSkipped} companies without FY OCF skipped.`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[backfill-capex] fatal", err);
  await prisma.$disconnect();
  process.exit(1);
});
