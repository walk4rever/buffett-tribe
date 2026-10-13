/**
 * Reconcile AIA's official reporting currency with AkShare's value units.
 *
 * AkShare HK statements are stored in CNY for AIA, while AIA's official
 * reporting currency is USD. This script changes unit labels only.
 *
 * Usage:
 *   npm run repair:aia-currency
 *   npm run repair:aia-currency -- --apply --confirm-akshare-data-cny
 */

import prisma from "../src/lib/prisma";
import { getAiaCorrectedFinancialUnit } from "./lib/aia-currency-repair-core";

async function main() {
  const apply = process.argv.includes("--apply");
  const confirmed = process.argv.includes("--confirm-akshare-data-cny");
  if (apply && !confirmed) {
    throw new Error(
      "Applying this unit-only repair requires --confirm-akshare-data-cny.",
    );
  }

  const entities = await prisma.entity.findMany({
    where: {
      type: "company",
      OR: [{ ticker: "1299.HK" }, { code: "01299" }],
    },
    select: { id: true, ticker: true, code: true, canonicalName: true, reportingCurrency: true },
  });
  if (entities.length !== 1) {
    throw new Error(`Expected one AIA entity, found ${entities.length}.`);
  }

  const entity = entities[0];
  const sources = await prisma.extSource.findMany({
    where: { filerEntityId: entity.id, kind: "akshare" },
    select: { id: true },
  });
  const sourceIds = sources.map((source) => source.id);
  const rows = sourceIds.length
    ? await prisma.financial.findMany({
        where: { entityId: entity.id, sourceId: { in: sourceIds } },
        select: { id: true, lineItem: true, periodEnd: true, periodType: true, value: true, unit: true },
        orderBy: [{ periodEnd: "asc" }, { lineItem: "asc" }],
      })
    : [];

  const unitCounts = new Map<string, number>();
  const rowsToRelabel = new Map<string, number>();
  for (const row of rows) {
    const unit = row.unit ?? "(null)";
    unitCounts.set(unit, (unitCounts.get(unit) ?? 0) + 1);
    const correctedUnit = getAiaCorrectedFinancialUnit(row.unit);
    if (correctedUnit && correctedUnit !== row.unit) {
      rowsToRelabel.set(row.unit!, (rowsToRelabel.get(row.unit!) ?? 0) + 1);
    }
  }

  console.log(`AIA ${entity.ticker ?? entity.code} (${entity.canonicalName})`);
  console.log(`Entity.reportingCurrency: ${entity.reportingCurrency ?? "(null)"} -> USD`);
  console.log(`AkShare financial rows: ${rows.length}`);
  console.log("Current units:", Object.fromEntries(unitCounts));
  console.log(
    "Rows to relabel:",
    Object.fromEntries(rowsToRelabel),
  );
  console.log("Numeric values will not be changed.");

  if (apply) {
    await prisma.$transaction(async (tx) => {
      await tx.entity.update({
        where: { id: entity.id },
        data: { reportingCurrency: "USD" },
      });
      for (const [oldUnit] of rowsToRelabel) {
        const newUnit = getAiaCorrectedFinancialUnit(oldUnit);
        if (!newUnit) continue;
        await tx.financial.updateMany({
          where: {
            entityId: entity.id,
            sourceId: { in: sourceIds },
            unit: oldUnit,
          },
          data: { unit: newUnit },
        });
      }
    });

    const verification = await prisma.financial.groupBy({
      by: ["unit"],
      where: { entityId: entity.id, sourceId: { in: sourceIds } },
      _count: { _all: true },
    });
    console.log(
      "Verified units:",
      Object.fromEntries(verification.map((row) => [row.unit ?? "(null)", row._count._all])),
    );
  } else {
    console.log("Dry run only. No database rows were changed.");
  }
}

main()
  .catch((error) => {
    console.error("[repair-aia-currency] fatal", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
