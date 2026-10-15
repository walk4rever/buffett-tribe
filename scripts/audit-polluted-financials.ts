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

interface PollutedShareRecord {
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

async function main() {
  console.log("=== 启动存量错误股数 (CommonStockSharesOutstanding) 专项审计 ===");

  const totalShareRows = await prisma.financial.count({
    where: { lineItem: "CommonStockSharesOutstanding" },
  });
  console.log(`全库 CommonStockSharesOutstanding 总行数: ${totalShareRows}`);

  const BATCH_SIZE = 2000;
  const currencyUnits = new Set(["CNY", "USD", "HKD", "RMB", "EUR", "JPY", "GBP"]);
  const polluted: PollutedShareRecord[] = [];
  const entityIds = new Set<string>();

  let skip = 0;
  while (skip < totalShareRows) {
    const rows = await prisma.financial.findMany({
      where: { lineItem: "CommonStockSharesOutstanding" },
      skip,
      take: BATCH_SIZE,
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
    });

    if (rows.length === 0) break;

    for (const r of rows) {
      if (r.value == null) continue;
      const numVal = Number(r.value);
      const unitUpper = (r.unit ?? "").toUpperCase();
      let isPolluted = false;
      const reasons: string[] = [];

      // 判定 1: 单位被标为货币代码
      if (currencyUnits.has(unitUpper)) {
        isPolluted = true;
        reasons.push(`单位错误标为货币: ${r.unit}`);
      }

      // 判定 2: 单期股数超过 5000 亿股
      if (numVal > 500_000_000_000) {
        isPolluted = true;
        reasons.push(`股数数量级异常: ${numVal.toLocaleString()}`);
      }

      // 判定 3: 负数股数
      if (numVal < 0) {
        isPolluted = true;
        reasons.push(`股数为负数: ${numVal}`);
      }

      if (isPolluted) {
        polluted.push({
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
        });
        entityIds.add(r.entityId);
      }
    }

    skip += rows.length;
    process.stdout.write(`\r已扫描 ${skip} / ${totalShareRows} 行... (检出异常: ${polluted.length})`);
  }
  console.log();

  console.log(`\n审计结果总结:`);
  console.log(`- 扫描总行数: ${totalShareRows}`);
  console.log(`- 检出异常污染行数: ${polluted.length} (${((polluted.length / (totalShareRows || 1)) * 100).toFixed(2)}%)`);
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
  fs.writeFileSync(outFile, JSON.stringify({
    timestamp: new Date().toISOString(),
    totalScanned: rows.length,
    pollutedCount: polluted.length,
    pollutedEntityCount: entityIds.size,
    records: polluted,
  }, null, 2), "utf8");
  console.log(`\n完整异常报告已落盘至: ${outFile}`);
}

main().finally(() => prisma.$disconnect());
