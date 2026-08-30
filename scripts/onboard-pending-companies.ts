/**
 * Batch-onboards companies that exist only as bare DB stubs — auto-created by
 * 13F import the moment some investor's holdings first mentioned the ticker,
 * but never run through onboard:company. Same completeness check as
 * src/app/company/page.tsx's "待完善" grouping (Financial rows > 0 == fully
 * onboarded, since onboarding writes Financial/CompanyAnalysis/BusinessCanvas
 * together as one unit).
 *
 * Usage:
 *   npm run onboard:pending -- --dry-run
 *   npm run onboard:pending -- --limit 5
 *   npm run onboard:pending -- --limit 5 --dry-run
 *
 * Not resumable across separate invocations (each run re-queries the current
 * stub list) — a failed ticker just has no Financial rows yet, so it's
 * naturally included again on the next run. Failure isolation matches
 * onboard-alpha-investor.ts's --onboard-holdings loop: one ticker's failure
 * is caught, logged, and the batch continues.
 */
import prisma from "@/lib/prisma";
import { isNonCompanySecurityKind } from "@/lib/security-kind";
import { getArg, hasFlag } from "./lib/company-generation";
import { onboardTickersWithFailureIsolation } from "./lib/onboard-batch-runner";

async function findPendingTickers(): Promise<string[]> {
  const rows = await prisma.entity.findMany({
    where: {
      type: "company",
      ticker: { not: null },
      OR: [{ cik: { not: null } }, { AND: [{ market: { not: null } }, { code: { not: null } }] }],
    },
    select: {
      ticker: true,
      createdAt: true,
      _count: { select: { financials: true } },
      // ETF/trust/warrant/etc. tickers show up as stubs the moment some
      // investor's 13F holdings mention them, but onboard:company's 10-K
      // import always fails for them (no annual report exists) — same
      // exclusion src/app/company/page.tsx applies to the directory.
      securitiesAsCompany: { select: { kind: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return rows
    .filter((row) => row._count.financials === 0)
    .filter(
      (row) =>
        row.securitiesAsCompany.length === 0 ||
        !row.securitiesAsCompany.every((s) => isNonCompanySecurityKind(s.kind)),
    )
    .map((row) => row.ticker as string);
}

async function main() {
  const dryRun = hasFlag("--dry-run");
  const limitArg = getArg("--limit");
  const limit = limitArg ? Number(limitArg) : undefined;
  if (limitArg && (!Number.isFinite(limit) || (limit as number) <= 0)) {
    throw new Error(`Invalid --limit "${limitArg}"`);
  }

  const pending = await findPendingTickers();
  const toRun = limit ? pending.slice(0, limit) : pending;
  console.log(`Pending stub companies: ${pending.length}${limit ? ` (running first ${toRun.length})` : ""}`);

  if (dryRun) {
    for (const ticker of toRun) console.log(`  - ${ticker}`);
    await prisma.$disconnect();
    return;
  }

  const result = await onboardTickersWithFailureIsolation(toRun);

  console.log(`\n=== onboard:pending summary ===`);
  console.log(`  succeeded: ${result.succeeded.length}/${toRun.length}`);
  if (result.failed.length) {
    console.log(`  failed:`);
    for (const f of result.failed) console.log(`    - ${f.ticker}: ${f.error}`);
  }

  await prisma.$disconnect();
  if (toRun.length > 0 && result.failed.length === toRun.length) process.exit(1);
}

main().catch(async (err) => {
  console.error("[onboard-pending-companies] fatal", err instanceof Error ? err.message : String(err));
  await prisma.$disconnect();
  process.exit(1);
});
