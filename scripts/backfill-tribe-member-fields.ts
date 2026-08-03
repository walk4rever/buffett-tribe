/**
 * One-shot backfill: writes the curated presentation fields (personNameEn,
 * personNameZh, initials, materialLabel, materialSub) onto the existing 9
 * `Filer` rows, sourced from a point-in-time snapshot of the old hardcoded
 * TRIBE_MEMBERS array in src/lib/tribe.ts — copied here as a literal, not
 * imported, because this script's whole purpose is to survive that array
 * being deleted once tribe.ts becomes DB-driven. Safe to delete after one
 * successful run.
 *
 * Usage:
 *   npm run backfill:tribe-member-fields -- --dry-run
 *   npm run backfill:tribe-member-fields
 */
import prisma from "@/lib/prisma";

const dryRun = process.argv.includes("--dry-run");

const SNAPSHOT: Array<{
  id: string;
  name: string;
  nameZh: string;
  initials: string;
  materialLabel: string;
  materialSub: string;
}> = [
  { id: "buffett", name: "Warren Buffett", nameZh: "巴菲特", initials: "巴", materialLabel: "信件档案", materialSub: "1958–2025" },
  { id: "lilu", name: "Li Lu", nameZh: "李录", initials: "李", materialLabel: "资料库", materialSub: "1997–至今" },
  { id: "duan", name: "Duan Yongping", nameZh: "段永平", initials: "段", materialLabel: "资料库", materialSub: "2006–至今" },
  { id: "gavin-baker", name: "Gavin Baker", nameZh: "Gavin Baker", initials: "GB", materialLabel: "访谈与观点", materialSub: "建设中" },
  { id: "alex-sacerdote", name: "Alex Sacerdote", nameZh: "Alex Sacerdote", initials: "AS", materialLabel: "访谈与观点", materialSub: "建设中" },
  { id: "leopold-aschenbrenner", name: "Leopold Aschenbrenner", nameZh: "Leopold Aschenbrenner", initials: "LA", materialLabel: "访谈与观点", materialSub: "建设中" },
  { id: "christopher-begg", name: "Christopher Begg", nameZh: "Christopher Begg", initials: "CB", materialLabel: "访谈与观点", materialSub: "建设中" },
  { id: "micky-malka", name: "Micky Malka", nameZh: "Micky Malka", initials: "MM", materialLabel: "访谈与观点", materialSub: "建设中" },
  { id: "terry-smith", name: "Terry Smith", nameZh: "Terry Smith", initials: "TS", materialLabel: "访谈与观点", materialSub: "建设中" },
];

async function main() {
  for (const m of SNAPSHOT) {
    const existing = await prisma.filer.findUnique({
      where: { tribeId: m.id },
      select: { personNameEn: true, personNameZh: true, initials: true, materialLabel: true, materialSub: true },
    });
    if (!existing) {
      console.warn(`  SKIP ${m.id}: no Filer row found`);
      continue;
    }

    console.log(`  ${m.id}:`);
    console.log(`    personNameEn:  ${JSON.stringify(existing.personNameEn)} -> ${JSON.stringify(m.name)}`);
    console.log(`    personNameZh:  ${JSON.stringify(existing.personNameZh)} -> ${JSON.stringify(m.nameZh)}`);
    console.log(`    initials:      ${JSON.stringify(existing.initials)} -> ${JSON.stringify(m.initials)}`);
    console.log(`    materialLabel: ${JSON.stringify(existing.materialLabel)} -> ${JSON.stringify(m.materialLabel)}`);
    console.log(`    materialSub:   ${JSON.stringify(existing.materialSub)} -> ${JSON.stringify(m.materialSub)}`);

    if (dryRun) continue;

    await prisma.filer.update({
      where: { tribeId: m.id },
      data: {
        personNameEn: m.name,
        personNameZh: m.nameZh,
        initials: m.initials,
        materialLabel: m.materialLabel,
        materialSub: m.materialSub,
      },
    });
  }

  console.log(dryRun ? "\nDRY-RUN complete. Re-run without --dry-run to write." : "\nDone.");
}

main()
  .catch((err) => {
    console.error("[backfill-tribe-member-fields] fatal", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
