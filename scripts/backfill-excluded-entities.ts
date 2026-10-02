/**
 * backfill-excluded-entities.ts
 *
 * Scans database Entity records (where onboardPhase = 0) and identifies
 * instruments and entities that should be excluded from standard company onboarding
 * (OTC ADRs/foreign ordinaries, pink sheets, ETFs, trusts, delisted/acquired, SPAC units).
 *
 * Updates matching entities to:
 * - onboardPhase: -1
 * - priority: 0, priorityRequestedAt: null
 * - metadata: { ...meta, isExcluded: true, exclusionReason, exclusionLabel, excludedAt }
 *
 * Usage:
 *   node --env-file=.env.local ./node_modules/.bin/tsx scripts/backfill-excluded-entities.ts --dry-run
 *   node --env-file=.env.local ./node_modules/.bin/tsx scripts/backfill-excluded-entities.ts
 */
import prisma from "@/lib/prisma";
import {
  evaluateOnboardExclusion,
  type ExclusionReason,
  EXCLUSION_LABELS,
} from "@/lib/onboard-exclusion";

const CHUNK_SIZE = 1000;

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return undefined;
}

async function main() {
  const dryRun = hasFlag("--dry-run");
  const limitArg = getArg("--limit");
  const maxLimit = limitArg ? parseInt(limitArg, 10) : Infinity;

  console.log(`[backfill-excluded-entities] Starting in ${dryRun ? "DRY-RUN" : "LIVE"} mode...`);

  // 1. High-speed prefetch of non-company securities to avoid costly joins
  console.log("Loading non-company securities map...");
  const nonCompanySecurities = await prisma.security.findMany({
    where: {
      kind: {
        in: ["etf", "fund_trust", "right_warrant", "convertible_bond", "option"],
      },
      companyEntityId: { not: null },
    },
    select: {
      companyEntityId: true,
      kind: true,
      titleOfClass: true,
      ticker: true,
    },
  });

  const secByEntity = new Map<
    string,
    Array<{ kind: string | null; titleOfClass: string | null; ticker: string | null }>
  >();
  for (const s of nonCompanySecurities) {
    if (!s.companyEntityId) continue;
    const list = secByEntity.get(s.companyEntityId) ?? [];
    list.push(s);
    secByEntity.set(s.companyEntityId, list);
  }
  console.log(`Loaded ${nonCompanySecurities.length} non-company securities mapped across entities.`);

  // 2. Scan Phase 0 companies with cursor pagination
  const stats: Record<ExclusionReason, { count: number; samples: string[] }> = {
    otc_pink_sheet: { count: 0, samples: [] },
    delisted: { count: 0, samples: [] },
    etf: { count: 0, samples: [] },
    fund_trust: { count: 0, samples: [] },
    derivative: { count: 0, samples: [] },
    spac_unit: { count: 0, samples: [] },
    acquired: { count: 0, samples: [] },
    no_financial_facts: { count: 0, samples: [] },
  };

  const idsByReason: Record<ExclusionReason, string[]> = {
    otc_pink_sheet: [],
    delisted: [],
    etf: [],
    fund_trust: [],
    derivative: [],
    spac_unit: [],
    acquired: [],
    no_financial_facts: [],
  };

  let cursor: string | undefined = undefined;
  let scannedCount = 0;
  let totalToExclude = 0;

  type EntityPhase0Row = {
    id: string;
    ticker: string | null;
    code: string | null;
    canonicalName: string;
    market: string | null;
    onboardPhase: number;
    metadata: unknown;
  };

  while (true) {
    const chunk: EntityPhase0Row[] = await prisma.entity.findMany({
      where: {
        type: "company",
        onboardPhase: 0,
      },
      select: {
        id: true,
        ticker: true,
        code: true,
        canonicalName: true,
        market: true,
        onboardPhase: true,
        metadata: true,
      },
      take: CHUNK_SIZE,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { id: "asc" },
    });

    if (chunk.length === 0) break;
    cursor = chunk[chunk.length - 1].id;
    scannedCount += chunk.length;

    for (const c of chunk) {
      if (totalToExclude >= maxLimit) break;

      const attachedSecurities = secByEntity.get(c.id) ?? null;
      const evalResult = evaluateOnboardExclusion({
        ticker: c.ticker,
        code: c.code,
        canonicalName: c.canonicalName,
        market: c.market,
        onboardPhase: c.onboardPhase,
        metadata: c.metadata as Record<string, unknown> | null,
        securities: attachedSecurities,
      });

      if (evalResult.isExcluded && evalResult.reason) {
        const reason = evalResult.reason;
        stats[reason].count++;
        idsByReason[reason].push(c.id);
        totalToExclude++;
        const displayCode = c.ticker || c.code || c.canonicalName;
        if (stats[reason].samples.length < 5) {
          stats[reason].samples.push(displayCode);
        }
      }
    }

    process.stdout.write(`Scanned ${scannedCount} Phase 0 entities (identified ${totalToExclude} to exclude)...\r`);
    if (totalToExclude >= maxLimit) break;
  }

  console.log(`\nScan complete. Total evaluated: ${scannedCount} Phase 0 entities.`);
  console.log("\n=======================================================");
  console.log(`Exclusion Evaluation Summary (Total to Exclude: ${totalToExclude} / ${scannedCount}):`);
  console.log("=======================================================");
  for (const [reason, info] of Object.entries(stats)) {
    if (info.count > 0) {
      console.log(
        `• [${reason.padEnd(18)}] ${String(info.count).padStart(5)} entities | Samples: ${info.samples.join(", ")}`,
      );
    }
  }

  if (dryRun) {
    console.log("\n[DRY-RUN] No database modifications made. Run without --dry-run to apply updates.");
    await prisma.$disconnect();
    return;
  }

  console.log(`\nApplying updates to ${totalToExclude} entities using atomic SQL jsonb merge...`);
  const nowIso = new Date().toISOString();
  let totalUpdated = 0;

  for (const [reasonKey, ids] of Object.entries(idsByReason)) {
    if (ids.length === 0) continue;
    const reason = reasonKey as ExclusionReason;
    const label = EXCLUSION_LABELS[reason];
    const patchJson = JSON.stringify({
      isExcluded: true,
      exclusionReason: reason,
      exclusionLabel: label,
      excludedAt: nowIso,
    });

    console.log(`Updating ${ids.length} entities for [${reason}]...`);
    const affected = await prisma.$executeRawUnsafe(
      `UPDATE "Entity"
       SET "onboardPhase" = -1,
           "priority" = 0,
           "priorityRequestedAt" = NULL,
           "metadata" = COALESCE("metadata", '{}'::jsonb) || $1::jsonb
       WHERE id = ANY($2::text[])`,
      patchJson,
      ids,
    );
    totalUpdated += Number(affected);
    console.log(`  ✓ Updated ${affected} entities for [${reason}]`);
  }

  console.log(`\n Successfully updated ${totalUpdated} entities to onboardPhase: -1.`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Migration error:", err);
  await prisma.$disconnect();
  process.exit(1);
});
