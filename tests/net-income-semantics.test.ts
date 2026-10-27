import { describe, expect, it } from "vitest";
import {
  resolveNetIncomeCommon,
  resolveNetIncomeTotal,
} from "@/lib/net-income-semantics";

describe("net income semantics", () => {
  it("prefers directly reported semantic values", () => {
    expect(
      resolveNetIncomeTotal({
        NetIncomeTotal: 120,
        NetIncome: 100,
        MinorityInterestIncome: 20,
      }),
    ).toBe(120);
    expect(
      resolveNetIncomeCommon({
        NetIncomeCommon: 90,
        NetIncome: 100,
        PreferredDividends: 10,
      }),
    ).toBe(90);
  });

  it("derives only from explicitly reviewed inputs", () => {
    expect(
      resolveNetIncomeTotal({
        NetIncome: 100,
        MinorityInterestIncome: 20,
      }),
    ).toBe(120);
    expect(
      resolveNetIncomeCommon({
        NetIncome: 100,
        PreferredDividends: -10,
      }),
    ).toBe(90);
  });

  it("does not silently treat parent net income as common net income", () => {
    expect(resolveNetIncomeCommon({ NetIncome: 100 })).toBeNull();
  });

  it("rejects direct common net income above parent net income in the same currency", () => {
    expect(
      resolveNetIncomeCommon(
        {
          NetIncome: 100,
          NetIncomeCommon: 120,
        },
        {
          NetIncome: "HKD",
          NetIncomeCommon: "HKD",
        },
      ),
    ).toBeNull();
  });

  it("rejects derivation across different currencies", () => {
    expect(
      resolveNetIncomeCommon(
        {
          NetIncome: 100,
          PreferredDividends: 10,
        },
        {
          NetIncome: "USD",
          PreferredDividends: "EUR",
        },
      ),
    ).toBeNull();
  });
});
