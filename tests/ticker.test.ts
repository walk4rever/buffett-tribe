import { describe, expect, it } from "vitest";

import { isValidTickerFormat, normalizeTicker } from "../src/lib/ticker";

describe("normalizeTicker", () => {
  it("trims and uppercases", () => {
    expect(normalizeTicker(" aapl ")).toBe("AAPL");
  });

  it("resolves known aliases", () => {
    expect(normalizeTicker("BRK.B")).toBe("BRK-B");
    expect(normalizeTicker("brk/a")).toBe("BRK-A");
  });

  it("returns null for empty input", () => {
    expect(normalizeTicker(null)).toBeNull();
    expect(normalizeTicker(undefined)).toBeNull();
    expect(normalizeTicker("  ")).toBeNull();
  });
});

describe("isValidTickerFormat", () => {
  it("accepts plain US tickers", () => {
    expect(isValidTickerFormat("AAPL")).toBe(true);
    expect(isValidTickerFormat("V")).toBe(true);
    expect(isValidTickerFormat("AGCUU")).toBe(true);
  });

  it("accepts US tickers with a class/preferred suffix", () => {
    expect(isValidTickerFormat("BRK-B")).toBe(true);
    expect(isValidTickerFormat("JPM-PM")).toBe(true);
  });

  it("accepts HK and CN exchange codes", () => {
    expect(isValidTickerFormat("0700.HK")).toBe(true);
    expect(isValidTickerFormat("600519.SS")).toBe(true);
    expect(isValidTickerFormat("300750.SZ")).toBe(true);
  });

  it("rejects the ANETXXXX-style garbage suffix that leaked in from edgartools", () => {
    expect(isValidTickerFormat("ANETXXXX")).toBe(false);
    expect(isValidTickerFormat("LRCXXXXX")).toBe(false);
    expect(isValidTickerFormat("BAMXXXX")).toBe(false);
  });

  it("rejects other malformed values", () => {
    expect(isValidTickerFormat("")).toBe(false);
    expect(isValidTickerFormat("TOO-LONG-SUFFIX")).toBe(false);
    expect(isValidTickerFormat("12345")).toBe(false);
  });
});
