import { describe, expect, it } from "vitest";
import {
  inspectShareRow,
  processShareBatches,
  type RawShareRow,
} from "../scripts/audit-polluted-financials";

describe("audit-polluted-financials", () => {
  it("detects polluted share rows with currency units, excessive magnitude, or negative values", () => {
    const normalRow: RawShareRow = {
      id: "row-1",
      entityId: "ent-1",
      periodEnd: new Date("2024-12-31"),
      periodType: "FY",
      value: 10_000_000,
      unit: "shares",
      rawXbrlTag: "CommonStockSharesOutstanding",
      mappingRule: "standard",
      entity: { ticker: "NORM", canonicalName: "Normal Corp", market: "US" },
    };
    expect(inspectShareRow(normalRow)).toBeNull();

    // Anomaly 1: Unit marked as currency
    const currencyUnitRow: RawShareRow = {
      ...normalRow,
      id: "row-2",
      unit: "CNY",
    };
    const cnyAnomaly = inspectShareRow(currencyUnitRow);
    expect(cnyAnomaly).not.toBeNull();
    expect(cnyAnomaly?.reason).toContain("单位错误标为货币: CNY");

    // Anomaly 2: Excessive magnitude (> 500B shares)
    const giantRow: RawShareRow = {
      ...normalRow,
      id: "row-3",
      value: 600_000_000_000,
    };
    const giantAnomaly = inspectShareRow(giantRow);
    expect(giantAnomaly).not.toBeNull();
    expect(giantAnomaly?.reason).toContain("股数数量级异常");

    // Anomaly 3: Negative shares
    const negativeRow: RawShareRow = {
      ...normalRow,
      id: "row-4",
      value: -500,
    };
    const negAnomaly = inspectShareRow(negativeRow);
    expect(negAnomaly).not.toBeNull();
    expect(negAnomaly?.reason).toContain("股数为负数");
  });

  it("accumulates totalScanned across multiple batches and builds a consistent report", async () => {
    // Generate 3 batches of 10 items each = 30 items total
    const allRows: RawShareRow[] = Array.from({ length: 30 }, (_, i) => ({
      id: `row-${i}`,
      entityId: `ent-${i % 5}`,
      periodEnd: new Date("2024-12-31"),
      periodType: "FY",
      value: i === 7 || i === 18 ? 800_000_000_000 : 100_000,
      unit: i === 25 ? "USD" : "shares",
      rawXbrlTag: "CommonStockSharesOutstanding",
      mappingRule: "rule",
      entity: { ticker: `T${i}`, canonicalName: `Name ${i}`, market: "US" },
    }));

    const batchSize = 10;
    const fetchBatch = async (skip: number, take: number) => {
      return allRows.slice(skip, skip + take);
    };

    const result = await processShareBatches(fetchBatch, allRows.length, batchSize);

    // Assert totalScanned equals the actual number of scanned rows across all batches
    expect(result.totalScanned).toBe(30);
    expect(result.report.totalScanned).toBe(30);

    // 3 anomalies: index 7 (giant), index 18 (giant), index 25 (USD unit)
    expect(result.polluted).toHaveLength(3);
    expect(result.report.pollutedCount).toBe(3);
    expect(result.report.records).toHaveLength(3);

    // Check entity counting
    expect(result.report.pollutedEntityCount).toBe(result.entityIds.size);
  });
});
