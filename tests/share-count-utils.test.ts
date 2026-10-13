import { describe, expect, it } from "vitest";

import {
  calculatePeriodEndShareChange,
  getLatestPeriodEndShares,
  getPeriodEndShareSeries,
} from "../src/lib/share-count-utils";

describe("period-end share count helpers", () => {
  const annuals = [
    { year: 2021, shares: 100, sharesSource: "disclosed_period_end" as const },
    { year: 2022, shares: 104, sharesSource: "weighted_average" as const },
    { year: 2023, shares: 110, sharesSource: "derived" as const },
    { year: 2024, shares: 90, sharesSource: "disclosed_period_end" as const },
  ];

  it("selects the latest confirmed period-end count, not weighted or derived shares", () => {
    expect(getLatestPeriodEndShares(annuals)).toBe(90);
    expect(getLatestPeriodEndShares([
      { year: 2024, shares: 104, sharesSource: "weighted_average" as const },
      { year: 2023, shares: 110, sharesSource: "derived" as const },
    ])).toBeNull();
  });

  it("preserves missing years and non-period-end rows as gaps in the share series", () => {
    expect(getPeriodEndShareSeries(annuals)).toEqual([
      { year: 2021, shares: 100 },
      { year: 2022, shares: null },
      { year: 2023, shares: null },
      { year: 2024, shares: 90 },
    ]);
  });

  it("does not calculate a share change across missing or non-period-end years", () => {
    expect(calculatePeriodEndShareChange(annuals)).toBeNull();
    expect(calculatePeriodEndShareChange([
      { year: 2022, shares: 100, sharesSource: "disclosed_period_end" as const },
      { year: 2023, shares: 95, sharesSource: "disclosed_period_end" as const },
    ])).toBe(-5);
  });
});
