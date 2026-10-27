import { describe, expect, it } from "vitest";
import {
  calculateClaimsRatio,
  calculateCombinedRatio,
  calculateNewBusinessValueMargin,
  calculateSolvencyRatio,
} from "@/lib/insurance-metrics";

describe("insurance metric formulas", () => {
  it("calculates claims ratio from claims and earned premiums", () => {
    expect(calculateClaimsRatio(70, 100)).toBeCloseTo(0.7);
    expect(calculateClaimsRatio(-70, 100)).toBeCloseTo(0.7);
    expect(calculateClaimsRatio(70, 0)).toBeNull();
  });

  it("calculates combined ratio from claims and underwriting costs", () => {
    expect(calculateCombinedRatio(70, 25, 100)).toBeCloseTo(0.95);
    expect(calculateCombinedRatio(70, null, 100)).toBeNull();
  });

  it("calculates new business value margin and solvency ratio", () => {
    expect(calculateNewBusinessValueMargin(25, 100)).toBeCloseTo(0.25);
    expect(calculateNewBusinessValueMargin(25, 0)).toBeNull();
    expect(calculateSolvencyRatio(250, 100)).toBeCloseTo(2.5);
    expect(calculateSolvencyRatio(250, 0)).toBeNull();
  });
});
