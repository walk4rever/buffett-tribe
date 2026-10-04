import { describe, expect, it } from "vitest";
import {
  calculateFreeCashFlow,
  calculateReturnOnAverageBalance,
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
});
