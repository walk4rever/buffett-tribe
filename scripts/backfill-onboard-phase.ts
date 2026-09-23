/**
 * Backfill `metadata.onboardPhase` for all companies in the database based on
 * actual data completeness.
 *
 * Rules:
 *   - Phase 2: financials > 0 AND (canvas || business) AND moat AND management AND valuation
 *   - Phase 1: financials > 0 (DVL active, financials imported)
 *   - Phase 0: financials == 0 (stub company, pending onboarding)
 *
 * Usage:
 *   node --env-file=.env.local ./node_modules/.bin/tsx scripts/backfill-onboard-phase.ts --dry-run
 *   node --env-file=.env.local ./node_modules/.bin/tsx scripts/backfill-onboard-phase.ts
 */
import prisma from "@/lib/prisma";

function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

async function main() {
  const dryRun = hasFlag("--dry-run");
  console.log(`\n=== Backfill Entity metadata.onboardPhase ${dryRun ? "(DRY RUN)" : "(LIVE)"} ===\n`);

  const companies = await prisma.entity.findMany({
    where: { type: "company" },
    select: {
      id: true,
      ticker: true,
      canonicalName: true,
      metadata: true,
      _count: {
        select: {
          financials: true,
        },
      },
      analyses: {
        select: {
          overview: true,
          canvas: true,
          business: true,
          moat: true,
          management: true,
          valuation: true,
        },
        take: 1,
      },
    },
    orderBy: { canonicalName: "asc" },
  });

  console.log(`Total companies to examine: ${companies.length}\n`);

  const stats = {
    phase2: 0,
    phase1: 0,
    phase0: 0,
    updated: 0,
    unchanged: 0,
  };

  const samplePhase2: string[] = [];
  const samplePhase1: string[] = [];
  const samplePhase0: string[] = [];

  for (const c of companies) {
    const finCount = c._count.financials;
    const a = c.analyses?.[0];
    const hasCanvas = Boolean(a?.canvas || a?.business);
    const hasMoat = Boolean(a?.moat);
    const hasMgmt = Boolean(a?.management);
    const hasVal = Boolean(a?.valuation);
    const hasPhase2Deep = finCount > 0 && hasCanvas && hasMoat && hasMgmt && hasVal;

    let targetPhase: number;
    if (hasPhase2Deep) {
      targetPhase = 2;
      stats.phase2++;
      if (samplePhase2.length < 5) samplePhase2.push(c.ticker || c.canonicalName);
    } else if (finCount > 0) {
      targetPhase = 1;
      stats.phase1++;
      if (samplePhase1.length < 5) samplePhase1.push(c.ticker || c.canonicalName);
    } else {
      targetPhase = 0;
      stats.phase0++;
      if (samplePhase0.length < 5) samplePhase0.push(c.ticker || c.canonicalName);
    }

    const meta = (c.metadata as Record<string, unknown> | null) || {};
    const existingPhase = typeof meta.onboardPhase === "number" ? meta.onboardPhase : null;

    if (existingPhase === targetPhase) {
      stats.unchanged++;
      continue;
    }

    stats.updated++;

    if (!dryRun) {
      const nextMeta = {
        ...meta,
        onboardPhase: targetPhase,
        onboardPhaseAt: new Date().toISOString(),
      };
      await prisma.entity.update({
        where: { id: c.id },
        data: { metadata: nextMeta },
      });
    }
  }

  console.log("Distribution summary:");
  console.log(`  Phase 2 (Full deep analysis + financials): ${stats.phase2}`);
  console.log(`    Samples: ${samplePhase2.join(", ")}`);
  console.log(`  Phase 1 (Fast financials / DVL ready):      ${stats.phase1}`);
  console.log(`    Samples: ${samplePhase1.join(", ")}`);
  console.log(`  Phase 0 (Stubs / Pending onboarding):       ${stats.phase0}`);
  console.log(`    Samples: ${samplePhase0.join(", ")}\n`);

  console.log(`Action summary:`);
  console.log(`  Needs update: ${stats.updated}`);
  console.log(`  Already set:  ${stats.unchanged}`);

  if (dryRun) {
    console.log(`\n(DRY RUN complete — run without --dry-run to apply changes)\n`);
  } else {
    console.log(`\n✓ Successfully backfilled metadata.onboardPhase for ${stats.updated} companies.\n`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Fatal error:", err);
  await prisma.$disconnect();
  process.exit(1);
});
