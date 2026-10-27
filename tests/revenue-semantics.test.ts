import { describe, expect, it } from "vitest";
import {
  resolveInvestmentGains,
  resolveOperatingRevenue,
} from "@/lib/revenue-semantics";

describe("revenue semantics", () => {
  it("prefers net investment income", () => {
    expect(
      resolveInvestmentGains({
        NetInvestmentIncome: 40,
        InvestmentIncome: 35,
        FairValueChangeIncome: 5,
      }),
    ).toBe(40);
  });

  it("adds explicit investment and fair-value components", () => {
    expect(
      resolveInvestmentGains({
        InvestmentIncome: 35,
        FairValueChangeIncome: -5,
      }),
    ).toBe(30);
  });

  it("derives operating revenue by removing explicit investment gains", () => {
    expect(
      resolveOperatingRevenue({
        Revenue: 150,
        InvestmentIncome: 30,
        FairValueChangeIncome: 20,
      }),
    ).toBe(100);
  });
});
