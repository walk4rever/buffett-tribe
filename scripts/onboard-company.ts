/**
 * One-shot onboarding for a brand-new US company: chains the 7 steps that
 * today require manually running separate commands in the right order.
 *
 * Usage:
 *   npm run onboard:company -- --ticker XXXX
 *   npm run onboard:company -- --ticker XXXX --from 2020 --to 2026
 *   npm run onboard:company -- --ticker XXXX --skip-generation
 *   npm run onboard:company -- --ticker XXXX --force --fresh
 *
 * Steps (each verified against the DB after running, not just by exit code —
 * the generate:* scripts catch per-company errors internally and still exit 0):
 *   1. import:10k              -> Entity + Financial + FilingSection + R2 artifacts
 *   2. import:stock-prices:yf  -> StockPrice (skippable with --skip-price)
 *   3. generate:company-profile
 *   4. generate:business-model
 *   5. generate:value-analysis
 *   6. generate:management-analysis
 *   7. generate:valuation-analysis
 * (3-7 skippable with --skip-generation)
 *
 * Resumable: progress is checkpointed to .cache/onboard-company/<TICKER>.json;
 * a rerun skips steps already verified complete. Pass --fresh to ignore it.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import prisma from "@/lib/prisma";

type StepId =
  | "import_10k"
  | "import_price"
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
  verify: (entityId: string) => Promise<boolean>;
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

async function hasGeneratedArtifact(entityId: string, artifactType: string): Promise<boolean> {
  const count = await prisma.generatedContentVersion.count({
    where: { scopeType: "entity", scopeId: entityId, artifactType },
  });
  return count > 0;
}

async function main() {
  const ticker = normalizeTicker(getArg("--ticker"));
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

  const steps: Step[] = [
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
    {
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
    },
    {
      id: "generate_company_profile",
      label: "生成公司概览（company_profile）",
      skip: skipGeneration,
      run: () => runNpmScript("generate:company-profile", buildGenerateArgs(ticker, force)),
      verify: (entityId) => hasGeneratedArtifact(entityId, "company_profile"),
    },
    {
      id: "generate_business_model",
      label: "生成业务概览与商业画布（business_overview）",
      skip: skipGeneration,
      run: () => runNpmScript("generate:business-model", buildGenerateArgs(ticker, force)),
      verify: (entityId) => hasGeneratedArtifact(entityId, "business_overview"),
    },
    {
      id: "generate_value_analysis",
      label: "生成价值分析（value_analysis）",
      skip: skipGeneration,
      run: () => runNpmScript("generate:value-analysis", buildGenerateArgs(ticker, force)),
      verify: (entityId) => hasGeneratedArtifact(entityId, "value_analysis"),
    },
    {
      id: "generate_management_analysis",
      label: "生成管理分析（management_analysis）",
      skip: skipGeneration,
      run: () => runNpmScript("generate:management-analysis", buildGenerateArgs(ticker, force)),
      verify: (entityId) => hasGeneratedArtifact(entityId, "management_analysis"),
    },
    {
      id: "generate_valuation_analysis",
      label: "生成估值分析（valuation_analysis）",
      skip: skipGeneration,
      run: () => runNpmScript("generate:valuation-analysis", buildGenerateArgs(ticker, force)),
      verify: (entityId) => hasGeneratedArtifact(entityId, "valuation_analysis"),
    },
  ];

  console.log(`\nOnboarding ${ticker} (${fromYear} -> ${toYear})`);
  if (dryRun) console.log("(dry run — no commands will execute)");
  console.log(`Checkpoint: ${checkpointFile(ticker)}\n`);

  const summary: Array<{ step: StepId; label: string; status: "skipped" | "already_done" | "done" | "failed" }> = [];

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
    await step.run();

    // Steps before import_10k completes have no entityId yet; resolve fresh each time
    // since import_10k may have just created it.
    const entityId = await findEntityId(ticker);
    if (!entityId) {
      throw new Error(`Entity for ${ticker} not found after step "${step.id}" — cannot verify or continue`);
    }

    const ok = await step.verify(entityId);
    if (!ok) {
      summary.push({ step: step.id, label: step.label, status: "failed" });
      console.error(`${prefix} — ran but verification found no data written`);
      break;
    }

    checkpoint.completed[step.id] = { completedAt: new Date().toISOString() };
    await saveCheckpoint(checkpoint);
    summary.push({ step: step.id, label: step.label, status: "done" });
    console.log(`${prefix} — done`);
  }

  console.log("\n=== Onboarding summary ===");
  for (const row of summary) {
    console.log(`  [${row.status.padEnd(12)}] ${row.label}`);
  }
  const failed = summary.some((row) => row.status === "failed");
  console.log(failed ? "\nOnboarding incomplete — rerun the same command to resume from the failed step.\n" : "\nOnboarding complete.\n");

  await prisma.$disconnect();
  if (failed) process.exit(1);
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
