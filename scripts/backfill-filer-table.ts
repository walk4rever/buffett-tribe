/**
 * backfill-filer-table.ts
 *
 * One-time (idempotent) backfill: create/update a Filer row for each of the
 * 5 tracked FILERS. filerEntityId always points at the existing
 * Entity(type="master", tribeId=...) row. companyEntityId is set only when
 * a matching Entity(type="company") row exists for that filer's CIK — today
 * that's true only for buffett (Berkshire Hathaway is both the 13F filer
 * and a public company). See TODOS.md「Filer / Company 拆分」for background.
 *
 * Usage:
 *   npm run backfill:filer-table -- --dry-run
 *   npm run backfill:filer-table
 */
import { db, FILERS } from "./lib/13f-import-core";

const dryRun = process.argv.includes("--dry-run");

// tribe.ts is DB-driven now (Filer.isMasterPersona is the source of truth),
// so this can no longer read category from TRIBE_MEMBERS. This set only
// matters the first time a filer row is created; existing rows keep
// whatever isMasterPersona they already have.
const CORE_TRIBE_IDS = new Set(["buffett", "lilu", "duan"]);

async function main() {
  for (const filer of FILERS) {
    const filerEntity = await db.entity.findFirst({
      where: { tribeId: filer.tribeId, type: "master" },
      select: { id: true },
    });
    if (!filerEntity) {
      console.warn(`  SKIP ${filer.tribeId}: no Entity(type=master, tribeId=${filer.tribeId}) found — run import:13f first`);
      continue;
    }

    const companyEntity = await db.entity.findFirst({
      where: { type: "company", cik: filer.cik },
      select: { id: true },
    });

    const existingFiler = await db.filer.findUnique({
      where: { tribeId: filer.tribeId },
      select: { isMasterPersona: true },
    });
    const isMasterPersona = existingFiler?.isMasterPersona ?? CORE_TRIBE_IDS.has(filer.tribeId);

    console.log(
      `  ${filer.tribeId}: filerEntityId=${filerEntity.id} companyEntityId=${companyEntity?.id ?? "null"} isMasterPersona=${isMasterPersona}`,
    );

    if (dryRun) continue;

    await db.filer.upsert({
      where: { tribeId: filer.tribeId },
      create: {
        tribeId: filer.tribeId,
        name: filer.name,
        filerCik: filer.cik,
        filerEntityId: filerEntity.id,
        companyEntityId: companyEntity?.id ?? null,
        isMasterPersona,
      },
      update: {
        name: filer.name,
        filerCik: filer.cik,
        filerEntityId: filerEntity.id,
        companyEntityId: companyEntity?.id ?? null,
        isMasterPersona,
      },
    });
  }

  console.log(dryRun ? "\nDRY-RUN complete. Re-run without --dry-run to write." : "\nDone.");
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error("[backfill-filer-table] fatal", err);
  await db.$disconnect();
  process.exit(1);
});
