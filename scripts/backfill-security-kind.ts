/**
 * backfill-security-kind.ts
 *
 * One-shot classification of every existing Security row's `kind` (equity /
 * etf / fund_trust / right_warrant / convertible_bond / option /
 * unclassified) via classifySecurityKind() — see scripts/lib/13f-import-core.ts
 * for the same classifier now run at import time for new rows.
 *
 * Historical rows never persisted the 13F `putCall` flag (it was parsed and
 * discarded before this change), so this backfill can only classify from
 * `titleOfClass` — any pre-existing PUT/CALL option row will fall into
 * whatever its titleOfClass implies (usually "unclassified" or "equity"),
 * not "option". A future reimport would pick those up correctly.
 *
 * Usage:
 *   npm run backfill:security-kind
 *   npm run backfill:security-kind -- --dry-run
 */
import { db } from "./lib/13f-import-core";
import { classifySecurityKind, type SecurityKind } from "./lib/security-kind-classify";

const dryRun = process.argv.includes("--dry-run");

async function main() {
  const rows = await db.security.findMany({
    select: { id: true, titleOfClass: true, ticker: true, cusip: true, companyEntityId: true, kind: true },
  });

  const byKind: Record<SecurityKind, number> = {
    equity: 0,
    etf: 0,
    fund_trust: 0,
    right_warrant: 0,
    convertible_bond: 0,
    option: 0,
    unclassified: 0,
  };
  const unclassifiedSample: Array<{ id: string; ticker: string | null; cusip: string | null; titleOfClass: string | null }> = [];

  let updated = 0;
  for (const row of rows) {
    const { kind } = classifySecurityKind({ titleOfClass: row.titleOfClass });
    byKind[kind]++;
    if (kind === "unclassified" && unclassifiedSample.length < 50) {
      unclassifiedSample.push({ id: row.id, ticker: row.ticker, cusip: row.cusip, titleOfClass: row.titleOfClass });
    }

    if (kind === row.kind) continue;
    updated++;
    if (dryRun) continue;

    await db.security.update({ where: { id: row.id }, data: { kind } });
  }

  console.log(JSON.stringify({ mode: dryRun ? "dry-run" : "live", totalSecurities: rows.length, updated, byKind }, null, 2));
  console.log("\nUnclassified sample (first 50) — review candidates for classifier improvement:");
  console.log(JSON.stringify(unclassifiedSample, null, 2));

  await db.$disconnect();
}

main().catch(async (err) => {
  console.error("[backfill-security-kind] fatal", err);
  await db.$disconnect();
  process.exit(1);
});
