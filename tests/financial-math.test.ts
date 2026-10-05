import { describe, expect, it } from "vitest";
import {
  calculateFreeCashFlow,
  calculateReturnOnAverageBalance,
  detectSplitFactor,
  normalizeAnnualsStockSplits,
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
  });
});

