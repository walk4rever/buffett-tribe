/**
 * Audit Polluted Financials (存量脏财务数据定点审计脚本)
 *
 * 专门扫描 Financial 表中被金额或错误标签污染的 CommonStockSharesOutstanding 记录：
 * 1. 单位被标为货币（CNY, USD, HKD 等）而非 shares/pure
 * 2. 股数极端异常（例如 > 5000 亿股）
 * 3. 产生不合常理的万万亿级推导市值
 *
 * 纯只读审计，输出报告，绝不修改库内数据。
 *
 * Usage:
 *   npx tsx scripts/audit-polluted-financials.ts
 *   npx tsx scripts/audit-polluted-financials.ts --out logs/polluted-shares-report.json
 */

import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";

const prisma = new PrismaClient();

export interface PollutedShareRecord {
  id: string;
  entityId: string;
  ticker: string | null;
  canonicalName: string;
  periodEnd: string;
  periodType: string;
  value: number;
  unit: string | null;
  rawXbrlTag: string | null;
  mappingRule: string | null;
  reason: string;
}

export interface RawShareRow {
  id: string;
  entityId: string;
  periodEnd: Date;
  periodType: string;
  value: number | null;
  unit: string | null;
  rawXbrlTag: string | null;
  mappingRule: string | null;
  entity: {
    ticker: string | null;
    canonicalName: string;
    market: string;
  } | null;
}

const currencyUnits = new Set(["CNY", "USD", "HKD", "RMB", "EUR", "JPY", "GBP"]);

export function inspectShareRow(r: RawShareRow): PollutedShareRecord | null {
  if (r.value == null) return null;
  const numVal = Number(r.value);
  const unitUpper = (r.unit ?? "").toUpperCase();
  const reasons: string[] = [];

  // 判定 1: 单位被标为货币代码
  if (currencyUnits.has(unitUpper)) {
    reasons.push(`单位错误标为货币: ${r.unit}`);
  }

  // 判定 2: 单期股数超过 5000 亿股
  if (numVal > 500_000_000_000) {
    reasons.push(`股数数量级异常: ${numVal.toLocaleString()}`);
  }

  // 判定 3: 负数股数
  if (numVal < 0) {
    reasons.push(`股数为负数: ${numVal}`);
  }

  if (reasons.length === 0) return null;

  return {
    id: r.id,
    entityId: r.entityId,
    ticker: r.entity?.ticker ?? null,
    canonicalName: r.entity?.canonicalName ?? "Unknown",
    periodEnd: r.periodEnd.toISOString().slice(0, 10),
    periodType: r.periodType,
    value: numVal,
    unit: r.unit,
    rawXbrlTag: r.rawXbrlTag,
    mappingRule: r.mappingRule,
    reason: reasons.join("; "),
  };
}

export function buildAuditReport(params: {
  totalScanned: number;
  polluted: PollutedShareRecord[];
}): {
  timestamp: string;
  totalScanned: number;
  pollutedCount: number;
  pollutedEntityCount: number;
  records: PollutedShareRecord[];
} {
  const entityIds = new Set(params.polluted.map((p) => p.entityId));
  return {
    timestamp: new Date().toISOString(),
    totalScanned: params.totalScanned,
    pollutedCount: params.polluted.length,
    pollutedEntityCount: entityIds.size,
    records: params.polluted,
  };
}

export async function processShareBatches(
  fetchBatch: (skip: number, take: number) => Promise<RawShareRow[]>,
  totalRows: number,
  batchSize = 2000,
  onProgress?: (scanned: number, total: number, pollutedCount: number) => void,
) {
  let skip = 0;
  let totalScanned = 0;
  const polluted: PollutedShareRecord[] = [];
  const entityIds = new Set<string>();

  while (skip < totalRows) {
    const rows = await fetchBatch(skip, batchSize);
    if (rows.length === 0) break;

    for (const r of rows) {
      const anomaly = inspectShareRow(r);
      if (anomaly) {
        polluted.push(anomaly);
        entityIds.add(anomaly.entityId);
      }
    }

    skip += rows.length;
    totalScanned += rows.length;
    onProgress?.(skip, totalRows, polluted.length);
  }

  return {
    totalScanned,
    polluted,
    entityIds,
    report: buildAuditReport({ totalScanned, polluted }),
  };
}

async function main() {
  console.log("=== 启动存量错误股数 (CommonStockSharesOutstanding) 专项审计 ===");

  const totalShareRows = await prisma.financial.count({
    where: { lineItem: "CommonStockSharesOutstanding" },
  });
  console.log(`全库 CommonStockSharesOutstanding 总行数: ${totalShareRows}`);

  const BATCH_SIZE = 2000;
  const { totalScanned, polluted, entityIds, report } = await processShareBatches(
    (skip, take) =>
      prisma.financial.findMany({
        where: { lineItem: "CommonStockSharesOutstanding" },
        skip,
        take,
        select: {
          id: true,
          entityId: true,
          periodEnd: true,
          periodType: true,
          value: true,
          unit: true,
          rawXbrlTag: true,
          mappingRule: true,
          entity: {
            select: {
              ticker: true,
              canonicalName: true,
              market: true,
            },
          },
        },
      }),
    totalShareRows,
    BATCH_SIZE,
    (scanned, total, pCount) => {
      process.stdout.write(`\r已扫描 ${scanned} / ${total} 行... (检出异常: ${pCount})`);
    },
  );
  console.log();

  console.log(`\n审计结果总结:`);
  console.log(`- 扫描总行数: ${totalScanned}`);
  console.log(`- 检出异常污染行数: ${polluted.length} (${((polluted.length / (totalScanned || 1)) * 100).toFixed(2)}%)`);
  console.log(`- 受影响公司数: ${entityIds.size}`);

  if (polluted.length > 0) {
    console.log(`\n抽样前 15 条异常记录:`);
    for (const p of polluted.slice(0, 15)) {
      console.log(`  [${p.ticker ?? p.entityId}] ${p.canonicalName} (${p.periodEnd} ${p.periodType}): value=${p.value.toLocaleString()}, unit=${p.unit} -> 原因: ${p.reason}`);
    }
  }

  const outIdx = process.argv.indexOf("--out");
  const outFile = outIdx !== -1 && process.argv[outIdx + 1] ? process.argv[outIdx + 1] : "logs/polluted-shares-report.json";
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2), "utf8");
  console.log(`\n完整异常报告已落盘至: ${outFile}`);
}

const isDirectRun =
  typeof process !== "undefined" &&
  process.argv[1] &&
  path.basename(process.argv[1]).includes("audit-polluted-financials");

if (isDirectRun) {
  main().finally(() => prisma.$disconnect());
}
