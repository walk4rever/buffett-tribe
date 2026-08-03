/**
 * One-shot backfill: sets Entity.cik for company entities that already have
 * a ticker (created as bare 13F-import stubs, e.g. Core Scientific, SharonAI)
 * but never went through the onboard:company pipeline, using SEC's bulk
 * ticker->CIK mapping file (one request, no per-company API calls).
 *
 * scripts/backfill-security-company-links.ts already loads this same SEC
 * ticker map and has CIK-lookup logic, but only reaches it when creating a
 * brand-new company entity from scratch (gated behind `if (!companyId)`) —
 * it never revisits an entity that already has a linked Security but
 * cik: null. This script covers exactly that gap. Skips non-US entities
 * (market: "hk" | "cn") — they structurally have no SEC CIK.
 *
 * Usage:
 *   npm run backfill:company-cik -- --dry-run
 *   npm run backfill:company-cik
 */
import prisma from "@/lib/prisma";

const dryRun = process.argv.includes("--dry-run");
const USER_AGENT = "buffett-tribe research walkklaw@gmail.com";

type SecTickerEntry = { cik_str: number; ticker: string; title: string };

async function main() {
  console.log("Fetching SEC company_tickers.json ...");
  const res = await fetch("https://www.sec.gov/files/company_tickers.json", {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching company_tickers.json`);
  const data = (await res.json()) as Record<string, SecTickerEntry>;
  const byTicker = new Map<string, string>();
  for (const entry of Object.values(data)) {
    byTicker.set(entry.ticker.toUpperCase(), String(entry.cik_str));
  }
  console.log(`Loaded ${byTicker.size} ticker -> CIK mappings.`);

  const candidates = await prisma.entity.findMany({
    where: {
      type: "company",
      cik: null,
      ticker: { not: null },
      OR: [{ market: null }, { market: "us" }],
    },
    select: { id: true, canonicalName: true, ticker: true },
  });
  console.log(`Found ${candidates.length} candidate companies (US, ticker set, cik null).`);

  const existingCiks = new Set(
    (await prisma.entity.findMany({ where: { cik: { not: null } }, select: { cik: true } })).map(
      (e) => e.cik as string,
    ),
  );

  let updated = 0;
  let noMatch = 0;
  let collision = 0;

  for (const e of candidates) {
    const ticker = e.ticker!.toUpperCase();
    const cik = byTicker.get(ticker);
    if (!cik) {
      noMatch++;
      continue;
    }
    if (existingCiks.has(cik)) {
      console.log(`  ✗ ${ticker} (${e.canonicalName}): CIK ${cik} already used by another entity, skipped`);
      collision++;
      continue;
    }

    if (dryRun) {
      console.log(`  [dry-run] ${ticker} (${e.canonicalName}) -> CIK ${cik}`);
    } else {
      await prisma.entity.update({ where: { id: e.id }, data: { cik } });
      console.log(`  ✓ ${ticker} (${e.canonicalName}) -> CIK ${cik}`);
    }
    existingCiks.add(cik); // guard against two of our tickers resolving to the same CIK within this run
    updated++;
  }

  console.log(
    `\nDone: ${updated} ${dryRun ? "would be " : ""}updated, ${noMatch} no match, ${collision} collision-skipped.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
