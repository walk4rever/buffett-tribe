import { describe, expect, it } from "vitest";

import { calculateFreeCashFlow } from "../src/lib/financial-math";
import {
  deriveSharesFromFinancials,
  normalizeFinancialItems,
} from "../src/lib/financial-normalization";

describe("cash-flow normalization", () => {
  it("does not make a unitless page-side zero disappear during currency normalization", () => {
    const normalized = normalizeFinancialItems(
      { DividendsPaid: 0 },
      {},
      {
        reportingCurrency: "CNY",
        tradingCurrency: "HKD",
        knownItemCurrencies: new Set(["CNY", "TWD"]),
        fxRates: new Map(),
      },
    );

    expect(normalized.DividendsPaid).toBe(0);
  });
});

describe("normalizeFinancialItems", () => {
  const fxRates = new Map([
    ["CNY", 0.14],
    ["TWD", 0.032],
    ["HKD", 0.128],
  ]);

  it("converts each line item from its own currency before derived calculations", () => {
    const normalized = normalizeFinancialItems(
      {
        OperatingCashFlow: 140,
        CapEx: 32,
      },
      {
        OperatingCashFlow: "CNY",
        CapEx: "TWD",
      },
      {
        reportingCurrency: "CNY",
        tradingCurrency: "HKD",
        knownItemCurrencies: new Set(["CNY", "TWD"]),
        fxRates,
      },
    );

    expect(normalized.OperatingCashFlow).toBeCloseTo(153.125);
    expect(normalized.CapEx).toBeCloseTo(8);
    expect(calculateFreeCashFlow(
      normalized.OperatingCashFlow,
      normalized.CapEx,
    )).toBeCloseTo(145.125);
  });

  it("does not guess the reporting currency for a missing unit in mixed-currency data", () => {
    const normalized = normalizeFinancialItems(
      { NetIncome: 100, ShareholdersEquity: 500 },
      { ShareholdersEquity: "TWD" },
      {
        reportingCurrency: "CNY",
        tradingCurrency: "HKD",
        knownItemCurrencies: new Set(["CNY", "TWD"]),
        fxRates,
      },
    );

    expect(normalized.NetIncome).toBeNull();
    expect(normalized.ShareholdersEquity).toBeCloseTo(125);
  });

  it("returns null when the required FX quote is unavailable", () => {
    const normalized = normalizeFinancialItems(
      { Revenue: 100 },
      { Revenue: "EUR" },
      {
        reportingCurrency: "EUR",
        tradingCurrency: "HKD",
        knownItemCurrencies: new Set(["EUR"]),
        fxRates: new Map(),
      },
    );

    expect(normalized.Revenue).toBeNull();
  });

  it("derives shares only when net income and EPS use the same explicit currency", () => {
    expect(
      deriveSharesFromFinancials(1_000, 2, "USD", "USD/shares"),
    ).toBe(500);
    expect(
      deriveSharesFromFinancials(1_000, 2, "CNY", "USD/shares"),
    ).toBeNull();
    expect(
      deriveSharesFromFinancials(1_000, 2, null, "USD/shares"),
    ).toBeNull();
  });
});
