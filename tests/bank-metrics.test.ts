import { describe, expect, it } from "vitest";
import {
  calculateNim,
  calculateNplRatio,
  calculateProvisionCoverage,
} from "@/lib/bank-metrics";

describe("bank metric formulas", () => {
  it("calculates NIM from net interest income and average earning assets", () => {
    expect(calculateNim(25, 1_000)).toBeCloseTo(0.025);
    expect(calculateNim(null, 1_000)).toBeNull();
    expect(calculateNim(25, 0)).toBeNull();
  });

  it("calculates NPL ratio from non-performing and gross loans", () => {
    expect(calculateNplRatio(20, 2_000)).toBeCloseTo(0.01);
    expect(calculateNplRatio(20, 0)).toBeNull();
  });

  it("calculates provision coverage from allowance and NPL", () => {
    expect(calculateProvisionCoverage(320, 100)).toBeCloseTo(3.2);
    expect(calculateProvisionCoverage(0, 0)).toBeNull();
  });
});
