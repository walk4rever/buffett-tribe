/**
 * One-shot onboarding for a brand-new Alpha investor (a 13F filer shown under
 * "Alpha 投资人", distinct from the core tribe members). Chains the steps that
 * today require hand-editing two source files and running two separate scripts:
 *
 *   1. register_filer          -> FILERS entry in scripts/lib/13f-import-core.ts
 *   2. register_tribe_member   -> TRIBE_MEMBERS entry in src/lib/tribe.ts (category: "alpha")
 *   3. import_13f               -> npm run import:13f -- --filer <id> (Entity + Holding)
 *   4. generate_master_profile -> npm run generate:master-profile -- --master <id>
 *                                 (LLM bio/timeline/framework, written to MasterProfile;
 *                                 without this the profile page has no hand-written
 *                                 FALLBACK_BRIEF entry either and shows a generic
 *                                 placeholder instead of real content — skippable with
 *                                 --skip-generation)
 *   5. generate_portfolio_insight -> npm run generate:portfolio-insight -- --master <id>
 *                                 (LLM quarterly holdings commentary, written to
 *                                 PortfolioInsight; without this the "持仓洞察" section
 *                                 on the profile page stays empty — skippable with
 *                                 --skip-generation)
 *   6. report_holdings          -> lists tickers held that have no Entity/Financial data yet;
 *                                 with --onboard-holdings, runs onboard:company for each
 *
 * Usage:
 *   npm run onboard:alpha-investor -- --id leopold-aschenbrenner \
 *     --name "Leopold Aschenbrenner" --firm "Situational Awareness LP" --cik 2045724
 *   npm run onboard:alpha-investor -- --id X --name "..." --firm "..." --cik ... --dry-run
 *   npm run onboard:alpha-investor -- --id X --name "..." --firm "..." --cik ... --onboard-holdings
 *
 * Resumable: progress is checkpointed to .cache/onboard-alpha-investor/<id>.json;
 * a rerun skips steps already verified complete. Pass --fresh to ignore it.
 * Steps 1-2 are also independently idempotent (safe to rerun even without the checkpoint).
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import prisma from "@/lib/prisma";
import {
  isFilerRegistered,
  isTribeMemberRegistered,
  registerFiler,
  registerTribeMember,
  type AlphaInvestorInput,
} from "./lib/alpha-investor-registration";

type StepId =
  | "register_filer"
  | "register_tribe_member"
  | "import_13f"
  | "generate_master_profile"
  | "generate_portfolio_insight"
  | "report_holdings";

type Checkpoint = {
  id: string;
  completed: Partial<Record<StepId, { completedAt: string }>>;
  onboardedTickers: string[];
  updatedAt?: string;
};

const CHECKPOINT_DIR = path.join(process.cwd(), ".cache", "onboard-alpha-investor");

function getArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  return args.find((_, i) => args[i - 1] === flag);
}

function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

function checkpointFile(id: string) {
  return path.join(CHECKPOINT_DIR, `${id}.json`);
}

async function loadCheckpoint(id: string, fresh: boolean): Promise<Checkpoint> {
  if (!fresh) {
    try {
      const raw = await readFile(checkpointFile(id), "utf8");
      const parsed = JSON.parse(raw) as Checkpoint;
      if (parsed.id === id) return { ...parsed, onboardedTickers: parsed.onboardedTickers ?? [] };
    } catch {
      // no checkpoint yet
    }
  }
  return { id, completed: {}, onboardedTickers: [] };
}

async function saveCheckpoint(checkpoint: Checkpoint) {
  await mkdir(CHECKPOINT_DIR, { recursive: true });
  checkpoint.updatedAt = new Date().toISOString();
  await writeFile(checkpointFile(checkpoint.id), `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
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

function normalizeId(value: string | undefined): string {
  const id = value?.trim().toLowerCase() ?? "";
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) {
    throw new Error(`Invalid --id "${value}". Use kebab-case, e.g. leopold-aschenbrenner.`);
  }
  return id;
}

function normalizeCik(value: string | undefined): string {
  const cik = value?.trim().replace(/^0+/, "") ?? "";
  if (!/^\d+$/.test(cik)) throw new Error(`Invalid --cik "${value}". Expected digits only, e.g. 2045724.`);
  return cik;
}

function deriveInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "");
  return letters.join("") || "??";
}

function buildInput(): AlphaInvestorInput {
  const id = normalizeId(getArg("--id"));
  const name = getArg("--name")?.trim();
  const firm = getArg("--firm")?.trim();
  const cik = normalizeCik(getArg("--cik"));
  if (!name) throw new Error("Missing --name.");
  if (!firm) throw new Error("Missing --firm.");

  return {
    id,
    name,
    nameZh: getArg("--name-zh")?.trim() || name,
    firm,
    cik,
    aum: getArg("--aum")?.trim() || undefined,
    color: getArg("--color")?.trim() || "#d97706",
    icon: getArg("--icon")?.trim() || "A",
    initials: getArg("--initials")?.trim() || deriveInitials(name),
    materialLabel: getArg("--material-label")?.trim() || "访谈与观点",
    materialSub: getArg("--material-sub")?.trim() || "建设中",
  };
}

async function findFilerEntity(id: string) {
  return prisma.entity.findFirst({ where: { type: "master", tribeId: id }, select: { id: true } });
}

type MissingCompany = { ticker: string; name: string; valueUsd: string | null };

async function findMissingHoldingCompanies(filerEntityId: string): Promise<MissingCompany[]> {
  const latest = await prisma.holding.findFirst({
    where: { holderEntityId: filerEntityId },
    orderBy: { asOfDate: "desc" },
    select: { asOfDate: true },
  });
  if (!latest) return [];

  const holdings = await prisma.holding.findMany({
    where: { holderEntityId: filerEntityId, asOfDate: latest.asOfDate },
    orderBy: { valueUsd: "desc" },
    include: { security: { include: { company: true } } },
  });

  const companyEntityIds = holdings
    .map((h) => h.security.companyEntityId)
    .filter((v): v is string => Boolean(v));
  const financialCounts = await prisma.financial.groupBy({
    by: ["entityId"],
    where: { entityId: { in: companyEntityIds } },
    _count: { entityId: true },
  });
  const hasFinancials = new Set(financialCounts.map((f) => f.entityId));

  const missing: MissingCompany[] = [];
  const seen = new Set<string>();
  for (const holding of holdings) {
    const ticker = holding.security.ticker ?? holding.security.company?.ticker;
    if (!ticker || seen.has(ticker)) continue;
    const companyEntityId = holding.security.companyEntityId;
    const onboarded = companyEntityId != null && hasFinancials.has(companyEntityId);
    if (onboarded) continue;
    seen.add(ticker);
    missing.push({
      ticker,
      name: holding.security.company?.canonicalName ?? holding.security.titleOfClass ?? ticker,
      valueUsd: holding.valueUsd?.toString() ?? null,
    });
  }
  return missing;
}

async function main() {
  const input = buildInput();
  const quarterList = getArg("--quarter-list");
  const fromQuarter = getArg("--from");
  const toQuarter = getArg("--to");
  const skipImport = hasFlag("--skip-import");
  const skipGeneration = hasFlag("--skip-generation");
  const onboardHoldings = hasFlag("--onboard-holdings");
  const onboardLimitArg = getArg("--onboard-limit");
  const onboardLimit = onboardLimitArg ? Number.parseInt(onboardLimitArg, 10) : undefined;
  const fresh = hasFlag("--fresh");
  const dryRun = hasFlag("--dry-run");

  const checkpoint = await loadCheckpoint(input.id, fresh);

  console.log(`\nOnboarding Alpha investor: ${input.name} (${input.firm}, CIK ${input.cik}) as "${input.id}"`);
  if (dryRun) console.log("(dry run — no files or commands will be executed)");
  console.log(`Checkpoint: ${checkpointFile(input.id)}\n`);

  const summary: Array<{ step: string; status: "skipped" | "already_done" | "done" | "failed" }> = [];

  const markDone = async (step: StepId, label: string) => {
    checkpoint.completed[step] = { completedAt: new Date().toISOString() };
    await saveCheckpoint(checkpoint);
    summary.push({ step: label, status: "done" });
    console.log(`  -> done`);
  };

  // Step 1: register filer for 13F import
  {
    const label = "[1/6] 注册 filer（scripts/lib/13f-import-core.ts::FILERS）";
    if (checkpoint.completed.register_filer) {
      console.log(`${label} — already completed`);
      summary.push({ step: label, status: "already_done" });
    } else if (dryRun) {
      console.log(`${label} — would run`);
    } else {
      console.log(`\n${label}`);
      const result = await registerFiler(input);
      console.log(`  ${result === "inserted" ? "inserted new FILERS entry" : "already present, left untouched"}`);
      const ok = await isFilerRegistered(input.id);
      if (!ok) {
        summary.push({ step: label, status: "failed" });
        console.error(`${label} — verification failed: entry not found after write`);
        return finish(summary);
      }
      await markDone("register_filer", label);
    }
  }

  // Step 2: register tribe member for UI
  {
    const label = '[2/6] 注册 tribe member（src/lib/tribe.ts::TRIBE_MEMBERS, category: "alpha"）';
    if (checkpoint.completed.register_tribe_member) {
      console.log(`${label} — already completed`);
      summary.push({ step: label, status: "already_done" });
    } else if (dryRun) {
      console.log(`${label} — would run`);
    } else {
      console.log(`\n${label}`);
      const result = await registerTribeMember(input);
      console.log(`  ${result === "inserted" ? "inserted new TRIBE_MEMBERS entry" : "already present, left untouched"}`);
      const ok = await isTribeMemberRegistered(input.id);
      if (!ok) {
        summary.push({ step: label, status: "failed" });
        console.error(`${label} — verification failed: entry not found after write`);
        return finish(summary);
      }
      await markDone("register_tribe_member", label);
    }
  }

  // Step 3: import 13F holdings
  {
    const label = "[3/6] 导入 13F 持仓（Entity + Security + Holding）";
    if (skipImport) {
      console.log(`${label} — skipped (flag)`);
      summary.push({ step: label, status: "skipped" });
    } else if (checkpoint.completed.import_13f) {
      console.log(`${label} — already completed`);
      summary.push({ step: label, status: "already_done" });
    } else if (dryRun) {
      console.log(`${label} — would run`);
    } else {
      console.log(`\n${label}`);
      const importArgs = ["--filer", input.id];
      if (quarterList) importArgs.push("--quarter-list", quarterList);
      else if (fromQuarter && toQuarter) importArgs.push("--from", fromQuarter, "--to", toQuarter);
      await runNpmScript("import:13f", importArgs);

      const filerEntity = await findFilerEntity(input.id);
      const holdingCount = filerEntity
        ? await prisma.holding.count({ where: { holderEntityId: filerEntity.id } })
        : 0;
      if (!filerEntity || holdingCount === 0) {
        summary.push({ step: label, status: "failed" });
        console.error(`${label} — ran but no Holding rows found for tribeId "${input.id}"`);
        return finish(summary);
      }
      console.log(`  -> verified ${holdingCount} Holding rows`);
      await markDone("import_13f", label);
    }
  }

  // Step 4: generate LLM investment profile (intro/framework/timeline/etc.)
  {
    const label = "[4/6] 生成投资档案（generate:master-profile -> MasterProfile）";
    if (skipGeneration) {
      console.log(`${label} — skipped (flag)`);
      summary.push({ step: label, status: "skipped" });
    } else if (checkpoint.completed.generate_master_profile) {
      console.log(`${label} — already completed`);
      summary.push({ step: label, status: "already_done" });
    } else if (dryRun) {
      console.log(`${label} — would run`);
    } else {
      console.log(`\n${label}`);
      await runNpmScript("generate:master-profile", ["--master", input.id]);

      const filerEntity = await findFilerEntity(input.id);
      const profile = filerEntity
        ? await prisma.masterProfile.findUnique({ where: { entityId: filerEntity.id } })
        : null;
      if (!profile) {
        summary.push({ step: label, status: "failed" });
        console.error(`${label} — ran but no MasterProfile row found for tribeId "${input.id}"`);
        return finish(summary);
      }
      console.log(`  -> verified MasterProfile v${profile.version}`);
      await markDone("generate_master_profile", label);
    }
  }

  // Step 5: generate quarterly portfolio insight (持仓洞察)
  {
    const label = "[5/6] 生成持仓洞察（generate:portfolio-insight -> PortfolioInsight）";
    if (skipGeneration) {
      console.log(`${label} — skipped (flag)`);
      summary.push({ step: label, status: "skipped" });
    } else if (checkpoint.completed.generate_portfolio_insight) {
      console.log(`${label} — already completed`);
      summary.push({ step: label, status: "already_done" });
    } else if (dryRun) {
      console.log(`${label} — would run`);
    } else {
      console.log(`\n${label}`);
      await runNpmScript("generate:portfolio-insight", ["--master", input.id]);

      const filerEntity = await findFilerEntity(input.id);
      const insight = filerEntity
        ? await prisma.portfolioInsight.findFirst({ where: { masterId: input.id } })
        : null;
      if (!insight) {
        summary.push({ step: label, status: "failed" });
        console.error(`${label} — ran but no PortfolioInsight row found for masterId "${input.id}"`);
        return finish(summary);
      }
      console.log(`  -> verified PortfolioInsight for ${insight.year}Q${insight.quarter}`);
      await markDone("generate_portfolio_insight", label);
    }
  }

  // Step 6: report (and optionally onboard) portfolio companies missing from the DB
  {
    const label = "[6/6] 检查持仓公司数据缺口";
    console.log(`\n${label}`);
    if (dryRun) {
      console.log(`${label} — would run`);
    } else {
      const filerEntity = await findFilerEntity(input.id);
      if (!filerEntity) {
        console.log("  filer entity not found yet (13F import skipped or not run) — nothing to check");
      } else {
        const missing = await findMissingHoldingCompanies(filerEntity.id);
        if (missing.length === 0) {
          console.log("  all held companies already have Entity + Financial data");
        } else {
          console.log(`  ${missing.length} held ticker(s) with no company profile yet:`);
          for (const c of missing) console.log(`    - ${c.ticker} (${c.name})`);

          if (onboardHoldings) {
            const toOnboard = missing
              .filter((c) => !checkpoint.onboardedTickers.includes(c.ticker))
              .slice(0, onboardLimit ?? missing.length);
            console.log(`\n  --onboard-holdings set: onboarding ${toOnboard.length} ticker(s) via onboard:company`);
            for (const c of toOnboard) {
              console.log(`\n  Onboarding ${c.ticker}...`);
              await runNpmScript("onboard:company", ["--ticker", c.ticker]);
              checkpoint.onboardedTickers.push(c.ticker);
              await saveCheckpoint(checkpoint);
            }
          } else {
            console.log("\n  pass --onboard-holdings to run `onboard:company` for each of these automatically");
          }
        }
      }
      summary.push({ step: label, status: "done" });
    }
  }

  return finish(summary);
}

async function finish(
  summary: Array<{ step: string; status: "skipped" | "already_done" | "done" | "failed" }>,
) {
  console.log("\n=== Onboarding summary ===");
  for (const row of summary) {
    console.log(`  [${row.status.padEnd(12)}] ${row.step}`);
  }
  const failed = summary.some((row) => row.status === "failed");
  console.log(
    failed
      ? "\nOnboarding incomplete — rerun the same command to resume from the failed step.\n"
      : "\nOnboarding complete.\n",
  );

  await prisma.$disconnect();
  if (failed) process.exit(1);
}

main().catch(async (err) => {
  console.error("[onboard-alpha-investor] fatal", err instanceof Error ? err.message : String(err));
  await prisma.$disconnect();
  process.exit(1);
});
