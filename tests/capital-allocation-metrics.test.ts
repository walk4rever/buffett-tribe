import { describe, expect, it } from "vitest";

import { computeCapitalAllocationStats } from "../src/lib/capital-allocation-metrics";
import { getCapitalAllocationShareSeries } from "../src/lib/share-count-utils";

describe("computeCapitalAllocationStats", () => {
  it("calculates FCF only for years with both OCF and CapEx", () => {
    const stats = computeCapitalAllocationStats([
      { year: 2024, operatingCashFlow: 200, capEx: null, repurchaseAmt: 20, dividendsPaid: null, shares: 95, roe: 15 },
      { year: 2023, operatingCashFlow: 100, capEx: -20, repurchaseAmt: 10, dividendsPaid: null, shares: 100, roe: 10 },
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
      { year: 2024, operatingCashFlow: 100, capEx: 20, repurchaseAmt: null, dividendsPaid: null, shares: 95, roe: 15 },
      { year: 2023, operatingCashFlow: 100, capEx: 20, repurchaseAmt: 10, dividendsPaid: null, shares: 100, roe: 10 },
    ]);

    expect(stats?.cumBuybacks).toBe(10);
    expect(stats?.buybackCoverage).toBe(1);
    expect(stats?.fcfAfterBuybacks).toBeNull();
    expect(stats?.buybackPct).toBeNull();
    expect(stats?.flowBuybackCoverage).toBe(1);
  });

  it("subtracts disclosed dividends and buybacks from FCF only with complete coverage", () => {
    const stats = computeCapitalAllocationStats([
      {
        year: 2024,
        operatingCashFlow: 100,
        capEx: 20,
        repurchaseAmt: 10,
        dividendsPaid: 15,
        shares: 95,
        roe: 15,
      },
      {
        year: 2023,
        operatingCashFlow: 100,
        capEx: 20,
        repurchaseAmt: 0,
        dividendsPaid: -5,
        shares: 100,
        roe: 10,
      },
    ]);

    expect(stats?.cumDividends).toBe(20);
    expect(stats?.dividendCoverage).toBe(2);
    expect(stats?.completeFlowDividends).toBe(20);
    expect(stats?.dividendPct).toBe(12.5);
    expect(stats?.fcfAfterDistributions).toBe(130);
  });

  it("keeps distributions unknown when dividend data is missing in a complete cash-flow year", () => {
    const stats = computeCapitalAllocationStats([
      {
        year: 2024,
        operatingCashFlow: 100,
        capEx: 20,
        repurchaseAmt: 10,
        dividendsPaid: null,
        shares: 95,
        roe: 15,
      },
      {
        year: 2023,
        operatingCashFlow: 100,
        capEx: 20,
        repurchaseAmt: 0,
        dividendsPaid: 10,
        shares: 100,
        roe: 10,
      },
    ]);

    expect(stats?.cumDividends).toBe(10);
    expect(stats?.dividendCoverage).toBe(1);
    expect(stats?.flowDividendCoverage).toBe(1);
    expect(stats?.completeFlowDividends).toBeNull();
    expect(stats?.fcfAfterDistributions).toBeNull();
  });

  it("treats an explicitly reported zero dividend as complete data", () => {
    const stats = computeCapitalAllocationStats([
      {
        year: 2024,
        operatingCashFlow: 100,
        capEx: 20,
        repurchaseAmt: 0,
        dividendsPaid: 0,
        shares: 95,
        roe: 15,
      },
      {
        year: 2023,
        operatingCashFlow: 100,
        capEx: 20,
        repurchaseAmt: 0,
        dividendsPaid: 0,
        shares: 100,
        roe: 10,
      },
    ]);

    expect(stats?.cumDividends).toBe(0);
    expect(stats?.dividendCoverage).toBe(2);
    expect(stats?.fcfAfterDistributions).toBe(160);
  });

  it("reports no cumulative flow totals when no year has complete OCF and CapEx", () => {
    const stats = computeCapitalAllocationStats([
      { year: 2024, operatingCashFlow: 100, capEx: null, repurchaseAmt: 0, dividendsPaid: 0, shares: 95, roe: 15 },
      { year: 2023, operatingCashFlow: null, capEx: 20, repurchaseAmt: 0, dividendsPaid: 0, shares: 100, roe: 10 },
    ]);

    expect(stats?.cumOcf).toBeNull();
    expect(stats?.cumCapEx).toBeNull();
    expect(stats?.cumFcf).toBeNull();
    expect(stats?.flowBuybackCoverage).toBe(0);
  });

  it("preserves a negative FCF remainder when buybacks exceed FCF", () => {
    const stats = computeCapitalAllocationStats([
      { year: 2024, operatingCashFlow: 100, capEx: 80, repurchaseAmt: 50, dividendsPaid: null, shares: 95, roe: 15 },
      { year: 2023, operatingCashFlow: 100, capEx: 80, repurchaseAmt: 50, dividendsPaid: null, shares: 100, roe: 10 },
    ]);

    expect(stats?.cumFcf).toBe(40);
    expect(stats?.fcfAfterBuybacks).toBe(-60);
  });

  it("preserves a negative remainder when dividends and buybacks exceed FCF", () => {
    const stats = computeCapitalAllocationStats([
      { year: 2024, operatingCashFlow: 100, capEx: 80, repurchaseAmt: 30, dividendsPaid: 20, shares: 95, roe: 15 },
      { year: 2023, operatingCashFlow: 100, capEx: 80, repurchaseAmt: 30, dividendsPaid: 20, shares: 100, roe: 10 },
    ]);

    expect(stats?.fcfAfterDistributions).toBe(-60);
  });

  it("does not produce OCF allocation percentages when cumulative OCF is non-positive", () => {
    const stats = computeCapitalAllocationStats([
      { year: 2024, operatingCashFlow: -100, capEx: 20, repurchaseAmt: 0, dividendsPaid: null, shares: 95, roe: -5 },
      { year: 2023, operatingCashFlow: -50, capEx: 10, repurchaseAmt: 0, dividendsPaid: null, shares: 100, roe: 0 },
    ]);

    expect(stats?.cumOcf).toBe(-150);
    expect(stats?.capexPct).toBeNull();
    expect(stats?.fcfPct).toBeNull();
  });

  it("excludes incomplete fiscal years that lack operating financials so completed years are not displaced", () => {
    const stats = computeCapitalAllocationStats([
      { year: 2021, operatingCashFlow: 100, capEx: 20, repurchaseAmt: 0, dividendsPaid: 10, shares: 100, roe: 20 },
      { year: 2022, operatingCashFlow: 120, capEx: 25, repurchaseAmt: 0, dividendsPaid: 15, shares: 100, roe: 22 },
      { year: 2023, operatingCashFlow: 140, capEx: 30, repurchaseAmt: 0, dividendsPaid: 20, shares: 100, roe: 24 },
      { year: 2024, operatingCashFlow: 160, capEx: 35, repurchaseAmt: 0, dividendsPaid: 25, shares: 100, roe: 25 },
      { year: 2025, operatingCashFlow: 180, capEx: 40, repurchaseAmt: 10, dividendsPaid: 30, shares: 98, roe: 26 },
      // Incomplete/in-progress year with only a buyback event but no annual financials yet
      { year: 2026, operatingCashFlow: null, capEx: null, repurchaseAmt: 5, dividendsPaid: null, shares: null, roe: null },
    ]);

    expect(stats?.periodCount).toBe(5);
    expect(stats?.earliestYear).toBe(2021);
    expect(stats?.latestYear).toBe(2025);
    expect(stats?.annuals.map((a) => a.year)).toEqual([2021, 2022, 2023, 2024, 2025]);
  });

  it("includes derived shares and excludes weighted-average shares", () => {
    const stats = computeCapitalAllocationStats([
      {
        year: 2024,
        operatingCashFlow: 100,
        capEx: 20,
        repurchaseAmt: 0,
        dividendsPaid: 0,
        shares: 90,
        sharesSource: "derived",
        roe: 15,
      },
      {
        year: 2023,
        operatingCashFlow: 100,
        capEx: 20,
        repurchaseAmt: 0,
        dividendsPaid: 0,
        shares: 110,
        sharesSource: "weighted_average",
        roe: 10,
      },
    ]);

    expect(
      getCapitalAllocationShareSeries(stats!.annuals).map((point) => point.shares),
    ).toEqual([null, 90]);
    expect(stats?.sharesStart).toBeNull();
    expect(stats?.sharesEnd).toBeNull();
    expect(stats?.shareDeltaPct).toBeNull();
  });

  it("calculates capital allocation share change from derived annual shares", () => {
    const stats = computeCapitalAllocationStats([
      {
        year: 2024,
        operatingCashFlow: 100,
        capEx: 20,
        repurchaseAmt: 0,
        dividendsPaid: 0,
        shares: 90,
        sharesSource: "derived",
        roe: 15,
      },
      {
        year: 2023,
        operatingCashFlow: 100,
        capEx: 20,
        repurchaseAmt: 0,
        dividendsPaid: 0,
        shares: 100,
        sharesSource: "derived",
        roe: 10,
      },
    ]);

    expect(stats?.sharesStart).toBe(100);
    expect(stats?.sharesEnd).toBe(90);
    expect(stats?.shareDeltaPct).toBe(-10);
  });
});
