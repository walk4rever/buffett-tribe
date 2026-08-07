/**
 * One-shot onboarding for a brand-new company: chains the steps that today
 * require manually running separate commands in the right order.
 *
 * Usage:
 *   npm run onboard:company -- --ticker XXXX
 *   npm run onboard:company -- --ticker XXXX --from 2020 --to 2026
 *   npm run onboard:company -- --ticker XXXX --skip-generation
 *   npm run onboard:company -- --ticker XXXX --force --fresh
 *   npm run onboard:company -- --ticker 9992.HK --market hk
 *   npm run onboard:company -- --ticker 600519.SS --market cn
 *
 * US steps (default, each verified against the DB after running, not just by
 * exit code — the generate:* scripts catch per-company errors internally and
 * still exit 0):
 *   1. import:10k              -> Entity + Financial + FilingSection + R2 artifacts
 *   2. import:stock-prices:yf  -> StockPrice (skippable with --skip-price)
 *   3. generate:company-profile
 *   4. generate:business-model
 *   5. generate:value-analysis
 *   6. generate:management-analysis
 *   7. generate:valuation-analysis
 * (3-7 skippable with --skip-generation)
 *
 * CN/HK steps (--market cn|hk): seed_entity (canonicalName/nameZh/
 * nameEnShort/exchange/industry auto-fetched via akshare — see
 * scripts/fetch-cn-hk-company-profile-ak.py; sector LLM-classified into the
 * same 9-bucket vocabulary the US path's mapSectorFromSic() produces — see
 * scripts/lib/cn-hk-sector-classify.ts. scripts/lib/cn-hk-company-seeds.ts
 * is now only a manual override for the rare bad-data case, not required to
 * onboard a new company — TODOS.md P0 ④) -> import_price -> [cn:
 * import_financials -> import_annual_report | hk: import_annual_report ->
 * import_financials, reordered because HK's reporting currency can only be
 * resolved from the annual report text — see
 * scripts/lib/cn-hk-currency-resolve.ts; CN's is a hardcoded regulatory
 * fact, no such dependency] (HKEXnews for hk / cninfo for cn — different
 * retrieval mechanics per market, see scripts/fetch-hk-annual-report.py and
 * scripts/fetch-cn-annual-report.py; both search+download+pypdf text
 * extraction+R2 PDF archive; --from applies here too, same "2020" default
 * as the US path) -> the same 5 generate_* steps as US.
 * No 10-K import (no XBRL/SEC equivalent — PRODUCT.md's "跨市场扩展的三条
 * 结构约束" explicitly decided not to generalize the US extraction pipeline
 * to CN/HK). The generate_* steps used to be US-only because
 * hasUsableFilingEvidence() (scripts/lib/company-generation.ts) had nothing
 * to ground them on for CN/HK — import_annual_report's FilingSection rows
 * are what unblocks them, not a change to the generate scripts themselves.
 *
 * This is the same checkpoint/verify/resume skeleton either way — only the
 * steps list changes per market, per PRODUCT.md constraint #3 ("onboard
 * script doesn't fork per market").
 *
 * Resumable: progress is checkpointed to .cache/onboard-company/<TICKER>.json;
 * a rerun skips steps already verified complete. Pass --fresh to ignore it.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import prisma from "@/lib/prisma";
import { CN_HK_SEEDS } from "./lib/cn-hk-company-seeds";
import { resolveCnCurrency, resolveHkCurrencyFromAnnualReport } from "./lib/cn-hk-currency-resolve";

type Market = "us" | "cn" | "hk";

type StepId =
  | "seed_entity"
  | "import_10k"
  | "import_price"
  | "import_financials"
  | "import_annual_report"
  | "generate_company_profile"
  | "generate_business_model"
  | "generate_value_analysis"
  | "generate_management_analysis"
  | "generate_valuation_analysis";

type Checkpoint = {
  ticker: string;
  completed: Partial<Record<StepId, { completedAt: string }>>;
  updatedAt?: string;
};

type Step = {
  id: StepId;
  label: string;
  skip?: boolean;
  run: () => Promise<void>;
  // stepStartedAt lets a step's verify distinguish "this run actually wrote
  // something" from "the entity already had this artifact from a prior run" —
  // see wasArtifactGeneratedSince, needed because generate:*.ts scripts catch
  // their own errors and exit 0, so a plain existence check on a --force
  // rerun would report success even when the LLM call timed out and nothing
  // new was written.
  verify: (entityId: string, stepStartedAt: number) => Promise<boolean>;
};

const CHECKPOINT_DIR = path.join(process.cwd(), ".cache", "onboard-company");

function getArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  return args.find((_, i) => args[i - 1] === flag);
}

function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

function normalizeTicker(value: string | undefined): string {
  const ticker = value?.trim().toUpperCase() ?? "";
  if (!ticker) throw new Error("Missing --ticker. Example: --ticker AAPL");
  return ticker;
}

function checkpointFile(ticker: string) {
  return path.join(CHECKPOINT_DIR, `${ticker}.json`);
}

async function loadCheckpoint(ticker: string, fresh: boolean): Promise<Checkpoint> {
  if (!fresh) {
    try {
      const raw = await readFile(checkpointFile(ticker), "utf8");
      const parsed = JSON.parse(raw) as Checkpoint;
      if (parsed.ticker === ticker) return parsed;
    } catch {
      // no checkpoint yet
    }
  }
  return { ticker, completed: {} };
}

async function saveCheckpoint(checkpoint: Checkpoint) {
  await mkdir(CHECKPOINT_DIR, { recursive: true });
  checkpoint.updatedAt = new Date().toISOString();
  await writeFile(checkpointFile(checkpoint.ticker), `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
}

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

async function findEntityId(ticker: string): Promise<string | null> {
  const entity = await prisma.entity.findFirst({
    where: { type: "company", ticker: { equals: ticker, mode: "insensitive" } },
    select: { id: true },
  });
  return entity?.id ?? null;
}

// Only passes if the *latest* version was written during this step's own
// run — a plain existence check would report "done" on a --force rerun
// whose LLM call actually timed out, as long as an older version from a
// previous run was still sitting there.
async function wasArtifactGeneratedSince(
  entityId: string,
  artifactType: string,
  sinceMs: number,
): Promise<boolean> {
  const latest = await prisma.generatedContentVersion.findFirst({
    where: { scopeType: "entity", scopeId: entityId, artifactType },
    orderBy: { generatedAt: "desc" },
    select: { generatedAt: true },
  });
  return latest != null && latest.generatedAt.getTime() >= sinceMs;
}

function parseMarket(value: string | undefined): Market {
  const market = (value?.trim().toLowerCase() ?? "us") as Market;
  if (market !== "us" && market !== "cn" && market !== "hk") {
    throw new Error(`Invalid --market "${value}". Expected one of: us, cn, hk.`);
  }
  return market;
}

// TODOS.md P0 ④: canonicalName/nameZh/nameEnShort/exchange/industry are
// fetched automatically via akshare (scripts/fetch-cn-hk-company-profile-ak.py
// + scripts/import-cn-hk-company-profile-from-file.ts, sector classified by
// LLM) — CN_HK_SEEDS is no longer required to onboard a new CN/HK company.
// It's kept only as an optional manual override (a ticker present there wins
// verbatim) for the rare case akshare returns something wrong for a specific
// company — a bug-fix escape hatch, not the normal path.
function deriveCnHkCode(ticker: string, market: "cn" | "hk"): string {
  if (market === "cn") {
    const match = ticker.match(/^(\d{6})\.(SS|SZ|BJ)$/i);
    if (!match) throw new Error(`Cannot derive CN exchange code from ticker "${ticker}". Expected format like 600900.SS.`);
    return match[1];
  }
  const match = ticker.match(/^(\d{1,5})\.HK$/i);
  if (!match) throw new Error(`Cannot derive HK exchange code from ticker "${ticker}". Expected format like 9992.HK.`);
  return match[1].padStart(5, "0");
}

function resolveCnHkCode(ticker: string, market: "cn" | "hk"): string {
  const seed = CN_HK_SEEDS[ticker];
  if (seed) {
    if (seed.market !== market) {
      throw new Error(`CN_HK_SEEDS entry for "${ticker}" is market "${seed.market}", but --market ${market} was passed.`);
    }
    return seed.code;
  }
  return deriveCnHkCode(ticker, market);
}

// No @@unique([market, code]) constraint exists on Entity (only @@index), so
// both the manual-override and auto-lookup paths upsert by hand rather than
// via Prisma's where-unique upsert().
function buildSeedEntityStep(ticker: string, market: "cn" | "hk", code: string): Step {
  const seed = CN_HK_SEEDS[ticker];

  return {
    id: "seed_entity",
    label: seed
      ? `写入 Entity（${seed.nameZh} / ${market.toUpperCase()} ${code}，手工种子表覆盖）`
      : `写入 Entity（${market.toUpperCase()} ${code}，akshare 自动查询）`,
    run: async () => {
      if (seed) {
        const existing = await prisma.entity.findFirst({
          where: { type: "company", market, code },
          select: { id: true },
        });
        const data = {
          type: "company" as const,
          canonicalName: seed.canonicalName,
          ticker,
          market,
          code,
          sector: seed.sector,
          metadata: {
            nameZh: seed.nameZh,
            nameEnShort: seed.nameEnShort,
            industry: seed.industry,
            exchange: seed.exchange,
          },
        };
        if (existing) {
          await prisma.entity.update({ where: { id: existing.id }, data });
        } else {
          await prisma.entity.create({ data });
        }
        return;
      }
      await runNpmScript("import:cn-hk-company-profile", ["--code", code, "--market", market, "--ticker", ticker, "--import-db"]);
    },
    verify: async () => {
      const entity = await prisma.entity.findFirst({
        where: { type: "company", market, code },
        select: { id: true },
      });
      return entity != null;
    },
  };
}

// currency: CN is a hardcoded regulatory fact (resolveCnCurrency); HK is
// extracted from the annual report text (resolveHkCurrencyFromAnnualReport),
// which is only available once import_annual_report has run — see the HK
// step reordering in main() below. A manual CN_HK_SEEDS override still wins
// verbatim if present.
async function resolveCnHkCurrency(ticker: string, market: "cn" | "hk"): Promise<string> {
  const seed = CN_HK_SEEDS[ticker];
  if (seed) return seed.currency;
  if (market === "cn") return resolveCnCurrency();
  const entityId = await findEntityId(ticker);
  if (!entityId) throw new Error(`No Entity found for ticker ${ticker} — seed_entity must run first.`);
  return resolveHkCurrencyFromAnnualReport(entityId);
}

function buildImportFinancialsStep(ticker: string, market: "cn" | "hk", code: string): Step {
  return {
    id: "import_financials",
    label: "导入财务数据（akshare 三大报表 → Financial）",
    run: async () => {
      const currency = await resolveCnHkCurrency(ticker, market);
      return runNpmScript("import:cn-hk-financials", [
        "--code", code,
        "--market", market,
        "--ticker", ticker,
        "--currency", currency,
        "--import-db",
      ]);
    },
    verify: async (entityId) => {
      const count = await prisma.financial.count({ where: { entityId } });
      return count > 0;
    },
  };
}

function buildImportAnnualReportStep(ticker: string, market: "cn" | "hk", fromYear: string, code: string): Step {
  return {
    id: "import_annual_report",
    label: "导入年报原文（HKEXnews/cninfo → FilingSection + R2 PDF，供 LLM 生成与阅读页使用）",
    run: () => {
      const scriptName = market === "hk" ? "import:hk-annual-report" : "import:cn-annual-report";
      return runNpmScript(scriptName, ["--code", code, "--market", market, "--ticker", ticker, "--from-year", fromYear, "--import-db"]);
    },
    verify: async (entityId) => {
      // Per-filing, not per-entity — same lesson as the US 10-K path: an
      // entity-level count > 0 stays green even when one year's PDF extracts
      // zero chunks.
      const kind = `${market}-annual-report`;
      const [totalFilings, filingsWithoutSections] = await Promise.all([
        prisma.extSource.count({ where: { filerEntityId: entityId, kind } }),
        prisma.extSource.count({ where: { filerEntityId: entityId, kind, sections: { none: {} } } }),
      ]);
      return totalFilings > 0 && filingsWithoutSections === 0;
    },
  };
}

async function main() {
  const ticker = normalizeTicker(getArg("--ticker"));
  const market = parseMarket(getArg("--market"));
  const defaultToYear = new Date().getUTCFullYear();
  const fromYear = getArg("--from") ?? "2020";
  const toYear = getArg("--to") ?? String(defaultToYear);
  const priceStart = getArg("--price-start");
  const force = hasFlag("--force");
  const skipGeneration = hasFlag("--skip-generation");
  const skipPrice = hasFlag("--skip-price");
  const fresh = hasFlag("--fresh");
  const dryRun = hasFlag("--dry-run");

  const checkpoint = await loadCheckpoint(ticker, fresh);

  const importPriceStep: Step = {
    id: "import_price",
    label: "导入股价（StockPrice）",
    skip: skipPrice,
    run: () => {
      const priceArgs = ["--ticker", ticker, "--import-db"];
      if (priceStart) priceArgs.push("--start", priceStart);
      return runNpmScript("import:stock-prices:yf", priceArgs);
    },
    verify: async () => {
      const count = await prisma.stockPrice.count({ where: { ticker } });
      return count > 0;
    },
  };

  const generateSteps: Step[] = [
    {
      id: "generate_company_profile",
      label: "生成公司概览（company_profile）",
      skip: skipGeneration,
      run: () => runNpmScript("generate:company-profile", buildGenerateArgs(ticker, force)),
      verify: (entityId, stepStartedAt) => wasArtifactGeneratedSince(entityId, "company_profile", stepStartedAt),
    },
    {
      id: "generate_business_model",
      label: "生成业务概览与商业画布（business_overview）",
      skip: skipGeneration,
      run: () => runNpmScript("generate:business-model", buildGenerateArgs(ticker, force)),
      verify: (entityId, stepStartedAt) => wasArtifactGeneratedSince(entityId, "business_overview", stepStartedAt),
    },
    {
      id: "generate_value_analysis",
      label: "生成价值分析（value_analysis）",
      skip: skipGeneration,
      run: () => runNpmScript("generate:value-analysis", buildGenerateArgs(ticker, force)),
      verify: (entityId, stepStartedAt) => wasArtifactGeneratedSince(entityId, "value_analysis", stepStartedAt),
    },
    {
      id: "generate_management_analysis",
      label: "生成管理分析（management_analysis）",
      skip: skipGeneration,
      run: () => runNpmScript("generate:management-analysis", buildGenerateArgs(ticker, force)),
      verify: (entityId, stepStartedAt) => wasArtifactGeneratedSince(entityId, "management_analysis", stepStartedAt),
    },
    {
      id: "generate_valuation_analysis",
      label: "生成估值分析（valuation_analysis）",
      skip: skipGeneration,
      run: () => runNpmScript("generate:valuation-analysis", buildGenerateArgs(ticker, force)),
      verify: (entityId, stepStartedAt) => wasArtifactGeneratedSince(entityId, "valuation_analysis", stepStartedAt),
    },
  ];

  const steps: Step[] =
    market === "us"
      ? [
          {
            id: "import_10k",
            label: "导入 10-K/20-F/40-F（Entity + Financial + FilingSection + R2）",
            run: () => runNpmScript("import:10k", ["--ticker", ticker, "--from", fromYear, "--to", toYear]),
            verify: async (entityId) => {
              const financialCount = await prisma.financial.count({ where: { entityId } });
              if (financialCount === 0) return false;

              // Per-filing, not per-entity: an entity-level sectionCount > 0 check
              // stays green even when some filings extracted zero sections (e.g.
              // Ferrari/RACE 2022-2025 20-Fs silently returned 0 sections while
              // 2020-2021 worked, so the aggregate count masked the gap for weeks).
              const filingKindFilter = { in: ["10k", "20f", "40f"] };
              const [totalFilings, filingsWithoutSections] = await Promise.all([
                prisma.extSource.count({
                  where: { filerEntityId: entityId, kind: filingKindFilter },
                }),
                prisma.extSource.count({
                  where: { filerEntityId: entityId, kind: filingKindFilter, sections: { none: {} } },
                }),
              ]);
              return totalFilings > 0 && filingsWithoutSections === 0;
            },
          },
          importPriceStep,
          ...generateSteps,
        ]
      : (() => {
          const code = resolveCnHkCode(ticker, market);
          const seedEntityStep = buildSeedEntityStep(ticker, market, code);
          const importFinancialsStep = buildImportFinancialsStep(ticker, market, code);
          const importAnnualReportStep = buildImportAnnualReportStep(ticker, market, fromYear, code);
          // HK: import_financials needs the reporting currency, which for HK
          // is only resolvable from the annual report text — so annual report
          // must be imported first. CN's currency is a hardcoded constant
          // (resolveCnCurrency), no such dependency, order unchanged.
          const marketSteps =
            market === "hk"
              ? [importAnnualReportStep, importFinancialsStep]
              : [importFinancialsStep, importAnnualReportStep];
          return [seedEntityStep, importPriceStep, ...marketSteps, ...generateSteps];
        })();

  console.log(`\nOnboarding ${ticker} [market: ${market}]${market === "us" ? ` (${fromYear} -> ${toYear})` : ""}`);
  if (dryRun) console.log("(dry run — no commands will execute)");
  console.log(`Checkpoint: ${checkpointFile(ticker)}\n`);

  const summary: Array<{
    step: StepId;
    label: string;
    status: "skipped" | "already_done" | "done" | "failed";
    durationMs?: number;
  }> = [];
  const runStartedAt = Date.now();

  for (const [index, step] of steps.entries()) {
    const prefix = `[${index + 1}/${steps.length}] ${step.label}`;

    if (step.skip) {
      console.log(`${prefix} — skipped (flag)`);
      summary.push({ step: step.id, label: step.label, status: "skipped" });
      continue;
    }

    if (checkpoint.completed[step.id]) {
      console.log(`${prefix} — already completed at ${checkpoint.completed[step.id]!.completedAt}`);
      summary.push({ step: step.id, label: step.label, status: "already_done" });
      continue;
    }

    if (dryRun) {
      console.log(`${prefix} — would run`);
      continue;
    }

    console.log(`\n${prefix}`);
    const stepStartedAt = Date.now();
    await step.run();

    // Steps before import_10k completes have no entityId yet; resolve fresh each time
    // since import_10k may have just created it.
    const entityId = await findEntityId(ticker);
    if (!entityId) {
      throw new Error(`Entity for ${ticker} not found after step "${step.id}" — cannot verify or continue`);
    }

    const ok = await step.verify(entityId, stepStartedAt);
    const durationMs = Date.now() - stepStartedAt;
    if (!ok) {
      summary.push({ step: step.id, label: step.label, status: "failed", durationMs });
      console.error(`${prefix} — ran but verification found no data written (${formatDuration(durationMs)})`);
      break;
    }

    checkpoint.completed[step.id] = { completedAt: new Date().toISOString() };
    await saveCheckpoint(checkpoint);
    summary.push({ step: step.id, label: step.label, status: "done", durationMs });
    console.log(`${prefix} — done (${formatDuration(durationMs)})`);
  }

  console.log("\n=== Onboarding summary ===");
  for (const row of summary) {
    const time = row.durationMs != null ? ` (${formatDuration(row.durationMs)})` : "";
    console.log(`  [${row.status.padEnd(12)}]${time.padEnd(10)} ${row.label}`);
  }
  const totalRunMs = summary.reduce((sum, row) => sum + (row.durationMs ?? 0), 0);
  console.log(`\nTotal step time: ${formatDuration(totalRunMs)} | Wall clock: ${formatDuration(Date.now() - runStartedAt)}`);
  const failed = summary.some((row) => row.status === "failed");
  console.log(failed ? "\nOnboarding incomplete — rerun the same command to resume from the failed step.\n" : "\nOnboarding complete.\n");

  await prisma.$disconnect();
  if (failed) process.exit(1);
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m${seconds.toString().padStart(2, "0")}s`;
}

function buildGenerateArgs(ticker: string, force: boolean): string[] {
  const args = ["--company", ticker];
  if (force) args.push("--force");
  return args;
}

main().catch(async (err) => {
  console.error("[onboard-company] fatal", err instanceof Error ? err.message : String(err));
  await prisma.$disconnect();
  process.exit(1);
});
