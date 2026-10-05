import { describe, expect, it } from "vitest";
import {
  buildMasterHolderTrends,
  selectTopMasterHolders,
  type MasterHolderTrendGroup,
  type MasterHolderTrendPosition,
  type MasterHolderTrendQuarter,
} from "../src/lib/master-holding-trends";

describe("selectTopMasterHolders", () => {
  it("ranks active positions before exits, then newer quarters and larger portfolio weights", () => {
    const ranked = selectTopMasterHolders(
      [
        { name: "Exited", activity: "SoldOut", sourceYear: 2026, sourceQuarter: 1, weightPct: 10, valueUsd: 50_000_000 },
        { name: "Older active", activity: "Added", sourceYear: 2025, sourceQuarter: 4, weightPct: 4, valueUsd: 20_000_000 },
        { name: "Recent active", activity: "Unchanged", sourceYear: 2026, sourceQuarter: 1, weightPct: 1, valueUsd: 5_000_000 },
        { name: "Higher weight", activity: "Added", sourceYear: 2026, sourceQuarter: 1, weightPct: 2, valueUsd: 3_000_000 },
      ],
      3,
    );

    expect(ranked.map((holder) => holder.name)).toEqual([
      "Higher weight",
      "Recent active",
      "Older active",
    ]);
  });

  it("uses value as a tie-breaker and ranks the complete candidate set before limiting", () => {
    const candidates = Array.from({ length: 24 }, (_, index) => ({
      name: `Candidate ${index}`,
      activity: "Added",
      sourceYear: 2026,
      sourceQuarter: 1,
      weightPct: index === 23 ? 9 : 1,
      valueUsd: index,
    }));
    candidates[0]!.weightPct = 2;
    candidates[1]!.weightPct = 2;
    candidates[1]!.valueUsd = 100;

    expect(selectTopMasterHolders(candidates, 3).map((holder) => holder.name)).toEqual([
      "Candidate 23",
      "Candidate 1",
      "Candidate 0",
    ]);
  });
});

describe("buildMasterHolderTrends", () => {
  const groups: MasterHolderTrendGroup[] = [
    { key: "alpha", holderIds: ["filer-a"] },
    { key: "combined", holderIds: ["filer-a", "filer-b"] },
  ];

  it("adds distinct share classes and ignores duplicate security profiles", () => {
    const filings: MasterHolderTrendQuarter[] = [
      { holderId: "filer-a", year: 2025, quarter: 1 },
      { holderId: "filer-a", year: 2025, quarter: 2 },
    ];
    const positions: MasterHolderTrendPosition[] = [
      { holderId: "filer-a", securityKey: "ABC", putCall: "NONE", year: 2025, quarter: 1, weightPct: 1.2, sharesNumber: 10, valueUsd: 100 },
      { holderId: "filer-a", securityKey: "abc", putCall: "NONE", year: 2025, quarter: 1, weightPct: 1.4, sharesNumber: 12, valueUsd: 120 },
      { holderId: "filer-a", securityKey: "ABC.B", putCall: "NONE", year: 2025, quarter: 1, weightPct: 0.6, sharesNumber: 5, valueUsd: 50 },
    ];

    const trends = buildMasterHolderTrends(groups.slice(0, 1), filings, positions);

    expect(trends.get("alpha")).toEqual([
      { year: 2025, quarter: 1, weightPct: 2, sharesNumber: 17, valueUsd: 170 },
      { year: 2025, quarter: 2, weightPct: 0, sharesNumber: 0, valueUsd: 0 },
    ]);
  });

  it("combines filing entities while preserving quarters without a filing as missing", () => {
    const filings: MasterHolderTrendQuarter[] = [
      { holderId: "filer-a", year: 2025, quarter: 1 },
      { holderId: "filer-a", year: 2025, quarter: 3 },
      { holderId: "filer-b", year: 2025, quarter: 1 },
      { holderId: "filer-b", year: 2025, quarter: 2 },
    ];
    const positions: MasterHolderTrendPosition[] = [
      { holderId: "filer-a", securityKey: "ABC", putCall: "NONE", year: 2025, quarter: 1, weightPct: 2, sharesNumber: 20, valueUsd: 200 },
      { holderId: "filer-a", securityKey: "ABC", putCall: "NONE", year: 2025, quarter: 3, weightPct: 3, sharesNumber: 30, valueUsd: 300 },
      { holderId: "filer-b", securityKey: "ABC", putCall: "NONE", year: 2025, quarter: 1, weightPct: 1, sharesNumber: 10, valueUsd: 100 },
    ];

    const trends = buildMasterHolderTrends(groups.slice(1), filings, positions);

    expect(trends.get("combined")).toEqual([
      { year: 2025, quarter: 1, weightPct: 3, sharesNumber: 30, valueUsd: 300 },
      { year: 2025, quarter: 2, weightPct: 0, sharesNumber: 0, valueUsd: 0 },
      { year: 2025, quarter: 3, weightPct: 3, sharesNumber: 30, valueUsd: 300 },
    ]);
  });

  it("keeps a quarter missing when its reported portfolio weight is unavailable", () => {
    const filings: MasterHolderTrendQuarter[] = [
      { holderId: "filer-a", year: 2025, quarter: 1 },
    ];
    const positions: MasterHolderTrendPosition[] = [
      { holderId: "filer-a", securityKey: "ABC", putCall: "NONE", year: 2025, quarter: 1, weightPct: null, sharesNumber: 10, valueUsd: 100 },
    ];

    const trends = buildMasterHolderTrends(groups.slice(0, 1), filings, positions);

    expect(trends.get("alpha")).toEqual([
      { year: 2025, quarter: 1, weightPct: null, sharesNumber: 10, valueUsd: 100 },
    ]);
  });

  it("keeps share and market value metrics missing when the source omits them", () => {
    const filings: MasterHolderTrendQuarter[] = [
      { holderId: "filer-a", year: 2025, quarter: 1 },
    ];
    const positions: MasterHolderTrendPosition[] = [
      { holderId: "filer-a", securityKey: "ABC", putCall: "NONE", year: 2025, quarter: 1, weightPct: 1.5, sharesNumber: null, valueUsd: null },
    ];

    const trends = buildMasterHolderTrends(groups.slice(0, 1), filings, positions);

    expect(trends.get("alpha")).toEqual([
      { year: 2025, quarter: 1, weightPct: 1.5, sharesNumber: null, valueUsd: null },
    ]);
  });
});
