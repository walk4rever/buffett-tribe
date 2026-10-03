#!/usr/bin/env node
/**
 * Phase 3 Fast Synchronous Update CLI
 *
 * Runs instantaneous situational refresh on a Phase 2 company:
 * - Refreshes latest price and valuation corridor metrics
 * - Evaluates fundamental red flags (cash divergence, high debt, low cash conversion)
 * - Updates P3 situational state in Entity metadata
 *
 * Usage:
 *   npx tsx scripts/update-company-phase3.ts --ticker AAPL
 *   npx tsx scripts/update-company-phase3.ts --ticker 0700.HK
 *   npx tsx scripts/update-company-phase3.ts --id <entityId>
 *   npx tsx scripts/update-company-phase3.ts --ticker AAPL --dry-run
 */

import { runPhase3Update } from "../src/lib/phase3-update";
import prisma from "../src/lib/prisma";

function getArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

async function main() {
  const ticker = getArg("--ticker") || getArg("-t");
  const entityId = getArg("--id");
  const dryRun = hasFlag("--dry-run");

  const enqueue = hasFlag("--enqueue");

  if (!ticker && !entityId) {
    console.error("用法错误: 请提供 --ticker <TICKER> 或 --id <ENTITY_ID>");
    console.error("示例: npx tsx scripts/update-company-phase3.ts --ticker AAPL [--enqueue]");
    process.exit(1);
  }

  console.log(`\n=== 正在执行 Phase 3 态势即时更新 [${ticker || entityId}] (dry-run: ${dryRun}, enqueue: ${enqueue}) ===\n`);

  try {
    const result = await runPhase3Update({
      ticker,
      entityId,
      dryRun,
      enqueueP3: enqueue,
    });

    console.log(`✅ Phase 3 更新成功！(耗时 ${result.durationMs}ms)`);
    console.log(`--------------------------------------------------`);
    console.log(`标的名称: ${result.nameZh ? `${result.nameZh} (${result.canonicalName})` : result.canonicalName} [${result.ticker}]${result.allTickers && result.allTickers.length > 1 ? ` (联动刷新全部代码: ${result.allTickers.join(", ")})` : ""}`);
    console.log(`当前阶段: Phase ${result.onboardPhase}`);
    console.log(`最新市价: $${result.latestPrice?.toFixed(2) ?? "—"} (${result.priceDate ?? "—"}) [行情已刷新: ${result.priceRefreshed ? "是" : "否"}]`);
    console.log(`当前 PE:   ${result.currentPe ? `${result.currentPe}x` : "—"}`);
    console.log(`基准 PE:   ${result.benchmarkPe ? `${result.benchmarkPe}x` : "—"}`);
    console.log(`估值状态: ${result.valuationStatus === "undervalued" ? "🟢 价值击球区" : result.valuationStatus === "overvalued" ? "🔴 估值偏高溢价区" : "🟡 合理估值中枢"} (偏离中枢: ${result.valuationDiffPct != null ? `${result.valuationDiffPct > 0 ? "+" : ""}${result.valuationDiffPct}%` : "—"})`);
    console.log(`基本面体检: ${result.fundamentalHealth === "healthy" ? "🟢 健康" : result.fundamentalHealth === "attention" ? "🟡 需关注" : "🔴 预警"}`);

    if (result.redFlags.length > 0) {
      console.log(`\n⚠️ 发现 ${result.redFlags.length} 个关注信号:`);
      for (const flag of result.redFlags) {
        console.log(`  - [${flag.level.toUpperCase()}] ${flag.title}: ${flag.message}`);
      }
    }

    if (result.newFilings && result.newFilings.length > 0) {
      console.log(`\n📁 增量财报链接: 发现并同步 ${result.newFilings.length} 份最新披露文件:`);
      for (const f of result.newFilings) {
        console.log(`  - [${f.form}] ${f.periodLabel} (${f.filingDate}) -> ${f.url}`);
      }
    }

    if (result.p3Enqueued) {
      console.log(`\n🚀 快速通道: 已自动触发入队 Phase 3 深度任务 (Priority = 100)，将由 Priority Worker 批量执行财报指标抽取与态势重算！`);
    }

    console.log(`\n态势总结:`);
    console.log(`  ${result.summary}`);
    console.log(`--------------------------------------------------\n`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`❌ Phase 3 更新失败:`, message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
