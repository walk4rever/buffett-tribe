import { describe, expect, it, vi } from "vitest";

import { upsertFinancialRows } from "../scripts/lib/upsert-financial-rows";

describe("upsertFinancialRows", () => {
  it("upserts only imported line items and never deletes omitted existing rows", async () => {
    const executeRaw = vi.fn((query: unknown) => query);
    const transaction = vi.fn(async (operations: unknown[]) => operations);
    const client = {
      $executeRaw: executeRaw,
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
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(executeRaw).toHaveBeenCalledTimes(4); // 3 from chunk transaction + 1 from interim GC
    const operations = transaction.mock.calls[0][0];
    expect(operations).toHaveLength(3);
    expect(operations[0]).toEqual(["SET LOCAL lock_timeout = '5s'"]);
    expect(operations[1]).toEqual(["SET LOCAL statement_timeout = '30s'"]);
    expect(operations[2]).toMatchObject({
      sql: expect.stringContaining('ON CONFLICT ("entityId", "periodEnd", "periodType", "lineItem")'),
      values: expect.any(Array),
    });
    const sql = (operations[2] as { sql: string }).sql;
    expect(sql).toContain('"rawXbrlTag" = CASE');
    expect(sql).toContain("IS NOT DISTINCT FROM");
    expect(sql).toContain('COALESCE(EXCLUDED."rawXbrlTag", "Financial"."rawXbrlTag")');
    expect(sql).toContain("source-changed:unverified");
    expect((operations[2] as { values: unknown[] }).values).toHaveLength(11);
  });

  it("splits large imports into short transactions of at most 50 rows", async () => {
    const executeRaw = vi.fn((query: unknown) => query);
    const transaction = vi.fn(async (operations: unknown[]) => operations);
    const client = {
      $executeRaw: executeRaw,
      $transaction: transaction,
    };
    const rows = Array.from({ length: 101 }, (_, index) => ({
      entityId: "entity-1",
      sourceId: "source-1",
      periodEnd: new Date("2025-12-31T00:00:00.000Z"),
      periodType: "FY",
      lineItem: `LineItem${index}`,
      value: index,
      unit: "EUR",
    }));

    await expect(upsertFinancialRows(client as never, rows)).resolves.toBe(101);

    expect(transaction).toHaveBeenCalledTimes(3);
    expect(transaction.mock.calls.map(([operations]) => operations.length)).toEqual([3, 3, 3]);
    expect(executeRaw).toHaveBeenCalledTimes(10); // 9 from 3 chunk transactions + 1 from interim GC
    expect(transaction.mock.calls.map(([operations]) =>
      (operations[2] as { values: unknown[] }).values.length,
    )).toEqual([550, 550, 11]);
  });

  it("does nothing for an empty import batch", async () => {
    const transaction = vi.fn();
    const client = {
      $executeRaw: vi.fn(),
      $transaction: transaction,
    };

    await expect(upsertFinancialRows(client as never, [])).resolves.toBe(0);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("deduplicates repeated composite keys using the last imported value", async () => {
    const executeRaw = vi.fn((query: unknown) => query);
    const transaction = vi.fn(async (operations: unknown[]) => operations);
    const client = { $executeRaw: executeRaw, $transaction: transaction };
    const duplicate = {
      entityId: "entity-1",
      sourceId: "source-1",
      periodEnd: new Date("2025-12-31T00:00:00.000Z"),
      periodType: "FY",
      lineItem: "Revenue",
      value: 100,
      unit: "EUR",
    };

    await expect(upsertFinancialRows(client as never, [
      duplicate,
      { ...duplicate, value: 200 },
    ])).resolves.toBe(1);

    const operations = transaction.mock.calls[0][0];
    expect((operations[2] as { values: unknown[] }).values[6]).toBe(200);
  });
});
