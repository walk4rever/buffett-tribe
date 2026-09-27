/**
 * One-off migration: copy the Business Model Canvas out of the legacy
 * CompanyAnalysis.business JSON ({ narrative, canvas }) into the top-level
 * CompanyAnalysis.canvas column.
 *
 * generate-business-model.ts now writes `canvas` directly; this script
 * backfills rows written before that change. The legacy `business` value is
 * left in place (readers still fall back to it); the schema field itself can
 * be dropped in a later migration once nothing reads it.
 *
 * Usage:
 *   tsx scripts/migrate-canvas-field.ts --dry-run
 *   tsx scripts/migrate-canvas-field.ts
 */

import "dotenv/config";
import { Prisma } from "@prisma/client";
import { disconnectPrisma, hasFlag, jsonObject, prisma, toJsonValue } from "./lib/company-generation";

async function main() {
  const dryRun = hasFlag("--dry-run");
  const rows = await prisma.companyAnalysis.findMany({
    where: { canvas: { equals: Prisma.DbNull } },
    select: { entityId: true, business: true },
  });

  let migrated = 0;
  for (const row of rows) {
    const business = jsonObject(row.business);
    const canvas = jsonObject(business?.canvas);
    if (!canvas || Object.keys(canvas).length === 0) continue;
    migrated++;
    if (!dryRun) {
      await prisma.companyAnalysis.update({
        where: { entityId: row.entityId },
        data: { canvas: toJsonValue(canvas) },
      });
    }
  }

  console.log(
    `${dryRun ? "DRY-RUN: would migrate" : "Migrated"} ${migrated} row(s) ` +
      `(scanned ${rows.length} with null canvas)`,
  );
  await disconnectPrisma();
}

main().catch(async (err) => {
  console.error("[migrate-canvas-field] fatal", err);
  await disconnectPrisma();
  process.exit(1);
});
