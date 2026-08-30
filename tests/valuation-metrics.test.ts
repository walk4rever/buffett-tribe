import { describe, expect, it } from "vitest";

import { computeFcf, computeScenarios } from "../src/lib/valuation-metrics";

describe("computeFcf", () => {
  it("subtracts capex magnitude from OCF", () => {
    expect(computeFcf(1000, 300)).toBe(700);
  });

  it("treats signed capex as a magnitude", () => {
    expect(computeFcf(1000, -300)).toBe(700);
  });

  it("returns null when either input is missing", () => {
    expect(computeFcf(null, 300)).toBeNull();
    expect(computeFcf(1000, null)).toBeNull();
    expect(computeFcf(null, null)).toBeNull();
  });

  it("can go negative for heavy-capex years", () => {
    expect(computeFcf(500, 800)).toBe(-300);
  });
});

describe("computeScenarios", () => {
  const base = {
    latestEps: 10,
    latestPrice: 200,
    horizonYears: 5,
  };

  it("computes implied price and annualized return", () => {
    const [result] = computeScenarios({
      ...base,
      scenarios: [{ name: "基准", growthPct: 6, exitPe: 25, rationale: "" }],
    });
    // 10 * 1.06^5 * 25 = 334.56
    expect(result.impliedPrice).toBeCloseTo(334.56, 2);
    // (334.56 / 200)^(1/5) - 1 = 10.84%
    expect(result.impliedAnnualReturnPct).toBeCloseTo(10.8, 1);
  });

  it("returns negative annualized return when implied price is below current", () => {
    const [result] = computeScenarios({
      ...base,
      scenarios: [{ name: "保守", growthPct: 0, exitPe: 15, rationale: "" }],
    });
    // 10 * 1^5 * 15 = 150 < 200
    expect(result.impliedPrice).toBe(150);
    expect(result.impliedAnnualReturnPct).toBeLessThan(0);
  });

  it("nulls out results when EPS or price is missing", () => {
    const results = computeScenarios({
      latestEps: null,
      latestPrice: 200,
      horizonYears: 5,
      scenarios: [{ name: "基准", growthPct: 6, exitPe: 25, rationale: "" }],
    });
    expect(results[0].impliedPrice).toBeNull();
    expect(results[0].impliedAnnualReturnPct).toBeNull();
  });

  it("nulls out results for non-positive EPS instead of returning a negative implied price", () => {
    const results = computeScenarios({
      ...base,
      latestEps: -0.39,
      scenarios: [{ name: "基准", growthPct: 20, exitPe: 25, rationale: "" }],
    });
    expect(results[0].impliedPrice).toBeNull();
    expect(results[0].impliedAnnualReturnPct).toBeNull();
  });

  it("nulls out results for non-finite assumptions", () => {
    const results = computeScenarios({
      ...base,
      scenarios: [{ name: "坏数据", growthPct: NaN, exitPe: 25, rationale: "" }],
    });
    expect(results[0].impliedPrice).toBeNull();
  });
});
