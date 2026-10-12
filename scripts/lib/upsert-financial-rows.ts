import type { Prisma, PrismaClient } from "@prisma/client";

type FinancialWriteClient = Pick<PrismaClient, "$transaction" | "financial">;

export async function upsertFinancialRows(
  db: FinancialWriteClient,
  rows: Prisma.FinancialCreateManyInput[],
): Promise<number> {
  if (!rows.length) return 0;

  const operations = rows.map((row) =>
    db.financial.upsert({
      where: {
        entityId_periodEnd_periodType_lineItem: {
          entityId: row.entityId,
          periodEnd: row.periodEnd,
          periodType: row.periodType,
          lineItem: row.lineItem,
        },
      },
      create: row,
      update: {
        sourceId: row.sourceId,
        value: row.value,
        unit: row.unit,
        rawXbrlTag: row.rawXbrlTag,
        mappingRule: row.mappingRule,
        confidence: row.confidence,
      },
    }),
  );

  await db.$transaction(operations);
  return rows.length;
}
