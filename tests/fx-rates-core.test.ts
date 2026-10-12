import { describe, expect, it } from "vitest";

import {
  convertCurrency,
  currenciesNeededForConversion,
  extractLatestFxQuote,
  normalizeCurrencyCode,
} from "../src/lib/fx-rates-core";

describe("normalizeCurrencyCode", () => {
  it("accepts an ISO-style currency code and rejects financial units", () => {
    expect(normalizeCurrencyCode(" eur ")).toBe("EUR");
    expect(normalizeCurrencyCode("USD/shares")).toBeNull();
    expect(normalizeCurrencyCode("shares")).toBeNull();
    expect(normalizeCurrencyCode("UNIT_ABC")).toBeNull();
  });
});

describe("convertCurrency", () => {
  it("converts through USD rates and returns the input unchanged for same-currency values", () => {
    const rates = new Map([
      ["EUR", 1.1],
      ["HKD", 0.128],
    ]);

    expect(convertCurrency(100, "EUR", "USD", rates)).toBeCloseTo(110);
    expect(convertCurrency(100, "CNY", "HKD", new Map([["CNY", 0.14], ["HKD", 0.07]]))).toBeCloseTo(200);
    expect(convertCurrency(100, "EUR", "EUR", rates)).toBe(100);
  });

  it("returns null instead of guessing when either currency rate is missing", () => {
    expect(convertCurrency(100, "EUR", "USD", new Map())).toBeNull();
    expect(convertCurrency(null, "EUR", "USD", new Map())).toBeNull();
  });
});

describe("currenciesNeededForConversion", () => {
  it("requests only non-USD currencies in mismatched reporting and trading pairs", () => {
    expect(
      currenciesNeededForConversion([
        { reportingCurrency: "CNY", tradingCurrency: "CNY" },
        { reportingCurrency: "CNY", tradingCurrency: "HKD" },
        { reportingCurrency: "EUR", tradingCurrency: "USD" },
        { reportingCurrency: null, tradingCurrency: "USD" },
      ]),
    ).toEqual(["CNY", "EUR", "HKD"]);
  });
});

describe("extractLatestFxQuote", () => {
  it("uses the latest finite close and its timestamp", () => {
    expect(
      extractLatestFxQuote({
        chart: {
          result: [{
            timestamp: [1_800_000_000, 1_800_086_400, 1_800_172_800],
            indicators: { quote: [{ close: [1.08, null, 1.1] }] },
          }],
        },
      }),
    ).toEqual({
      rateToUsd: 1.1,
      asOfDate: new Date("2027-01-17T00:00:00.000Z"),
    });
  });

  it("rejects an empty or invalid Yahoo response", () => {
    expect(extractLatestFxQuote({})).toBeNull();
    expect(
      extractLatestFxQuote({
        chart: {
          result: [{ timestamp: [1_800_000_000], indicators: { quote: [{ close: [0] }] } }],
        },
      }),
    ).toBeNull();
  });
});
