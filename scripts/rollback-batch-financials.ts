/**
 * scripts/rollback-batch-financials.ts
 *
 * 精准回滚特定批次写入的派生财务数据。
 *
 * 匹配规则：`mappingRule LIKE '%|batch:<batchId>|%'`
 * 严格使用两端定界符 `|`，杜绝 'bf-1' 误匹配 'bf-10' 等前缀碰撞。
 * 默认 DRY-RUN，执行真实删除必须显式传入 `--execute`。
 *
 * Usage:
 *   # 预览回滚影响行数（Dry-run）
 *   npx tsx scripts/rollback-batch-financials.ts --batch-id "bf-p1p2-20261015-us"
 *
 *   # 确认执行回滚
 *   npx tsx scripts/rollback-batch-financials.ts --batch-id "bf-p1p2-20261015-us" --execute
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { PrismaClient } from "@prisma/client";

export const ALLOWED_FLAGS = new Set(["--batch-id", "--execute", "--dry-run", "--help", "-h"]);

export interface RollbackOptions {
  batchId: string;
  execute?: boolean;
}

export interface RollbackResult {
  batchId: string;
  strictTag: string;
  affectedCount: number;
  deletedCount: number;
  isDryRun: boolean;
  sampleRecords: Array<{
    id: string;
    entityId: string;
    lineItem: string;
    periodEnd: string;
    mappingRule: string | null;
  }>;
}

export function parseRollbackArgs(args: string[]): RollbackOptions {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("-")) {
      if (!ALLOWED_FLAGS.has(arg)) {
        throw new Error(`[rollback] 未知命令行参数: ${arg}。允许的参数: ${Array.from(ALLOWED_FLAGS).join(", ")}`);
      }
    }
  }

  const batchIdIndex = args.indexOf("--batch-id");
  const batchId = batchIdIndex >= 0 && batchIdIndex + 1 < args.length ? args[batchIdIndex + 1] : undefined;

  if (!batchId || batchId.trim() === "" || batchId.startsWith("-")) {
    throw new Error("[rollback] 必须通过 --batch-id <id> 指定要回滚的批次号，严禁无批次操作！");
  }

  if (!/^[a-zA-Z0-9_\-]+$/.test(batchId.trim())) {
    throw new Error(`[rollback] 批次号格式不合法: "${batchId}"。只允许英文字母、数字、下划线和连字符。`);
  }

  const execute = args.includes("--execute");
  return { batchId: batchId.trim(), execute };
}

export function buildStrictBatchTag(batchId: string): string {
  return `|batch:${batchId}|`;
}

export async function rollbackBatch(
  options: RollbackOptions,
  db: Pick<PrismaClient, "financial"> = new PrismaClient()
): Promise<RollbackResult> {
  const { batchId, execute = false } = options;
  if (!batchId || batchId.trim() === "") {
    throw new Error("[rollback] 批次号不能为空");
  }

  const strictTag = buildStrictBatchTag(batchId);

  // 1. 查找匹配的记录
  const affectedCount = await db.financial.count({
    where: { mappingRule: { contains: strictTag } },
  });

  const samples = await db.financial.findMany({
    where: { mappingRule: { contains: strictTag } },
    take: 5,
    select: { id: true, entityId: true, lineItem: true, periodEnd: true, mappingRule: true },
  });

  const sampleRecords = samples.map((s) => ({
    id: s.id,
    entityId: s.entityId,
    lineItem: s.lineItem,
    periodEnd: s.periodEnd.toISOString(),
    mappingRule: s.mappingRule,
  }));

  if (!execute) {
    return {
      batchId,
      strictTag,
      affectedCount,
      deletedCount: 0,
      isDryRun: true,
      sampleRecords,
    };
  }

  // 2. 执行删除
  const result = await db.financial.deleteMany({
    where: { mappingRule: { contains: strictTag } },
  });

  return {
    batchId,
    strictTag,
    affectedCount,
    deletedCount: result.count,
    isDryRun: false,
    sampleRecords,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
精准批次财务数据回滚工具

用法:
  npx tsx scripts/rollback-batch-financials.ts --batch-id <ID>           # 预览回滚影响 (Dry-Run)
  npx tsx scripts/rollback-batch-financials.ts --batch-id <ID> --execute # 执行物理回滚
`);
    return;
  }

  const options = parseRollbackArgs(args);
  const prisma = new PrismaClient();

  try {
    console.log(`\n======================================================`);
    console.log(`🔄 批次财务回滚工具 | 目标批次: [${options.batchId}]`);
    console.log(`匹配标签: "${buildStrictBatchTag(options.batchId)}"`);
    console.log(`运行模式: ${options.execute ? "⚠️ 物理删除 (EXECUTE)" : "ℹ️ 预览 (DRY-RUN)"}`);
    console.log(`======================================================\n`);

    const result = await rollbackBatch(options, prisma);

    console.log(`扫描结果: 共发现 ${result.affectedCount} 条匹配的派生记录。`);

    if (result.sampleRecords.length > 0) {
      console.log(`\n抽样记录 (最多 5 条):`);
      for (const s of result.sampleRecords) {
        console.log(`  - Entity: ${s.entityId} | 科目: ${s.lineItem.padEnd(16)} | 期间: ${s.periodEnd.slice(0, 10)} | 规则: ${s.mappingRule}`);
      }
    }

    if (result.isDryRun) {
      console.log(`\nℹ️ [DRY-RUN] 当前为预览模式，数据库未做任何更改。`);
      if (result.affectedCount > 0) {
        console.log(`👉 如确认回滚，请追加 --execute 参数执行:`);
        console.log(`   npx tsx scripts/rollback-batch-financials.ts --batch-id "${options.batchId}" --execute\n`);
      }
    } else {
      console.log(`\n✅ 成功回滚批次 [${options.batchId}]！`);
      console.log(`   共物理删除 ${result.deletedCount} 条派生数据。`);
      console.log(`   底层官方原始财务数据与其他批次未受任何影响。\n`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.includes("rollback-batch-financials.ts")) {
  main().catch((err) => {
    console.error(`\n❌ 回滚执行失败:`, err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
