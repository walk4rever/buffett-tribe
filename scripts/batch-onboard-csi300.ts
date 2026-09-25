/**
 * Batch onboarding runner for CSI 300 (沪深300) A-share companies.
 *
 * Usage:
 *   # Dry-run first 10 constituents:
 *   npm run onboard:csi300 -- --limit 10 --dry-run
 *
 *   # Run a specific pioneer list (Phase 1):
 *   npm run onboard:csi300 -- --tickers 002594.SZ,600276.SS,601318.SS --phase 1
 *
 *   # Run next 20 constituents with 3s delay:
 *   npm run onboard:csi300 -- --offset 10 --limit 20 --phase 1 --delay 3000
 */

import { execSync } from "node:child_process";
import prisma from "@/lib/prisma";
import { getArg, hasFlag } from "./lib/company-generation";
import { onboardTickersWithFailureIsolation } from "./lib/onboard-batch-runner";

type Constituent = {
  code: string;
  name: string;
  ticker: string;
  exchange: "SZ" | "SS" | "BJ";
};

function fetchConstituents(): Constituent[] {
  const pyCmd = process.env.VIRTUAL_ENV
    ? `${process.env.VIRTUAL_ENV}/bin/python`
    : ".venv/bin/python";
  const cmd = `[ -x ${pyCmd} ] && ${pyCmd} scripts/fetch-csi300-constituents.py || python3 scripts/fetch-csi300-constituents.py`;
  const output = execSync(cmd, { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 });
  return JSON.parse(output) as Constituent[];
}

async function main() {
  const dryRun = hasFlag("--dry-run");
  const force = hasFlag("--force");
  const phaseArg = (getArg("--phase") ?? "1").toLowerCase();
  if (phaseArg !== "1" && phaseArg !== "2" && phaseArg !== "all") {
    throw new Error(`Invalid --phase "${phaseArg}". Expected 1, 2, or all.`);
  }

  const limitArg = getArg("--limit");
  const limit = limitArg ? Number.parseInt(limitArg, 10) : undefined;
  const offsetArg = getArg("--offset");
  const offset = offsetArg ? Number.parseInt(offsetArg, 10) : 0;
  const delayArg = getArg("--delay");
  const delayMs = delayArg ? Number.parseInt(delayArg, 10) : 2000;

  const tickersArg = getArg("--tickers");
  const explicitTickers = tickersArg
    ? tickersArg
        .split(",")
        .map((t) => t.trim().toUpperCase())
        .filter(Boolean)
    : undefined;

  console.log("Fetching CSI 300 constituents via akshare...");
  const allConstituents = fetchConstituents();
  console.log(`Loaded ${allConstituents.length} CSI 300 constituents.`);

  const constituentMap = new Map<string, Constituent>();
  for (const c of allConstituents) {
    constituentMap.set(c.ticker, c);
  }

  let candidates: Constituent[] = [];
  if (explicitTickers && explicitTickers.length > 0) {
    for (const ticker of explicitTickers) {
      const found = constituentMap.get(ticker);
      if (found) {
        candidates.push(found);
      } else {
        // Allow arbitrary A-share tickers even if not currently in CSI 300
        const match = ticker.match(/^(\d{6})\.(SZ|SS|BJ)$/);
        candidates.push({
          code: match ? match[1] : ticker,
          name: ticker,
          ticker,
          exchange: (match ? match[2] : "SZ") as "SZ" | "SS" | "BJ",
        });
      }
    }
  } else {
    candidates = allConstituents.slice(offset);
  }

  // Check DB status for candidates
  const candidateTickers = candidates.map((c) => c.ticker);
  const existingEntities = await prisma.entity.findMany({
    where: {
      type: "company",
      ticker: { in: candidateTickers, mode: "insensitive" },
    },
    select: {
      id: true,
      ticker: true,
      _count: { select: { financials: true } },
    },
  });

  const existingMap = new Map<string, { id: string; financialCount: number }>();
  for (const ent of existingEntities) {
    if (ent.ticker) {
      existingMap.set(ent.ticker.toUpperCase(), {
        id: ent.id,
        financialCount: ent._count.financials,
      });
    }
  }

  const unOnboarded: Constituent[] = [];
  const alreadyOnboarded: Constituent[] = [];

  for (const cand of candidates) {
    const existing = existingMap.get(cand.ticker.toUpperCase());
    if (!force && existing && existing.financialCount > 0) {
      alreadyOnboarded.push(cand);
    } else {
      unOnboarded.push(cand);
    }
  }

  const toRun = limit ? unOnboarded.slice(0, limit) : unOnboarded;

  console.log("\n=== CSI 300 Batch Plan ===");
  console.log(`Total constituents scanned: ${candidates.length}`);
  console.log(`Already onboarded (has financials): ${alreadyOnboarded.length}`);
  console.log(`To run: ${toRun.length}${limit ? ` (capped by --limit ${limit})` : ""} (Phase ${phaseArg}, Delay ${delayMs}ms)`);

  if (alreadyOnboarded.length > 0) {
    console.log("\nSkipping already onboarded:");
    for (const c of alreadyOnboarded) {
      const info = existingMap.get(c.ticker.toUpperCase());
      console.log(`  ✓ ${c.ticker} (${c.name}) [${info?.financialCount ?? 0} financials]`);
    }
  }

  if (toRun.length > 0) {
    console.log("\nTarget companies to onboard:");
    for (const c of toRun) {
      console.log(`  → ${c.ticker} (${c.name})`);
    }
  }

  if (dryRun) {
    console.log("\n[dry-run] Exiting without running onboarding steps.");
    await prisma.$disconnect();
    return;
  }

  if (toRun.length === 0) {
    console.log("\nNo companies left to onboard in this batch.");
    await prisma.$disconnect();
    return;
  }

  console.log(`\nStarting batch onboarding (${toRun.length} companies)...`);
  const startTime = Date.now();

  const tickersToRun = toRun.map((c) => c.ticker);
  const result = await onboardTickersWithFailureIsolation(tickersToRun, {
    market: "cn",
    phase: phaseArg as "1" | "2" | "all",
    delayMs,
  });

  const elapsedSec = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n========================================`);
  console.log(`=== CSI 300 Batch Onboarding Summary ===`);
  console.log(`========================================`);
  console.log(`Total processed: ${tickersToRun.length} in ${elapsedSec}s`);
  console.log(`Succeeded: ${result.succeeded.length}/${tickersToRun.length}`);

  if (result.succeeded.length > 0) {
    console.log("\nSucceeded companies:");
    for (const t of result.succeeded) {
      const c = constituentMap.get(t);
      console.log(`  ✓ ${t} (${c?.name ?? "A-Share"})`);
    }
  }

  if (result.failed.length > 0) {
    console.log("\nFailed companies:");
    for (const f of result.failed) {
      const c = constituentMap.get(f.ticker);
      console.log(`  ✗ ${f.ticker} (${c?.name ?? "A-Share"}): ${f.error}`);
    }
  }

  await prisma.$disconnect();
  if (result.succeeded.length === 0 && tickersToRun.length > 0) {
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error("Fatal error:", err);
  await prisma.$disconnect();
  process.exit(1);
});
