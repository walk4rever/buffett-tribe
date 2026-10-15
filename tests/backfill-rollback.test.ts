import { describe, expect, it, vi } from "vitest";
import {
  parseBackfillArgs,
  buildBackfillWhereClause,
} from "../scripts/backfill-derived-metrics";
import {
  parseRollbackArgs,
  buildStrictBatchTag,
  rollbackBatch,
} from "../scripts/rollback-batch-financials";

describe("派生回填与精准回滚安全门禁 (Task 4.1 & 4.2)", () => {
  describe("1. backfill-derived-metrics 参数安全防御", () => {
    it("遇到未知命令行参数时必须阻断并抛出异常", () => {
      expect(() => parseBackfillArgs(["--makret", "cn"])).toThrow(/未知命令行参数/);
      expect(() => parseBackfillArgs(["--random-flag"])).toThrow(/未知命令行参数/);
    });

    it("带 --execute 但未传 --batch-id 时必须阻断并触发安全红线", () => {
      expect(() => parseBackfillArgs(["--execute"])).toThrow(/写入安全红线触发.*必须强制指定 --batch-id/);
      expect(() => parseBackfillArgs(["--execute", "--batch-id", ""])).toThrow(/写入安全红线触发/);
    });

    it("批次号包含非法字符时必须阻断", () => {
      expect(() => parseBackfillArgs(["--execute", "--batch-id", "bf 2026/10"])).toThrow(/批次号格式不合法/);
      expect(() => parseBackfillArgs(["--execute", "--batch-id", "bf;drop-table"])).toThrow(/批次号格式不合法/);
    });

    it("正确解析 --phase 1,2 与 --market us 参数", () => {
      const args = parseBackfillArgs([
        "--phase",
        "1,2",
        "--market",
        "us",
        "--dry-run",
      ]);
      expect(args.phases).toEqual([1, 2]);
      expect(args.market).toBe("us");
      expect(args.execute).toBe(false);
      expect(args.isDryRun).toBe(true);

      const where = buildBackfillWhereClause(args);
      expect(where.type).toBe("company");
      expect(where.onboardPhase).toEqual({ in: [1, 2] });
      expect(where.market).toBe("us");
    });

    it("正确解析单标的 --ticker AAPL", () => {
      const args = parseBackfillArgs(["--ticker", "AAPL"]);
      expect(args.ticker).toBe("AAPL");
      expect(args.execute).toBe(false);

      const where = buildBackfillWhereClause(args);
      expect(where.type).toBe("company");
      expect(where.OR).toBeDefined();
    });

    it("非法 market 或非法 phase 参数时抛出友好错误", () => {
      expect(() => parseBackfillArgs(["--market", "uk"])).toThrow(/非法 market 参数/);
      expect(() => parseBackfillArgs(["--phase", "abc"])).toThrow(/非法 phase 参数/);
    });
  });

  describe("2. rollback-batch-financials 回滚工具与定界隔离", () => {
    it("构建的批次定界标签必须两端封闭，防前缀碰撞", () => {
      const tag1 = buildStrictBatchTag("bf-1");
      const tag10 = buildStrictBatchTag("bf-10");
      expect(tag1).toBe("|batch:bf-1|");
      expect(tag10).toBe("|batch:bf-10|");
      expect(tag10.includes(tag1)).toBe(false);
    });

    it("未提供 --batch-id 时回滚参数解析必须阻断", () => {
      expect(() => parseRollbackArgs([])).toThrow(/必须通过 --batch-id/);
      expect(() => parseRollbackArgs(["--execute"])).toThrow(/必须通过 --batch-id/);
    });

    it("Dry-Run 模式下只统计行数，绝不调用 deleteMany", async () => {
      const mockDb = {
        financial: {
          count: vi.fn().mockResolvedValue(42),
          findMany: vi.fn().mockResolvedValue([
            {
              id: "fin-1",
              entityId: "ent-1",
              lineItem: "GrossProfit",
              periodEnd: new Date("2024-12-31"),
              mappingRule: "derived:Revenue - CostOfRevenue|batch:bf-test-1|",
            },
          ]),
          deleteMany: vi.fn(),
        },
      };

      const result = await rollbackBatch(
        { batchId: "bf-test-1", execute: false },
        mockDb as unknown as Parameters<typeof rollbackBatch>[1],
      );

      expect(result.affectedCount).toBe(42);
      expect(result.deletedCount).toBe(0);
      expect(result.isDryRun).toBe(true);
      expect(mockDb.financial.count).toHaveBeenCalledWith({
        where: { mappingRule: { contains: "|batch:bf-test-1|" } },
      });
      expect(mockDb.financial.deleteMany).not.toHaveBeenCalled();
    });

    it("Execute 模式下精准删除指定批次的记录", async () => {
      const mockDb = {
        financial: {
          count: vi.fn().mockResolvedValue(100),
          findMany: vi.fn().mockResolvedValue([]),
          deleteMany: vi.fn().mockResolvedValue({ count: 100 }),
        },
      };

      const result = await rollbackBatch(
        { batchId: "bf-p1p2-us", execute: true },
        mockDb as unknown as Parameters<typeof rollbackBatch>[1],
      );

      expect(result.affectedCount).toBe(100);
      expect(result.deletedCount).toBe(100);
      expect(result.isDryRun).toBe(false);
      expect(mockDb.financial.deleteMany).toHaveBeenCalledWith({
        where: { mappingRule: { contains: "|batch:bf-p1p2-us|" } },
      });
    });
  });
});
