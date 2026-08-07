/**
 * fix-berkshire-entity-split.ts
 *
 * One-time data fix for the Berkshire duplicate-entity bug (see TODO.md
 * 「Filer / Company 拆分」). Berkshire Hathaway exists as two Entity rows —
 * a type=master filer row (tribeId=buffett) and a type=company row with the
 * real Financial/10-K data — and 4 buggy code paths (fixed separately)
 * caused Li Lu's/Duan's BRK-B/BRK-A Security rows, and several
 * LLM-generated CompanyAnalysis/BusinessCanvas rows, to point at master/
 * filer entities instead of real companies.
 *
 * This script:
 *   1. Re-points Security(ticker IN BRK-B,BRK-A).companyEntityId from the
 *      master Berkshire entity to the real company Berkshire entity.
 *      Refuses to run if the affected row count isn't exactly 2 (the known,
 *      verified state) — this is a one-shot targeted fix, not a general
 *      dedup tool.
 *   2. Deletes CompanyAnalysis/BusinessCanvas rows that were generated
 *      against Entity(type != "company") rows — these represent "company
 *      profile" content for filer/fund entities that aren't real operating
 *      companies (Himalaya, H&H International) or duplicate the legitimate
 *      company-side content (master-type Berkshire's BusinessCanvas).
 *
 * Usage:
 *   npm run fix:berkshire-entity-split -- --dry-run
 *   npm run fix:berkshire-entity-split
 */
import { db } from "./lib/13f-import-core";

const dryRun = process.argv.includes("--dry-run");
const EXPECTED_SECURITY_FIX_COUNT = 2;

async function main() {
  // 1. Re-point BRK-B/BRK-A securities to the real company entity.
  const securities = await db.security.findMany({
    where: { ticker: { in: ["BRK-B", "BRK-A"] } },
    select: { id: true, ticker: true, companyEntityId: true, company: { select: { type: true } } },
  });

  const wrongLinks = securities.filter((s) => s.company?.type !== "company");
  console.log(`Found ${securities.length} BRK-B/BRK-A securities, ${wrongLinks.length} linked to a non-company entity.`);
  for (const s of wrongLinks) {
    console.log(`  ${s.id} (${s.ticker}) -> companyEntityId=${s.companyEntityId}`);
  }

  if (wrongLinks.length !== EXPECTED_SECURITY_FIX_COUNT) {
    throw new Error(
      `Expected exactly ${EXPECTED_SECURITY_FIX_COUNT} wrongly-linked securities, found ${wrongLinks.length}. ` +
        `Refusing to proceed — this script is a targeted one-shot fix, not a general resolver. Investigate before re-running.`,
    );
  }

  const realCompany = await db.entity.findFirst({
    where: { type: "company", cik: "1067983" },
    select: { id: true },
  });
  if (!realCompany) throw new Error("Real Berkshire company entity (cik=1067983) not found.");

  if (!dryRun) {
    for (const s of wrongLinks) {
      await db.security.update({ where: { id: s.id }, data: { companyEntityId: realCompany.id } });
    }
  }
  console.log(`${dryRun ? "[DRY-RUN] would repoint" : "Repointed"} ${wrongLinks.length} securities -> ${realCompany.id}`);

  // 2. Delete spurious CompanyAnalysis / BusinessCanvas on non-company entities.
  const badAnalyses = await db.companyAnalysis.findMany({
    where: { entity: { type: { not: "company" } } },
    select: { id: true, entity: { select: { canonicalName: true, type: true } } },
  });
  const badCanvases = await db.businessCanvas.findMany({
    where: { entity: { type: { not: "company" } } },
    select: { id: true, entity: { select: { canonicalName: true, type: true } } },
  });

  console.log(`\nSpurious CompanyAnalysis rows (${badAnalyses.length}):`);
  for (const a of badAnalyses) console.log(`  ${a.id} — ${a.entity.canonicalName} (type=${a.entity.type})`);
  console.log(`Spurious BusinessCanvas rows (${badCanvases.length}):`);
  for (const c of badCanvases) console.log(`  ${c.id} — ${c.entity.canonicalName} (type=${c.entity.type})`);

  if (!dryRun) {
    if (badAnalyses.length) {
      await db.companyAnalysis.deleteMany({ where: { id: { in: badAnalyses.map((a) => a.id) } } });
    }
    if (badCanvases.length) {
      await db.businessCanvas.deleteMany({ where: { id: { in: badCanvases.map((c) => c.id) } } });
    }
  }
  console.log(`${dryRun ? "[DRY-RUN] would delete" : "Deleted"} ${badAnalyses.length} CompanyAnalysis + ${badCanvases.length} BusinessCanvas rows.`);

  console.log(dryRun ? "\nDRY-RUN complete. Re-run without --dry-run to write." : "\nDone.");
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error("[fix-berkshire-entity-split] fatal", err);
  await db.$disconnect();
  process.exit(1);
});
