import { describe, expect, it } from "vitest";

import {
  buildHistoricalPeSeries,
  computeHistoricalPeMetrics,
  computeAnnualEpsGrowthPct,
} from "../src/lib/valuation-analysis-metrics";

describe("buildHistoricalPeSeries", () => {
  const annuals = [
    { year: 2022, eps: 5 },
    { year: 2023, eps: 10 },
    { year: 2024, eps: 20 },
  ];

  it("uses the latest completed prior fiscal-year EPS, not same-year EPS", () => {
    const series = buildHistoricalPeSeries(
      [
        { date: "2023-12-29", close: 100 },
        { date: "2024-12-31", close: 200 },
        { date: "2025-12-31", close: 400 },
      ],
      annuals,
    );

    expect(series.map((point) => point.pe)).toEqual([20, 20, 20]);
    expect(series.map((point) => point.eps)).toEqual([5, 10, 20]);
  });

  it("omits prices when no prior-year EPS is available", () => {
    const series = buildHistoricalPeSeries(
      [{ date: "2022-08-01", close: 100 }],
      annuals,
    );

    expect(series).toEqual([]);
  });

  it("omits non-positive earnings and invalid prices", () => {
    const series = buildHistoricalPeSeries(
      [
        { date: "2024-06-01", close: 100 },
        { date: "2024-07-01", close: 0 },
      ],
      [{ year: 2023, eps: -2 }],
    );

    expect(series).toEqual([]);
  });
});

describe("computeHistoricalPeMetrics", () => {
  it("returns no benchmark when there are no valid historical samples", () => {
    expect(computeHistoricalPeMetrics([], 20)).toEqual({
      peMin: null,
      peMedian: null,
      peMax: null,
      currentPercentile: null,
      sampleCount: 0,
    });
  });

  it("computes percentile and median from observed samples only", () => {
    const metrics = computeHistoricalPeMetrics(
      [{ pe: 10 }, { pe: 20 }, { pe: 30 }, { pe: 40 }],
      25,
    );

    expect(metrics.peMedian).toBe(25);
    expect(metrics.currentPercentile).toBe(50);
    expect(metrics.sampleCount).toBe(4);
  });
});

describe("computeAnnualEpsGrowthPct", () => {
  it("uses the calendar-year span between positive annual EPS values", () => {
    expect(
      computeAnnualEpsGrowthPct([
        { year: 2020, eps: 10 },
        { year: 2022, eps: 14.4 },
      ]),
    ).toBe(20);
  });

  it("returns null without at least two positive annual EPS observations", () => {
    expect(computeAnnualEpsGrowthPct([{ year: 2024, eps: 10 }])).toBeNull();
  });
});
