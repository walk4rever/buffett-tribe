/**
 * regenerate-hk-analyses.ts
 *
 * Re-runs the 5 dimensions of AI analysis plus company name map sync for
 * all 7 HK companies using the newly extracted high-fidelity FY2025 MD&A sections.
 *
 * Usage:
 *   node --env-file=.env.local ./node_modules/.bin/tsx scripts/regenerate-hk-analyses.ts
 *   node --env-file=.env.local ./node_modules/.bin/tsx scripts/regenerate-hk-analyses.ts --ticker 9992.HK
 */

import { spawn } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const HK_TICKERS = [
  "9992.HK", // 泡泡玛特
  "0700.HK", // 腾讯控股
  "1810.HK", // 小米集团
  "2328.HK", // 中国财险
  "2513.HK", // 智谱
  "3690.HK", // 美团
  "9633.HK", // 农夫山泉
];

const ANALYSIS_STEPS = [
  { script: "generate:company-profile", name: "公司基本概况 (profile)" },
  { script: "generate:business-model", name: "商业模式画布 (business)" },
  { script: "generate:value-analysis", name: "价值驱动与护城河 (moat)" },
  { script: "generate:management-analysis", name: "管理层与治理 (management)" },
  { script: "generate:valuation-analysis", name: "估值分析叙事 (valuation)" },
];

function runCommand(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: "inherit", env: process.env, cwd: process.cwd() });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function runNpmScript(script: string, args: string[]) {
  const code = await runCommand("npm", ["run", script, "--", ...args]);
  if (code !== 0) throw new Error(`npm run ${script} exited with code ${code}`);
}

function getArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  const index = args.indexOf(flag);
  return index !== -1 ? args[index + 1] : undefined;
}

async function main() {
  const targetTicker = getArg("--ticker")?.trim();
  const tickers = targetTicker
    ? targetTicker.split(",").map((t) => t.trim()).filter(Boolean)
    : HK_TICKERS;

  console.log(`\n============================================================`);
  console.log(`Starting AI 5-Dimension Analysis Batch for HK Companies`);
  console.log(`Target tickers: ${tickers.join(", ")}`);
  console.log(`============================================================\n`);

  const results: Record<string, Record<string, "success" | "failed">> = {};

  for (const ticker of tickers) {
    console.log(`\n>>> [${ticker}] Beginning 5-dimension generation...`);
    results[ticker] = {};

    for (const step of ANALYSIS_STEPS) {
      console.log(`\n--> [${ticker}] Running ${step.name} (${step.script})...`);
      try {
        await runNpmScript(step.script, ["--company", ticker, "--force"]);
        results[ticker][step.script] = "success";
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[ERROR] [${ticker}] Failed on ${step.script}:`, msg);
        results[ticker][step.script] = "failed";
      }
    }

    console.log(`\n--> [${ticker}] Syncing company name map...`);
    try {
      await runNpmScript("sync:company-name-map", ["--ticker", ticker]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[ERROR] [${ticker}] Failed sync:company-name-map:`, msg);
    }
  }

  console.log(`\n============================================================`);
  console.log(`Summary of HK Analysis Batch`);
  console.log(`============================================================`);
  console.table(results);
}

main()
  .catch((err) => {
    console.error("Batch failed with error:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
