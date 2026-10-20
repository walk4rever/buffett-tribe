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
        acquisitionsAmt: 0,
        repurchaseAmt: 10,
        dividendsPaid: 15,
        shares: 95,
        roe: 15,
      },
      {
        year: 2023,
        operatingCashFlow: 100,
        capEx: 20,
        acquisitionsAmt: 0,
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
        acquisitionsAmt: 0,
        repurchaseAmt: 0,
        dividendsPaid: 0,
        shares: 95,
        roe: 15,
      },
      {
        year: 2023,
        operatingCashFlow: 100,
        capEx: 20,
        acquisitionsAmt: 0,
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
      { year: 2024, operatingCashFlow: 100, capEx: 80, acquisitionsAmt: 0, repurchaseAmt: 30, dividendsPaid: 20, shares: 95, roe: 15 },
      { year: 2023, operatingCashFlow: 100, capEx: 80, acquisitionsAmt: 0, repurchaseAmt: 30, dividendsPaid: 20, shares: 100, roe: 10 },
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

  it("excludes derived and weighted-average shares from the period-end series", () => {
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
    ).toEqual([null, null]);
    expect(stats?.sharesStart).toBeNull();
    expect(stats?.sharesEnd).toBeNull();
    expect(stats?.shareDeltaPct).toBeNull();
  });

  it("does not calculate capital allocation share change from derived annual shares", () => {
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

    expect(stats?.sharesStart).toBeNull();
    expect(stats?.sharesEnd).toBeNull();
    expect(stats?.shareDeltaPct).toBeNull();
  });

  it("calculates financial capital allocation metrics from net income, dividends, and buybacks", () => {
    const stats = computeCapitalAllocationStats([
      {
        year: 2024,
        netIncome: 1000,
        operatingCashFlow: null,
        capEx: null,
        repurchaseAmt: 200,
        dividendsPaid: 300,
        shares: 100,
        roe: 15,
      },
      {
        year: 2023,
        netIncome: 1000,
        operatingCashFlow: null,
        capEx: null,
        repurchaseAmt: 100,
        dividendsPaid: 300,
        shares: 100,
        roe: 14,
      },
    ]);

    expect(stats?.cumNetIncome).toBe(2000);
    expect(stats?.cumDividends).toBe(600);
    expect(stats?.cumBuybacks).toBe(300);
    expect(stats?.shareholderReturnAmt).toBe(900);
    expect(stats?.shareholderReturnPct).toBe(45);
    expect(stats?.retainedEarnings).toBe(1100);
    expect(stats?.retainedEarningsPct).toBe(55);
    expect(stats?.netIncomeDividendPayoutPct).toBe(30);
    expect(stats?.netIncomeBuybackPayoutPct).toBe(15);
  });

  it("calculates M&A acquisitions metrics and deducts from FCF residual", () => {
    // Like Broadcom AVGO FY24 acquiring VMware
    const stats = computeCapitalAllocationStats([
      {
        year: 2024,
        operatingCashFlow: 200,
        capEx: 10,
        acquisitionsAmt: 80, // M&A net cash outflow
        repurchaseAmt: 30,
        dividendsPaid: 40,
        shares: 468,
        roe: 13,
      },
      {
        year: 2023,
        operatingCashFlow: 180,
        capEx: 10,
        acquisitionsAmt: 0,
        repurchaseAmt: 20,
        dividendsPaid: 30,
        shares: 414,
        roe: 60,
      },
    ]);

    expect(stats?.cumOcf).toBe(380);
    expect(stats?.cumCapEx).toBe(20);
    expect(stats?.cumFcf).toBe(360);
    expect(stats?.cumAcquisitions).toBe(80);
    expect(stats?.acquisitionsCoverage).toBe(2);
    expect(stats?.acquisitionsPct).toBe(Number(((80 / 360) * 100).toFixed(1)));
    expect(stats?.completeFlowBuybacks).toBe(50);
    expect(stats?.completeFlowDividends).toBe(70);
    // Residual = FCF (360) - M&A (80) - Buybacks (50) - Dividends (70) = 160
    expect(stats?.fcfAfterDistributions).toBe(160);
  });

  it("does not mix acquisitions from a year outside the OCF/CapEx cohort", () => {
    const stats = computeCapitalAllocationStats([
      {
        year: 2023,
        netIncome: 100,
        operatingCashFlow: 100,
        capEx: 20,
        acquisitionsAmt: 0,
        repurchaseAmt: 0,
        dividendsPaid: 0,
        shares: 100,
        roe: 10,
      },
      {
        year: 2024,
        netIncome: 100,
        operatingCashFlow: null,
        capEx: null,
        acquisitionsAmt: 200,
        repurchaseAmt: null,
        dividendsPaid: null,
        shares: 100,
        roe: 10,
      },
    ]);

    expect(stats?.cumFcf).toBe(80);
    expect(stats?.cumAcquisitions).toBe(0);
    expect(stats?.flowAcquisitionsCoverage).toBe(1);
    expect(stats?.flowAcquisitionsComplete).toBe(true);
    expect(stats?.fcfAfterDistributions).toBe(80);
    expect(stats?.fcfAfterDistributions).not.toBe(-120);
  });

  it("does not publish a final FCF balance when a flow year lacks acquisition disclosure", () => {
    const stats = computeCapitalAllocationStats([
      {
        year: 2024,
        operatingCashFlow: 100,
        capEx: 20,
        acquisitionsAmt: 10,
        repurchaseAmt: 0,
        dividendsPaid: 0,
        shares: 100,
        roe: 10,
      },
      {
        year: 2023,
        operatingCashFlow: 100,
        capEx: 20,
        acquisitionsAmt: null,
        repurchaseAmt: 0,
        dividendsPaid: 0,
        shares: 100,
        roe: 10,
      },
    ]);

    expect(stats?.flowAcquisitionsCoverage).toBe(1);
    expect(stats?.flowAcquisitionsComplete).toBe(false);
    expect(stats?.cumAcquisitions).toBe(10);
    expect(stats?.fcfAfterDistributions).toBeNull();
  });

  it("does not infer zero buybacks from a missing buyback record", () => {
    const stats = computeCapitalAllocationStats([
      {
        year: 2024,
        netIncome: 1000,
        operatingCashFlow: null,
        capEx: null,
        repurchaseAmt: null,
        dividendsPaid: 300,
        shares: 100,
        roe: 15,
      },
      {
        year: 2023,
        netIncome: 1000,
        operatingCashFlow: null,
        capEx: null,
        repurchaseAmt: 100,
        dividendsPaid: 300,
        shares: 100,
        roe: 14,
      },
    ]);

    expect(stats?.netIncomeBuybackCoverage).toBe(1);
    expect(stats?.netIncomeDistributionComplete).toBe(false);
    expect(stats?.shareholderReturnAmt).toBeNull();
    expect(stats?.retainedEarnings).toBeNull();
    expect(stats?.netIncomeDividendPayoutPct).toBe(30);
    expect(stats?.netIncomeBuybackPayoutPct).toBeNull();
  });
});
