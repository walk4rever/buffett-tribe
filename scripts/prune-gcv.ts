/**
 * Prune GeneratedContentVersion: keep the latest N versions per (scopeType, scopeId, artifactType).
 * Safe to re-run; only deletes older versions beyond the retention window.
 *
 * Usage:
 *   tsx scripts/prune-gcv.ts             # dry-run (default)
 *   tsx scripts/prune-gcv.ts --apply     # actually delete
 *   tsx scripts/prune-gcv.ts --keep 3    # retain 3 versions (default: 2)
 */

import prisma from "../src/lib/prisma";

function parseKeep(): number {
  const idx = process.argv.indexOf("--keep");
  if (idx !== -1 && process.argv[idx + 1]) {
    const n = parseInt(process.argv[idx + 1], 10);
    if (!isNaN(n) && n > 0) return n;
  }
  return 2;
}

const KEEP = parseKeep();
const DRY_RUN = !process.argv.includes("--apply");

type GroupRow = { scopeType: string; scopeId: string; artifactType: string; cnt: bigint };

async function main() {
  if (DRY_RUN) console.log("[prune-gcv] dry-run mode (pass --apply to delete)");

  const groups = await prisma.$queryRaw<GroupRow[]>`
    SELECT "scopeType", "scopeId", "artifactType", COUNT(*) AS cnt
    FROM "GeneratedContentVersion"
    GROUP BY "scopeType", "scopeId", "artifactType"
    HAVING COUNT(*) > ${KEEP}
  `;

  let totalDeleted = 0;

  for (const g of groups) {
    const toDelete = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "GeneratedContentVersion"
      WHERE "scopeType" = ${g.scopeType}
        AND "scopeId"   = ${g.scopeId}
        AND "artifactType" = ${g.artifactType}
      ORDER BY "versionSeq" DESC
      OFFSET ${KEEP}
    `;

    if (toDelete.length === 0) continue;

    const ids = toDelete.map((r) => r.id);
    console.log(
      `[prune-gcv] ${g.artifactType}/${g.scopeId}: keep ${KEEP}, deleting ${ids.length} old version(s)`,
    );

    if (!DRY_RUN) {
      await prisma.generatedContentVersion.deleteMany({ where: { id: { in: ids } } });
    }
    totalDeleted += ids.length;
  }

  if (totalDeleted === 0) {
    console.log(`[prune-gcv] nothing to prune (all groups have ≤${KEEP} versions)`);
  } else {
    console.log(`[prune-gcv] ${DRY_RUN ? "would delete" : "deleted"} ${totalDeleted} rows`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[prune-gcv] fatal", err);
  await prisma.$disconnect();
  process.exit(1);
});
