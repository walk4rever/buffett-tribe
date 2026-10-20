import { randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

const MAX_ROWS_PER_TRANSACTION = 50;

type FinancialWriteClient = Pick<PrismaClient, "$executeRaw" | "$transaction" | "financial">;

function compareFinancialRows(
  left: Prisma.FinancialCreateManyInput,
  right: Prisma.FinancialCreateManyInput,
) {
  return (
    left.entityId.localeCompare(right.entityId) ||
    new Date(left.periodEnd).getTime() - new Date(right.periodEnd).getTime() ||
    left.periodType.localeCompare(right.periodType) ||
    left.lineItem.localeCompare(right.lineItem)
  );
}

function financialRowKey(row: Prisma.FinancialCreateManyInput) {
  return JSON.stringify([
    row.entityId,
    new Date(row.periodEnd).toISOString(),
    row.periodType,
    row.lineItem,
  ]);
}

function createUpsertStatement(rows: Prisma.FinancialCreateManyInput[]) {
  const values = rows.map((row) =>
    Prisma.sql`(
      ${randomUUID()},
      ${row.entityId},
      ${row.sourceId},
      ${row.periodEnd},
      ${row.periodType},
      ${row.lineItem},
      ${row.value ?? null},
      ${row.unit ?? null},
      ${row.rawXbrlTag ?? null},
      ${row.mappingRule ?? null},
      ${row.confidence ?? 1}
    )`,
  );

  return Prisma.sql`
    INSERT INTO "Financial" (
      "id",
      "entityId",
      "sourceId",
      "periodEnd",
      "periodType",
      "lineItem",
      "value",
      "unit",
      "rawXbrlTag",
      "mappingRule",
      "confidence"
    )
    VALUES ${Prisma.join(values)}
    ON CONFLICT ("entityId", "periodEnd", "periodType", "lineItem")
    DO UPDATE SET
      "sourceId" = EXCLUDED."sourceId",
      "value" = EXCLUDED."value",
      "unit" = EXCLUDED."unit",
      "rawXbrlTag" = CASE
        WHEN "Financial"."value" IS NOT DISTINCT FROM EXCLUDED."value"
          THEN COALESCE(EXCLUDED."rawXbrlTag", "Financial"."rawXbrlTag")
        ELSE EXCLUDED."rawXbrlTag"
      END,
      "mappingRule" = CASE
        WHEN "Financial"."value" IS NOT DISTINCT FROM EXCLUDED."value"
          THEN COALESCE(EXCLUDED."mappingRule", "Financial"."mappingRule")
        WHEN EXCLUDED."mappingRule" IS NOT NULL
          THEN EXCLUDED."mappingRule"
        ELSE 'source-changed:unverified'
      END,
      "confidence" = CASE
        WHEN "Financial"."value" IS NOT DISTINCT FROM EXCLUDED."value"
          THEN LEAST("Financial"."confidence", EXCLUDED."confidence")
        ELSE EXCLUDED."confidence"
      END
  `;
}

export async function upsertFinancialRows(
  db: FinancialWriteClient,
  rows: Prisma.FinancialCreateManyInput[],
): Promise<number> {
  if (!rows.length) return 0;

  const deduplicatedRows = new Map<string, Prisma.FinancialCreateManyInput>();
  for (const row of rows) deduplicatedRows.set(financialRowKey(row), row);
  const sortedRows = [...deduplicatedRows.values()].sort(compareFinancialRows);
  for (let offset = 0; offset < sortedRows.length; offset += MAX_ROWS_PER_TRANSACTION) {
    const chunk = sortedRows.slice(offset, offset + MAX_ROWS_PER_TRANSACTION);
    const operations = [
      db.$executeRaw`SET LOCAL lock_timeout = '5s'`,
      db.$executeRaw`SET LOCAL statement_timeout = '30s'`,
      db.$executeRaw(createUpsertStatement(chunk)),
    ];
    await db.$transaction(operations);
  }

  // Auto-GC: delete obsolete non-FY interim rows whose periodEnd <= max(FY.periodEnd)
  const maxFyByEntity = new Map<string, Date>();
  for (const row of sortedRows) {
    if (row.periodType === "FY") {
      const dt = new Date(row.periodEnd);
      const existing = maxFyByEntity.get(row.entityId);
      if (!existing || dt > existing) {
        maxFyByEntity.set(row.entityId, dt);
      }
    }
  }

  if (maxFyByEntity.size > 0) {
    for (const [entityId, maxFyDate] of maxFyByEntity.entries()) {
      await db.$executeRaw`
        DELETE FROM "Financial"
        WHERE "entityId" = ${entityId}
          AND "periodType" <> 'FY'
          AND "periodEnd" <= ${maxFyDate}
      `;
    }
  }

  return sortedRows.length;
}
