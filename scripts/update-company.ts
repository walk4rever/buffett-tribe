/**
 * Refresh an already-onboarded company: check SEC for a newer 10-K/20-F/40-F,
 * refresh stock prices, and regenerate the 5 LLM artifacts when triggered.
 *
 * Two independent regeneration triggers:
 *   1. New filing detected -> underlying facts changed, force-overwrite all
 *      5 artifacts (existing content is now stale).
 *   2. No new filing, but at least one artifact has never been generated
 *      (company page is still falling back to generic mock narrative /
 *      "构建中" placeholders) -> backfill run without --force, so each
 *      generate:* script's own skip-if-exists check leaves already-real
 *      content untouched and only fills the actual gaps.
 * --force-regenerate always forces all 5, regardless of either signal.
 *
 * Mirrors PRODUCT.md's "动静分离" principle — numbers (price, financials)
 * refresh cheaply and often; LLM narrative only regenerates when triggered
 * by a real event, not on a blind schedule, to avoid burning LLM spend
 * re-writing unchanged analysis.
 *
 * Usage:
 *   npm run update:company -- --ticker XXXX
 *   npm run update:company -- --ticker XXXX --from 2025 --to 2026
 *   npm run update:company -- --ticker XXXX --skip-price
 *   npm run update:company -- --ticker XXXX --force-regenerate
 *
 * Unlike onboard-company.ts (which checkpoints "already done, skip"), this
 * script re-checks live DB state on every run — that check IS the mechanism
 * for deciding whether to regenerate, so there's nothing to checkpoint.
 */

import { spawn } from "node:child_process";
import prisma from "@/lib/prisma";

const FILING_KINDS = ["10k", "20f", "40f"];
const GENERATE_STEPS = [
  { script: "generate:company-profile", artifactType: "company_profile", label: "公司概览" },
  { script: "generate:business-model", artifactType: "business_overview", label: "业务概览/商业画布" },
  { script: "generate:value-analysis", artifactType: "value_analysis", label: "价值分析" },
  { script: "generate:management-analysis", artifactType: "management_analysis", label: "管理分析" },
  { script: "generate:valuation-analysis", artifactType: "valuation_analysis", label: "估值分析" },
] as const;

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

// generate:* scripts catch a single company's LLM/parse error internally,
// print "  Failed: ..." and still exit 0 — capture output so that failure
// mode is actually caught, instead of trusting the exit code.
function runNpmScriptCaptured(script: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", ["run", script, "--", ...args], { env: process.env, cwd: process.cwd() });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
      process.stderr.write(chunk);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`npm run ${script} exited with code ${code}`));
        return;
      }
      resolve(output);
    });
  });
}

async function findEntity(ticker: string) {
  return prisma.entity.findFirst({
    where: { type: "company", ticker: { equals: ticker, mode: "insensitive" } },
    select: { id: true, cik: true },
  });
}

async function countFilings(entityId: string): Promise<number> {
  return prisma.extSource.count({
    where: { filerEntityId: entityId, kind: { in: FILING_KINDS } },
  });
}

async function maxStockPriceDate(ticker: string): Promise<Date | null> {
  const row = await prisma.stockPrice.aggregate({
    where: { ticker },
    _max: { date: true },
  });
  return row._max.date ?? null;
}

async function maxVersionSeq(entityId: string, artifactType: string): Promise<number> {
  const row = await prisma.generatedContentVersion.aggregate({
    where: { scopeType: "entity", scopeId: entityId, artifactType },
    _max: { versionSeq: true },
  });
  return row._max.versionSeq ?? 0;
}

async function findMissingArtifacts(entityId: string) {
  const missing: typeof GENERATE_STEPS[number][] = [];
  for (const step of GENERATE_STEPS) {
    const seq = await maxVersionSeq(entityId, step.artifactType);
    if (seq === 0) missing.push(step);
  }
  return missing;
}

async function main() {
  const ticker = normalizeTicker(getArg("--ticker"));
  const defaultToYear = new Date().getUTCFullYear();
  const fromYear = getArg("--from") ?? String(defaultToYear - 1);
  const toYear = getArg("--to") ?? String(defaultToYear);
  const skipPrice = hasFlag("--skip-price");
  const forceRegenerate = hasFlag("--force-regenerate");

  const entity = await findEntity(ticker);
  if (!entity) {
    throw new Error(`${ticker} not found (type=company). Run onboard:company first for a brand-new company.`);
  }

  console.log(`\nUpdating ${ticker} (checking filings ${fromYear} -> ${toYear})`);

  // 1. Check for a new annual filing (idempotent upserts underneath, so
  // re-running on years already imported is safe — just slower than skipping).
  const beforeFilingCount = await countFilings(entity.id);
  console.log(`\n[1/3] 检查年报（当前 ${beforeFilingCount} 份 10-K/20-F/40-F）`);
  await runNpmScript("import:10k", ["--ticker", ticker, "--from", fromYear, "--to", toYear]);
  const afterFilingCount = await countFilings(entity.id);
  const newFilingDetected = afterFilingCount > beforeFilingCount;
  console.log(
    newFilingDetected
      ? `[1/3] 发现新年报：${beforeFilingCount} -> ${afterFilingCount} 份`
      : `[1/3] 无新年报（仍是 ${afterFilingCount} 份）`,
  );

  // 2. Price refresh: cheap, no reason to gate it behind filing detection.
  if (!skipPrice) {
    console.log(`\n[2/3] 刷新股价`);
    const beforeMaxDate = await maxStockPriceDate(ticker);
    await runNpmScript("import:stock-prices:yf", ["--ticker", ticker, "--import-db"]);
    const afterMaxDate = await maxStockPriceDate(ticker);
    if (!afterMaxDate) {
      throw new Error(`股价刷新后 ${ticker} 在 StockPrice 里仍查不到数据`);
    }
    const daysSinceLatest = (Date.now() - afterMaxDate.getTime()) / (1000 * 60 * 60 * 24);
    console.log(
      `[2/3] 股价最新日期 ${afterMaxDate.toISOString().slice(0, 10)}` +
        (beforeMaxDate ? `（此前 ${beforeMaxDate.toISOString().slice(0, 10)}）` : "") +
        (daysSinceLatest > 10 ? " — 距今超过 10 天，请确认 ticker 或数据源是否正常" : ""),
    );
  } else {
    console.log(`\n[2/3] 刷新股价 — 跳过（--skip-price）`);
  }

  // 3. Two independent triggers for regeneration: a new filing (facts changed,
  // must overwrite) or missing artifacts (page still showing mock/占位 content,
  // safe to backfill without touching anything that's already real).
  const missingArtifacts = await findMissingArtifacts(entity.id);
  const hasMockContent = missingArtifacts.length > 0;
  const force = newFilingDetected || forceRegenerate;
  const shouldRun = force || hasMockContent;

  if (!shouldRun) {
    console.log(`\n[3/3] 跳过 LLM 重新生成 — 没有新年报，内容也已全部生成过（如需强制刷新用 --force-regenerate）`);
  } else {
    const reason = newFilingDetected
      ? "检测到新年报"
      : forceRegenerate
        ? "--force-regenerate"
        : `${missingArtifacts.length} 项仍是占位内容（${missingArtifacts.map((s) => s.label).join("、")}）`;
    console.log(
      `\n[3/3] ${force ? "强制重新生成" : "补齐缺失的"} LLM 分析（原因：${reason}）` +
        (force ? "" : "，已有真实内容的项会被脚本自身跳过，不会重复生成"),
    );
    for (const [index, step] of GENERATE_STEPS.entries()) {
      const prefix = `  [${index + 1}/${GENERATE_STEPS.length}] ${step.label}`;
      const beforeSeq = await maxVersionSeq(entity.id, step.artifactType);
      const args = ["--company", ticker];
      if (force) args.push("--force");
      const output = await runNpmScriptCaptured(step.script, args);
      // "SKIP: already has ..." is a legitimate outcome (content already real,
      // possibly from before this artifact type wrote to GeneratedContentVersion
      // at all — versionSeq alone can't tell skip apart from silent failure).
      // "  Failed: ..." is the one signal every generate:* script actually uses
      // for a caught per-company error, so that's the real failure check.
      if (/^\s*Failed:/m.test(output)) {
        throw new Error(`${prefix} 内部报错生成失败，见上方 "Failed:" 输出`);
      }
      const afterSeq = await maxVersionSeq(entity.id, step.artifactType);
      console.log(
        afterSeq > beforeSeq
          ? `${prefix} — done（v${beforeSeq} -> v${afterSeq}）`
          : `${prefix} — 已有真实内容，跳过`,
      );
    }
  }

  console.log(`\n${ticker} 更新完成。`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[update-company] fatal", err instanceof Error ? err.message : String(err));
  await prisma.$disconnect();
  process.exit(1);
});
