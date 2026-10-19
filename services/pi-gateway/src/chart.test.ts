import { describe, expect, it } from "vitest";
import { normalizeChartRange, normalizeChartTicker } from "./chart.js";

describe("chart input validation", () => {
  it("normalizes valid tickers", () => {
    expect(normalizeChartTicker(" aapl ")).toBe("AAPL");
    expect(normalizeChartTicker("600519.SS")).toBe("600519.SS");
    expect(normalizeChartTicker("^GSPC")).toBe("^GSPC");
  });

  it("rejects shell metacharacters and oversized tickers", () => {
    expect(normalizeChartTicker("AAPL; rm -rf /")).toBeNull();
    expect(normalizeChartTicker("AAPL$(whoami)")).toBeNull();
    expect(normalizeChartTicker("A".repeat(21))).toBeNull();
  });

  it("defaults to 10d and rejects unknown ranges", () => {
    expect(normalizeChartRange(undefined)).toBe("10d");
    expect(normalizeChartRange("1mo")).toBe("1mo");
    expect(normalizeChartRange("1h")).toBeNull();
    expect(normalizeChartRange("10d; whoami")).toBeNull();
  });
});
