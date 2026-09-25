/**
 * Batch onboarding runner for Hong Kong (HKEX) stocks.
 *
 * Usage:
 *   # Dry-run first 20 core HK stocks:
 *   npm run onboard:hk -- --limit 20 --dry-run
 *
 *   # Onboard a specific pioneer list (Phase 1):
 *   npm run onboard:hk -- --tickers 0388.HK,1211.HK,9999.HK --phase 1
 *
 *   # Run next 20 core HK stocks with 2s delay:
 *   npm run onboard:hk -- --limit 20 --phase 1 --delay 2000
 *
 *   # Run from full HK universe (2,800+ stocks):
 *   npm run onboard:hk -- --all --limit 50 --phase 1
 */

import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import prisma from "@/lib/prisma";
import { getArg, hasFlag } from "./lib/company-generation";
import { onboardTickersWithFailureIsolation } from "./lib/onboard-batch-runner";

type HkStock = {
  code: string;
  name: string;
  engName?: string;
  ticker: string;
  exchange: string;
};

// Curated top tier HK leaders (Hang Seng Index & tech/consumer blue chips)
const CORE_HK_TICKERS = [
  "9988.HK", // 阿里巴巴
  "0700.HK", // 腾讯控股
  "3690.HK", // 美团
  "1810.HK", // 小米集团
  "9992.HK", // 泡泡玛特
  "9633.HK", // 农夫山泉
  "0388.HK", // 香港交易所
  "1211.HK", // 比亚迪股份
  "9999.HK", // 网易
  "1024.HK", // 快手
  "9618.HK", // 京东集团
  "9888.HK", // 百度集团
  "0175.HK", // 吉利汽车
  "0883.HK", // 中国海洋石油
  "2020.HK", // 安踏体育
  "0291.HK", // 华润啤酒
  "0992.HK", // 联想集团
  "1299.HK", // 友邦保险
  "2318.HK", // 中国平安
  "0941.HK", // 中国移动
  "1088.HK", // 中国神华
  "0005.HK", // 汇丰控股
  "0001.HK", // 长和
  "0011.HK", // 恒生银行
  "0066.HK", // 港铁公司
  "2388.HK", // 中银香港
  "3968.HK", // 招商银行
  "0386.HK", // 中国石油化工
  "0857.HK", // 中国石油
  "1093.HK", // 石药集团
  "1109.HK", // 华润置地
  "0267.HK", // 中信股份
  "0002.HK", // 中电控股
  "0003.HK", // 香港中华煤气
  "0006.HK", // 电能实业
  "0016.HK", // 新鸿基地产
  "0027.HK", // 银河娱乐
  "0981.HK", // 中芯国际
  "2269.HK", // 药明生物
  "2015.HK", // 理想汽车
  "9868.HK", // 小鹏汽车
  "9866.HK", // 蔚来
  "2331.HK", // 李宁
  "6862.HK", // 海底捞
  "0788.HK", // 中国铁塔
];

function loadAllHkStocks(): HkStock[] {
  const jsonPath = path.join(process.cwd(), "data/all-hk-stocks.json");
  if (!existsSync(jsonPath)) {
    console.log("data/all-hk-stocks.json not found. Fetching via akshare...");
    const pyCmd = process.env.VIRTUAL_ENV ? `${process.env.VIRTUAL_ENV}/bin/python` : ".venv/bin/python";
    execSync(`[ -x ${pyCmd} ] && ${pyCmd} scripts/fetch-all-hk-stocks.py || python3 scripts/fetch-all-hk-stocks.py`, {
      stdio: "inherit",
    });
  }
  return JSON.parse(readFileSync(jsonPath, "utf-8")) as HkStock[];
}

async function main() {
  const dryRun = hasFlag("--dry-run");
  const force = hasFlag("--force");
  const useAllUniverse = hasFlag("--all");
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

  const allStocks = loadAllHkStocks();
  const stockMap = new Map<string, HkStock>();
  for (const s of allStocks) {
    stockMap.set(s.ticker.toUpperCase(), s);
  }

  let candidates: HkStock[] = [];

  if (explicitTickers && explicitTickers.length > 0) {
    for (const ticker of explicitTickers) {
      const found = stockMap.get(ticker);
      if (found) {
        candidates.push(found);
      } else {
        const match = ticker.match(/^(\d{1,5})\.HK$/i);
        const code = match ? match[1].padStart(5, "0") : ticker;
        candidates.push({
          code,
          name: ticker,
          ticker,
          exchange: "HKEX",
        });
      }
    }
  } else if (useAllUniverse) {
    candidates = allStocks.slice(offset);
  } else {
    // Prioritize CORE_HK_TICKERS, followed by remainder of allStocks
    const seen = new Set<string>();
    for (const t of CORE_HK_TICKERS) {
      const found = stockMap.get(t);
      if (found) {
        candidates.push(found);
        seen.add(t);
      }
    }
    for (const s of allStocks) {
      if (!seen.has(s.ticker.toUpperCase())) {
        candidates.push(s);
      }
    }
    candidates = candidates.slice(offset);
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

  const unOnboarded: HkStock[] = [];
  const alreadyOnboarded: HkStock[] = [];

  for (const cand of candidates) {
    const existing = existingMap.get(cand.ticker.toUpperCase());
    if (!force && existing && existing.financialCount > 0) {
      alreadyOnboarded.push(cand);
    } else {
      unOnboarded.push(cand);
    }
  }

  const toRun = limit ? unOnboarded.slice(0, limit) : unOnboarded;

  console.log("\n=== Hong Kong (HKEX) Batch Plan ===");
  console.log(`Total candidates scanned: ${candidates.length}`);
  console.log(`Already onboarded (has financials): ${alreadyOnboarded.length}`);
  console.log(`To run: ${toRun.length}${limit ? ` (capped by --limit ${limit})` : ""} (Phase ${phaseArg}, Delay ${delayMs}ms)`);

  if (alreadyOnboarded.length > 0) {
    console.log("\nSkipping already onboarded:");
    for (const c of alreadyOnboarded.slice(0, 15)) {
      const info = existingMap.get(c.ticker.toUpperCase());
      console.log(`  ✓ ${c.ticker} (${c.name}) [${info?.financialCount ?? 0} financials]`);
    }
    if (alreadyOnboarded.length > 15) {
      console.log(`  ... and ${alreadyOnboarded.length - 15} more`);
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
    market: "hk",
    phase: phaseArg as "1" | "2" | "all",
    delayMs,
  });

  const elapsedSec = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n========================================`);
  console.log(`=== HK Batch Onboarding Summary ===`);
  console.log(`========================================`);
  console.log(`Total processed: ${tickersToRun.length} in ${elapsedSec}s`);
  console.log(`Succeeded: ${result.succeeded.length}/${tickersToRun.length}`);

  if (result.succeeded.length > 0) {
    console.log("\nSucceeded companies:");
    for (const t of result.succeeded) {
      const c = stockMap.get(t);
      console.log(`  ✓ ${t} (${c?.name ?? "HK Stock"})`);
    }
  }

  if (result.failed.length > 0) {
    console.log("\nFailed companies:");
    for (const f of result.failed) {
      const c = stockMap.get(f.ticker);
      console.log(`  ✗ ${f.ticker} (${c?.name ?? "HK Stock"}): ${f.error}`);
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
