import { describe, expect, it } from "vitest";
import {
  assessRequirement,
  type ValidationFinancialData,
} from "../scripts/lib/metric-coverage";
import type { FinancialLineage } from "../scripts/lib/financial-lineage";

function dataWithYears(
  fieldsByYear: Record<number, string[]>,
  options: {
    priceYears?: number[];
    lineage?: FinancialLineage;
  } = {},
): ValidationFinancialData {
  const years = Object.keys(fieldsByYear).map(Number).sort((a, b) => a - b);
  const valuesByYear = new Map<number, Map<string, number>>();
  const lineageByYear = new Map<number, Map<string, FinancialLineage>>();
  for (const year of years) {
    valuesByYear.set(
      year,
      new Map((fieldsByYear[year] ?? []).map((field) => [field, 1])),
    );
    lineageByYear.set(
      year,
      new Map(
        (fieldsByYear[year] ?? []).map((field) => [
          field,
          options.lineage ?? "pipeline",
        ]),
      ),
    );
  }
  const priceYears = options.priceYears ?? [];
  return {
    years,
    valuesByYear,
    lineageByYear,
    priceRows: priceYears.length,
    priceStartYear: priceYears.length ? Math.min(...priceYears) : null,
    priceEndYear: priceYears.length ? Math.max(...priceYears) : null,
  };
}

describe("metric requirement coverage", () => {
  it("requires the latest year and at least four of the last five years", () => {
    const requirement = {
      alternatives: [["Revenue"]],
      coverageYears: 5,
      minCoverageRatio: 0.8,
    };
    const oneYear = dataWithYears({
      2021: [],
      2022: [],
      2023: [],
      2024: [],
      2025: ["Revenue"],
    });
    const fourYears = dataWithYears({
      2021: [],
      2022: ["Revenue"],
      2023: ["Revenue"],
      2024: ["Revenue"],
      2025: ["Revenue"],
    });

    expect(assessRequirement(requirement, oneYear)).toMatchObject({
      dataReady: false,
      latestReady: true,
      coverageReady: false,
      coveredYears: 1,
      windowYears: 5,
      ratio: 0.2,
    });
    expect(assessRequirement(requirement, fourYears)).toMatchObject({
      dataReady: true,
      latestReady: true,
      coverageReady: true,
      coveredYears: 4,
      windowYears: 5,
      ratio: 0.8,
    });
  });

  it("requires every year for a minimum contiguous sequence", () => {
    const requirement = {
      alternatives: [["NetIncome"]],
      minYears: 2,
      coverageYears: 5,
      minCoverageRatio: 0.8,
    };
    const data = dataWithYears({
      2021: ["NetIncome"],
      2022: ["NetIncome"],
      2023: ["NetIncome"],
      2024: ["NetIncome"],
      2025: [],
    });

    expect(assessRequirement(requirement, data)).toMatchObject({
      dataReady: false,
      latestReady: false,
      coverageReady: true,
      sequenceReady: false,
    });
  });

  it("requires annual price availability across the coverage window", () => {
    const requirement = {
      alternatives: [["EPSDiluted"]],
      needsPrice: true,
      coverageYears: 5,
      minCoverageRatio: 0.8,
    };
    const fundamentals = {
      2021: ["EPSDiluted"],
      2022: ["EPSDiluted"],
      2023: ["EPSDiluted"],
      2024: ["EPSDiluted"],
      2025: ["EPSDiluted"],
    };

    expect(
      assessRequirement(
        requirement,
        dataWithYears(fundamentals, { priceYears: [2023, 2024, 2025] }),
      ),
    ).toMatchObject({
      dataReady: false,
      latestReady: true,
      coverageReady: false,
      coveredYears: 3,
    });
  });

  it("propagates the weakest source lineage across the coverage window", () => {
    const requirement = {
      alternatives: [["Revenue"]],
      coverageYears: 5,
      minCoverageRatio: 0.8,
    };
    const data = dataWithYears(
      {
        2021: ["Revenue"],
        2022: ["Revenue"],
        2023: ["Revenue"],
        2024: ["Revenue"],
        2025: ["Revenue"],
      },
      { lineage: "fixture" },
    );

    expect(assessRequirement(requirement, data).lineage).toBe("fixture");
  });
});
