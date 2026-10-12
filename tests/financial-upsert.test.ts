import { describe, expect, it, vi } from "vitest";

import { upsertFinancialRows } from "../scripts/lib/upsert-financial-rows";

describe("upsertFinancialRows", () => {
  it("upserts only imported line items and never deletes omitted existing rows", async () => {
    const transaction = vi.fn(async (operations: unknown[]) => operations);
    const upsert = vi.fn((args: unknown) => args);
    const client = {
      financial: { upsert },
      $transaction: transaction,
    };

    const rows = [
      {
        entityId: "entity-1",
        sourceId: "source-1",
        periodEnd: new Date("2025-12-31T00:00:00.000Z"),
        periodType: "FY",
        lineItem: "Revenue",
        value: 100,
        unit: "EUR",
      },
    ];

    const written = await upsertFinancialRows(client as never, rows);

    expect(written).toBe(1);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        entityId_periodEnd_periodType_lineItem: {
          entityId: "entity-1",
          periodEnd: rows[0].periodEnd,
          periodType: "FY",
          lineItem: "Revenue",
        },
      },
      create: rows[0],
    }));
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction.mock.calls[0][0]).toHaveLength(1);
  });

  it("does nothing for an empty import batch", async () => {
    const transaction = vi.fn();
    const client = { financial: { upsert: vi.fn() }, $transaction: transaction };

    await expect(upsertFinancialRows(client as never, [])).resolves.toBe(0);
    expect(transaction).not.toHaveBeenCalled();
  });
});
