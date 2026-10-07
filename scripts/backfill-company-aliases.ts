/**
 * backfill-company-aliases.ts
 *
 * Smart backfill of company public brand names, trade names, and aliases
 * for onboarded companies (onboardPhase >= 1), prioritizing Master Holdings,
 * Phase 2 analyzed companies, and US/ADR issuers.
 *
 * Usage:
 *   node --env-file=.env.local ./node_modules/.bin/tsx scripts/backfill-company-aliases.ts --dry-run
 *   node --env-file=.env.local ./node_modules/.bin/tsx scripts/backfill-company-aliases.ts --ticker GOOGL
 *   node --env-file=.env.local ./node_modules/.bin/tsx scripts/backfill-company-aliases.ts --concurrency 8
 *   node --env-file=.env.local ./node_modules/.bin/tsx scripts/backfill-company-aliases.ts --limit 20
 */

import { Prisma } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { extractCompanyAliasesLlm, sanitizeAliases } from "./lib/company-aliases";

function getArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

const hasFlag = (flag: string) => process.argv.slice(2).includes(flag);

const dryRun = hasFlag("--dry-run");
const force = hasFlag("--force");
const tickerArg = getArg("--ticker")?.trim().toUpperCase();
const marketArg = getArg("--market")?.trim().toLowerCase();
const limitArg = getArg("--limit") ? parseInt(getArg("--limit")!, 10) : undefined;
const concurrency = Math.max(1, Math.min(16, parseInt(getArg("--concurrency") ?? "8", 10)));

const LEGAL_STRIP_REGEX = /\b(inc|incorporated|corp|corporation|ltd|limited|co|company|holdings|holding|group|plc|llc|sa|ag|nv)\b/gi;

/**
 * Determine whether a company needs LLM alias deduction.
 */
function needsAliasExtraction(company: {
  canonicalName: string;
  ticker: string | null;
  market: string | null;
  aliases: string[];
  nameZh?: string | null;
  isMasterHolding: boolean;
  onboardPhase: number;
}): boolean {
  if (force) return true;

  // If company already has aliases (more than just a 1-element ticker duplicate)
  if (company.aliases.length > 0) {
    const isOnlyTicker = company.aliases.length === 1 && company.aliases[0] === company.ticker;
    if (!isOnlyTicker) return false;
  }

  // 1. All master holdings need alias coverage
  if (company.isMasterHolding) return true;

  // 2. All Phase 2 companies (flagship research)
  if (company.onboardPhase >= 2) return true;

  // 3. For US companies: check if legal name is multi-word or has corporate suffixes
  if (company.market === "us") {
    const stripped = company.canonicalName.replace(LEGAL_STRIP_REGEX, "").replace(/[^a-zA-Z0-9]/g, "").trim();
    const tickerClean = (company.ticker ?? "").replace(/[^a-zA-Z0-9]/g, "").trim();
    // If stripped name is very different from ticker or longer than 12 chars, it likely has a brand alias
    if (stripped.length > 10 || stripped.toUpperCase() !== tickerClean.toUpperCase()) {
      return true;
    }
  }

  // 4. For HK companies: check if English name or code
  if (company.market === "hk") {
    // HK stocks with tech/consumer focus or Chinese names ending in 控股/科技
    if (company.nameZh && /(控股|集团|技术|科技|发展|国际)$/.test(company.nameZh)) {
      return true;
    }
  }

  return false;
}

async function runPool<T>(
  items: T[],
  workerLimit: number,
  fn: (item: T, index: number) => Promise<void>,
) {
  let index = 0;
  const workers = Array.from({ length: workerLimit }, async () => {
    while (index < items.length) {
      const cur = index++;
      await fn(items[cur], cur);
    }
  });
  await Promise.all(workers);
}

async function main() {
  console.log("=== Backfill Company Aliases ===");
  console.log(`Mode: ${dryRun ? "DRY-RUN (no DB writes)" : "PRODUCTION (writing to DB)"}`);
  console.log(`Concurrency: ${concurrency}`);

  // Fetch active master holdings IDs
  const masterHoldings = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT DISTINCT ce.id
    FROM "Holding" h
    JOIN "Security" s ON s.id = h."securityId"
    JOIN "Entity" ce ON ce.id = s."companyEntityId"
    WHERE h."isSoldOut" IS NOT TRUE;
  `;
  const masterHoldingSet = new Set(masterHoldings.map((r) => r.id));
  console.log(`Active master holding companies: ${masterHoldingSet.size}`);

  type RawCandidate = {
    id: string;
    canonicalName: string;
    ticker: string | null;
    market: string | null;
    onboardPhase: number;
    aliases: string[];
    nameZh: string | null;
  };

  const tickerFilter = tickerArg ? Prisma.sql`AND ticker = ${tickerArg}` : Prisma.empty;
  const marketFilter = marketArg ? Prisma.sql`AND market = ${marketArg}` : Prisma.empty;

  const candidates = await prisma.$queryRaw<RawCandidate[]>(Prisma.sql`
    SELECT id, "canonicalName", ticker, market, "onboardPhase", aliases, (metadata->>'nameZh') AS "nameZh"
    FROM "Entity"
    WHERE type = 'company'
      AND "onboardPhase" >= 1
      ${tickerFilter}
      ${marketFilter}
    ORDER BY "onboardPhase" DESC, "canonicalName" ASC
  `);

  console.log(`Total onboardPhase >= 1 companies: ${candidates.length}`);

  // Filter with Smart Rules
  const targetCompanies = candidates
    .map((c) => {
      const isMasterHolding = masterHoldingSet.has(c.id);
      return {
        ...c,
        isMasterHolding,
      };
    })
    .filter(needsAliasExtraction);

  const finalTargets = limitArg ? targetCompanies.slice(0, limitArg) : targetCompanies;

  console.log(`\nFiltered targets for alias extraction: ${finalTargets.length} companies (pruned ${candidates.length - targetCompanies.length} trivial/completed companies)`);

  if (finalTargets.length === 0) {
    console.log("No companies require alias backfilling. Done!");
    await prisma.$disconnect();
    return;
  }

  let successCount = 0;
  let populatedCount = 0;
  let errorCount = 0;

  console.log("\nStarting extraction pool...\n");

  await runPool(finalTargets, concurrency, async (company, idx) => {
    const label = `[${idx + 1}/${finalTargets.length}] ${company.ticker ?? "NO_TICKER"} (${company.nameZh ?? company.canonicalName})`;
    try {
      if (dryRun) {
        const rawAliases = await extractCompanyAliasesLlm({
          canonicalName: company.canonicalName,
          ticker: company.ticker,
          nameZh: company.nameZh,
        });
        const clean = sanitizeAliases({
          rawAliases,
          canonicalName: company.canonicalName,
          ticker: company.ticker,
          nameZh: company.nameZh,
          existingAliases: company.aliases,
        });
        if (clean.length > 0) {
          console.log(`  ${label} -> Would set aliases: [${clean.join(", ")}]`);
          populatedCount++;
        } else {
          console.log(`  ${label} -> No special aliases needed`);
        }
        successCount++;
        return;
      }

      const rawAliases = await extractCompanyAliasesLlm({
        canonicalName: company.canonicalName,
        ticker: company.ticker,
        nameZh: company.nameZh,
      });
      const clean = sanitizeAliases({
        rawAliases,
        canonicalName: company.canonicalName,
        ticker: company.ticker,
        nameZh: company.nameZh,
        existingAliases: company.aliases,
      });

      if (clean.length > 0) {
        await prisma.entity.update({
          where: { id: company.id },
          data: { aliases: { set: clean } },
        });
        console.log(`  ✓ ${label} -> [${clean.join(", ")}]`);
        populatedCount++;
      } else {
        console.log(`  - ${label} -> (empty)`);
      }
      successCount++;
    } catch (err) {
      errorCount++;
      console.error(`  ✗ ${label} Failed:`, err instanceof Error ? err.message : String(err));
    }
  });

  console.log("\n=== Summary ===");
  console.log(`Total processed: ${finalTargets.length}`);
  console.log(`Success: ${successCount} (with aliases: ${populatedCount})`);
  console.log(`Errors: ${errorCount}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Fatal error:", err);
  await prisma.$disconnect();
  process.exit(1);
});
