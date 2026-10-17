import { describe, expect, it } from "vitest";
import {
  calculateFreeCashFlow,
  calculateInvestedCapital,
  calculateReturnOnAverageBalance,
  calculateROIC,
  detectSplitFactor,
  normalizeAnnualsStockSplits,
  normalizeFinancialYearsStockSplits,
} from "@/lib/financial-math";

describe("financial calculations", () => {
  it("subtracts CapEx regardless of its reported sign", () => {
    expect(calculateFreeCashFlow(210, 20)).toBe(190);
    expect(calculateFreeCashFlow(210, -20)).toBe(190);
  });

  it("does not infer free cash flow when either source item is missing", () => {
    expect(calculateFreeCashFlow(210, null)).toBeNull();
    expect(calculateFreeCashFlow(null, 20)).toBeNull();
  });

  it("calculates return using the average opening and closing balance", () => {
    expect(calculateReturnOnAverageBalance(180, 780, 900)).toBeCloseTo(180 / 840);
  });

  it("requires both balances and a positive average denominator", () => {
    expect(calculateReturnOnAverageBalance(180, null, 900)).toBeNull();
    expect(calculateReturnOnAverageBalance(180, -900, -700)).toBeNull();
  });

  describe("stock split detection and normalization", () => {
    it("detects a 10-for-1 forward split (like NVDA 2024 split)", () => {
      const factor = detectSplitFactor(
        2532987013,
        25694117647,
        3.85,
        0.17,
        9752000000,
        4368000000,
      );
      expect(factor).toBe(10);
    });

    it("detects a 2-for-1 forward split (like NVO 2023 split)", () => {
      const factor = detectSplitFactor(
        2339700167,
        4605303761,
        18.01,
        10.37,
        42144000000,
        47757000000,
      );
      expect(factor).toBe(2);
    });

    it("ignores normal share count changes under 28%", () => {
      // Natural buybacks
      expect(detectSplitFactor(100000000, 95000000)).toBeNull();
      // Natural modest share issuance
      expect(detectSplitFactor(100000000, 105000000)).toBeNull();
    });

    it("normalizes historical annuals for NVDA to eliminate false +867% dilution", () => {
      const unadjustedAnnuals = [
        { year: 2020, eps: 1.13, shares: 2474336283, netIncome: 2796000000 },
        { year: 2021, eps: 1.73, shares: 2504046243, netIncome: 4332000000 },
        { year: 2022, eps: 3.85, shares: 2532987013, netIncome: 9752000000 },
        { year: 2023, eps: 0.17, shares: 25694117647, netIncome: 4368000000 },
        { year: 2024, eps: 1.19, shares: 25008403361, netIncome: 29760000000 },
        { year: 2025, eps: 2.94, shares: 24789115646, netIncome: 72880000000 },
        { year: 2026, eps: 4.90, shares: 24503469388, netIncome: 120067000000 },
      ];

      const normalized = normalizeAnnualsStockSplits(unadjustedAnnuals);

      // 2022 and earlier should be multiplied by 10
      expect(normalized.find((a) => a.year === 2022)?.shares).toBe(25329870130);
      expect(normalized.find((a) => a.year === 2022)?.eps).toBe(0.385);

      // 2026 should remain untouched
      expect(normalized.find((a) => a.year === 2026)?.shares).toBe(24503469388);
      expect(normalized.find((a) => a.year === 2026)?.eps).toBe(4.90);

      // 5-year change from 2022 to 2026 should show net buyback reduction (~ -3.3%), NOT +867%
      const recent = normalized.slice(-5);
      const oldest = recent[0].shares!;
      const newest = recent[recent.length - 1].shares!;
      const changePct = Number((((newest - oldest) / oldest) * 100).toFixed(1));
      expect(changePct).toBe(-3.3);
    });

    it("normalizes AVGO two-stage split correctly where periodEnd was pre-split at T-2", () => {
      // AVGO real data: 1:10 split in 2024.
      // FY22 had WeightedAverageSharesDiluted post-split (4.232B) but CommonStockSharesOutstanding pre-split (418M)
      const avgoYears = [
        {
          year: 2020,
          items: {
            CommonStockSharesOutstanding: "407000000",
            WeightedAverageSharesDiluted: "421000000",
            EPSDiluted: "6.33",
            NetIncome: "2960000000",
          },
        },
        {
          year: 2021,
          items: {
            CommonStockSharesOutstanding: "413000000",
            WeightedAverageSharesDiluted: "429000000",
            EPSDiluted: "15.00",
            NetIncome: "4365000000",
          },
        },
        {
          year: 2022,
          items: {
            CommonStockSharesOutstanding: "418000000", // pre-split in EDGAR
            WeightedAverageSharesDiluted: "4232000000", // post-split in EDGAR
            EPSDiluted: "2.65", // post-split in EDGAR
            NetIncome: "11495000000",
          },
        },
        {
          year: 2023,
          items: {
            CommonStockSharesOutstanding: "4139000000",
            WeightedAverageSharesDiluted: "4272000000",
            EPSDiluted: "3.30",
            NetIncome: "14082000000",
          },
        },
        {
          year: 2024,
          items: {
            CommonStockSharesOutstanding: "4686000000", // VMware acquisition ~5.5亿股增发
            WeightedAverageSharesDiluted: "4778000000",
            EPSDiluted: "1.23",
            NetIncome: "5878000000",
          },
        },
        {
          year: 2025,
          items: {
            CommonStockSharesOutstanding: "4741000000",
            WeightedAverageSharesDiluted: "4853000000",
            EPSDiluted: "4.77",
            NetIncome: "23136000000",
          },
        },
      ];

      const res = normalizeFinancialYearsStockSplits(avgoYears);

      // FY22 CommonStockSharesOutstanding should be scaled by 10 to ~4.18B, NOT staying at 418M!
      expect(Number(res.find((y) => y.year === 2022)?.items.CommonStockSharesOutstanding)).toBe(4180000000);
      expect(Number(res.find((y) => y.year === 2022)?.items.EPSDiluted)).toBe(2.65);

      // FY21 should be scaled by 10
      expect(Number(res.find((y) => y.year === 2021)?.items.CommonStockSharesOutstanding)).toBe(4130000000);
      expect(Number(res.find((y) => y.year === 2021)?.items.WeightedAverageSharesDiluted)).toBe(4290000000);
      expect(Number(res.find((y) => y.year === 2021)?.items.EPSDiluted)).toBe(1.50);

      // FY24 VMware acquisition share increase (~4.686B) should be preserved
      expect(Number(res.find((y) => y.year === 2024)?.items.CommonStockSharesOutstanding)).toBe(4686000000);
    });

    it("does NOT falsely flag genuine 30% share issuance/M&A as a 1.5x split", () => {
      const dilutionYears = [
        {
          year: 2023,
          items: {
            CommonStockSharesOutstanding: "100000000",
            WeightedAverageSharesDiluted: "100000000",
            EPSDiluted: "2.00",
            NetIncome: "200000000",
          },
        },
        {
          year: 2024,
          items: {
            CommonStockSharesOutstanding: "130000000", // +30% genuine issuance
            WeightedAverageSharesDiluted: "115000000", // weighted average during the year
            EPSDiluted: "2.20", // earnings also grew, EPS didn't drop by 33%
            NetIncome: "253000000",
          },
        },
      ];

      const res = normalizeFinancialYearsStockSplits(dilutionYears);

      // Should remain 100M and 130M, NOT multiplied by 1.5
      expect(Number(res.find((y) => y.year === 2023)?.items.CommonStockSharesOutstanding)).toBe(100000000);
      expect(Number(res.find((y) => y.year === 2024)?.items.CommonStockSharesOutstanding)).toBe(130000000);
    });

    it("correctly handles reverse stock split (e.g. 1-for-8 like GE 2021)", () => {
      const reverseSplitYears = [
        {
          year: 2020,
          items: {
            CommonStockSharesOutstanding: "8800000000",
            WeightedAverageSharesDiluted: "8780000000",
            EPSDiluted: "0.50",
            NetIncome: "4390000000",
          },
        },
        {
          year: 2021,
          items: {
            CommonStockSharesOutstanding: "1100000000",
            WeightedAverageSharesDiluted: "1098000000",
            EPSDiluted: "4.00",
            NetIncome: "4392000000",
          },
        },
      ];

      const res = normalizeFinancialYearsStockSplits(reverseSplitYears);

      // 2020 shares should be divided by 8 (multiplied by 0.125) to ~1.1B
      expect(Number(res.find((y) => y.year === 2020)?.items.CommonStockSharesOutstanding)).toBe(1100000000);
      // 2020 EPS should be multiplied by 8 (divided by 0.125) to 4.00
      expect(Number(res.find((y) => y.year === 2020)?.items.EPSDiluted)).toBe(4.00);
    });
  });

  describe("invested capital and ROIC calculations", () => {
    it("calculates invested capital as equity + debt - cash", () => {
      expect(
        calculateInvestedCapital({
          totalEquity: 500,
          totalDebt: 300,
          cashAndEquivalents: 100,
        }),
      ).toBe(700);

      // Using shortTermDebt + longTermDebt when totalDebt is not reported
      expect(
        calculateInvestedCapital({
          totalEquity: 500,
          shortTermDebt: 100,
          longTermDebt: 200,
          cashAndEquivalents: 100,
        }),
      ).toBe(700);
    });

    it("returns null when equity, cash, or debt information is missing rather than manufacturing zero", () => {
      // Missing equity
      expect(
        calculateInvestedCapital({
          totalEquity: null,
          totalDebt: 300,
          cashAndEquivalents: 100,
        }),
      ).toBeNull();

      // Missing cash
      expect(
        calculateInvestedCapital({
          totalEquity: 500,
          totalDebt: 300,
          cashAndEquivalents: null,
        }),
      ).toBeNull();

      // No debt info at all
      expect(
        calculateInvestedCapital({
          totalEquity: 500,
          cashAndEquivalents: 100,
        }),
      ).toBeNull();

      // Incomplete debt info (only short-term debt, long-term debt missing without totalDebt)
      expect(
        calculateInvestedCapital({
          totalEquity: 500,
          shortTermDebt: 100,
          cashAndEquivalents: 100,
        }),
      ).toBeNull();

      // Incomplete debt info (only long-term debt, short-term debt missing without totalDebt)
      expect(
        calculateInvestedCapital({
          totalEquity: 500,
          longTermDebt: 200,
          cashAndEquivalents: 100,
        }),
      ).toBeNull();
    });

    it("calculates ROIC with standard tax rate and positive invested capital", () => {
      const roic = calculateROIC({
        operatingIncome: 100,
        effectiveTaxRate: 0.20,
        currentInvestedCapital: 500,
        previousInvestedCapital: 500,
      });
      // NOPAT = 100 * (1 - 0.20) = 80; averageIC = 500; 80 / 500 = 0.16
      expect(roic).toBeCloseTo(0.16);
    });

    it("protects against negative or zero invested capital by returning null", () => {
      // e.g. Extreme buyback company with negative equity / negative IC
      expect(
        calculateROIC({
          operatingIncome: 100,
          effectiveTaxRate: 0.21,
          currentInvestedCapital: -50,
          previousInvestedCapital: 100,
        }),
      ).toBeNull();

      expect(
        calculateROIC({
          operatingIncome: 100,
          currentInvestedCapital: 0,
        }),
      ).toBeNull();
    });

    it("normalizes anomalous effective tax rates outside [0, 0.50] to 21%", () => {
      // Negative tax rate (e.g. tax benefit)
      const roicNegativeTax = calculateROIC({
        operatingIncome: 100,
        effectiveTaxRate: -0.15,
        currentInvestedCapital: 500,
      });
      expect(roicNegativeTax).toBeCloseTo((100 * (1 - 0.21)) / 500);

      // Unusually high tax rate (>50%)
      const roicHighTax = calculateROIC({
        operatingIncome: 100,
        effectiveTaxRate: 0.85,
        currentInvestedCapital: 500,
      });
      expect(roicHighTax).toBeCloseTo((100 * (1 - 0.21)) / 500);
    });
  });
});

