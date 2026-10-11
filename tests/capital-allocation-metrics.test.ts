import { describe, expect, it } from "vitest";

import { computeCapitalAllocationStats } from "../src/lib/capital-allocation-metrics";

describe("computeCapitalAllocationStats", () => {
  it("calculates FCF only for years with both OCF and CapEx", () => {
    const stats = computeCapitalAllocationStats([
      { year: 2024, operatingCashFlow: 200, capEx: null, repurchaseAmt: 20, shares: 95, roe: 15 },
      { year: 2023, operatingCashFlow: 100, capEx: -20, repurchaseAmt: 10, shares: 100, roe: 10 },
    ]);

    expect(stats).not.toBeNull();
    expect(stats?.flowCoverage).toBe(1);
    expect(stats?.cumOcf).toBe(100);
    expect(stats?.cumCapEx).toBe(20);
    expect(stats?.cumFcf).toBe(80);
    expect(stats?.fcfAfterBuybacks).toBe(70);
  });

  it("does not label partial buyback data as a complete FCF allocation", () => {
    const stats = computeCapitalAllocationStats([
      { year: 2024, operatingCashFlow: 100, capEx: 20, repurchaseAmt: null, shares: 95, roe: 15 },
      { year: 2023, operatingCashFlow: 100, capEx: 20, repurchaseAmt: 10, shares: 100, roe: 10 },
    ]);

    expect(stats?.cumBuybacks).toBe(10);
    expect(stats?.buybackCoverage).toBe(1);
    expect(stats?.fcfAfterBuybacks).toBeNull();
    expect(stats?.buybackPct).toBeNull();
    expect(stats?.flowBuybackCoverage).toBe(1);
  });

  it("reports no cumulative flow totals when no year has complete OCF and CapEx", () => {
    const stats = computeCapitalAllocationStats([
      { year: 2024, operatingCashFlow: 100, capEx: null, repurchaseAmt: 0, shares: 95, roe: 15 },
      { year: 2023, operatingCashFlow: null, capEx: 20, repurchaseAmt: 0, shares: 100, roe: 10 },
    ]);

    expect(stats?.cumOcf).toBeNull();
    expect(stats?.cumCapEx).toBeNull();
    expect(stats?.cumFcf).toBeNull();
    expect(stats?.flowBuybackCoverage).toBe(0);
  });

  it("preserves a negative FCF remainder when buybacks exceed FCF", () => {
    const stats = computeCapitalAllocationStats([
      { year: 2024, operatingCashFlow: 100, capEx: 80, repurchaseAmt: 50, shares: 95, roe: 15 },
      { year: 2023, operatingCashFlow: 100, capEx: 80, repurchaseAmt: 50, shares: 100, roe: 10 },
    ]);

    expect(stats?.cumFcf).toBe(40);
    expect(stats?.fcfAfterBuybacks).toBe(-60);
  });

  it("does not produce OCF allocation percentages when cumulative OCF is non-positive", () => {
    const stats = computeCapitalAllocationStats([
      { year: 2024, operatingCashFlow: -100, capEx: 20, repurchaseAmt: 0, shares: 95, roe: -5 },
      { year: 2023, operatingCashFlow: -50, capEx: 10, repurchaseAmt: 0, shares: 100, roe: 0 },
    ]);

    expect(stats?.cumOcf).toBe(-150);
    expect(stats?.capexPct).toBeNull();
    expect(stats?.fcfPct).toBeNull();
  });
});
