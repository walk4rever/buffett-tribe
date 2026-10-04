#!/usr/bin/env tsx
import prisma from "../src/lib/prisma";
import {
  getPersistedSectorClassificationStatus,
  type PersistedSectorClassificationStatus,
} from "../src/lib/sector-classification-state";
import { isSectorModelType13 } from "../src/lib/sector-classification";

interface ClassificationAuditRow {
  ticker: string | null;
  canonicalName: string;
  sectorModelType: string | null;
  source: string | null;
  metadataType: string | null;
  outcome: string | null;
  inputsHash: string | null;
}

function getIssue(row: ClassificationAuditRow): string {
  if (row.sectorModelType && !isSectorModelType13(row.sectorModelType)) return "unsupported legacy value";
  if (!row.source) return "missing provenance";
  if (row.sectorModelType && row.metadataType !== row.sectorModelType) return "field/metadata mismatch";
  return "invalid classification metadata";
}

async function main() {
  const total = await prisma.entity.count({ where: { type: "company" } });
  const withStoredType = await prisma.entity.count({
    where: { type: "company", sectorModelType: { not: null } },
  });
  const activeTotal = await prisma.entity.count({
    where: { type: "company", onboardPhase: { gt: 0 } },
  });
  const activeWithStoredType = await prisma.entity.count({
    where: { type: "company", onboardPhase: { gt: 0 }, sectorModelType: { not: null } },
  });

  const rows = await prisma.$queryRaw<ClassificationAuditRow[]>`
    SELECT
      ticker,
      "canonicalName",
      "sectorModelType",
      metadata->'sectorModel'->>'source' AS source,
      metadata->'sectorModel'->>'type' AS "metadataType",
      metadata->'sectorModel'->>'outcome' AS outcome,
      metadata->'sectorModel'->>'inputsHash' AS "inputsHash"
    FROM "Entity"
    WHERE type = 'company'
      AND ("sectorModelType" IS NOT NULL OR metadata->'sectorModel' IS NOT NULL)
    ORDER BY ticker ASC NULLS LAST, "canonicalName" ASC
  `;

  const statuses = new Map<PersistedSectorClassificationStatus, number>([
    ["classified", 0],
    ["unknown", 0],
    ["invalid", 0],
  ]);
  const distributions = new Map<string, number>();
  const invalidRows: ClassificationAuditRow[] = [];

  for (const row of rows) {
    const status = getPersistedSectorClassificationStatus(row.sectorModelType, {
      source: row.source,
      type: row.metadataType,
      outcome: row.outcome,
      inputsHash: row.inputsHash,
    });
    statuses.set(status, (statuses.get(status) ?? 0) + 1);

    if (row.sectorModelType) {
      distributions.set(row.sectorModelType, (distributions.get(row.sectorModelType) ?? 0) + 1);
    }
    if (status === "invalid") invalidRows.push(row);
  }

  console.log("Sector classification audit (read-only)");
  console.log("总公司数:", total);
  console.log("有分类字段:", withStoredType);
  console.log("未设置分类字段:", total - withStoredType);
  console.log("Phase > 0 公司:", activeTotal);
  console.log("Phase > 0 有分类字段:", activeWithStoredType);
  console.log("Phase > 0 未设置分类字段:", activeTotal - activeWithStoredType);
  console.log("字段或分类元数据记录:", rows.length);
  console.log("有效 13 类:", statuses.get("classified"));
  console.log("有效 unknown:", statuses.get("unknown"));
  console.log("需要迁移/核对:", statuses.get("invalid"));

  console.log("\n分类值分布:");
  for (const [type, count] of [...distributions].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`);
  }

  if (invalidRows.length > 0) {
    console.log("\n需要迁移/核对的记录:");
    for (const row of invalidRows.slice(0, 100)) {
      console.log(
        `  ${row.ticker ?? row.canonicalName} | ${row.sectorModelType ?? "null"} | ${getIssue(row)}`,
      );
    }
    if (invalidRows.length > 100) {
      console.log(`  … 其余 ${invalidRows.length - 100} 条省略`);
    }
  }

  console.log("\n未修改数据库。请先复核清单，再显式运行 13 类分类器迁移。");
}

main()
  .catch((error) => {
    console.error("分类状态审计失败:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
