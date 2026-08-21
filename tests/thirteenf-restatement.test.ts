import { describe, expect, it } from "vitest";

import { dropSupersededByRestatement, type RestatableFiling } from "../scripts/lib/thirteenf-restatement";

describe("dropSupersededByRestatement", () => {
  it("drops the original when a RESTATEMENT exists for the same quarter (H&H International/段永平 2024Q4 case)", () => {
    const original: RestatableFiling = {
      accession: "0001085146-25-001521",
      reportDate: "2024-12-31",
      filedAt: "2025-02-14",
      amendmentType: null,
    };
    const restatement: RestatableFiling = {
      accession: "0001085146-25-001626",
      reportDate: "2024-12-31",
      filedAt: "2025-02-14",
      amendmentType: "RESTATEMENT",
    };

    expect(dropSupersededByRestatement([original, restatement])).toEqual([restatement]);
    expect(dropSupersededByRestatement([restatement, original])).toEqual([restatement]);
  });

  it("keeps both filings when neither is a RESTATEMENT (e.g. a NEW HOLDINGS confidential-treatment supplement)", () => {
    const primary: RestatableFiling = {
      accession: "0001172661-25-001119",
      reportDate: "2024-12-31",
      filedAt: "2025-02-14",
      amendmentType: null,
    };
    const supplement: RestatableFiling = {
      accession: "0001172661-25-001497",
      reportDate: "2024-12-31",
      filedAt: "2025-04-16",
      amendmentType: "NEW HOLDINGS",
    };

    const result = dropSupersededByRestatement([primary, supplement]);
    expect(result).toHaveLength(2);
    expect(result).toEqual(expect.arrayContaining([primary, supplement]));
  });

  it("only compares filings within the same reporting quarter", () => {
    const q3: RestatableFiling = { accession: "a", reportDate: "2024-09-30", filedAt: "2024-11-14", amendmentType: null };
    const q4Restatement: RestatableFiling = { accession: "b", reportDate: "2024-12-31", filedAt: "2025-02-14", amendmentType: "RESTATEMENT" };

    expect(dropSupersededByRestatement([q3, q4Restatement])).toEqual(expect.arrayContaining([q3, q4Restatement]));
  });

  it("keeps the most recently filed RESTATEMENT if more than one exists for the same quarter", () => {
    const earlier: RestatableFiling = { accession: "a", reportDate: "2024-12-31", filedAt: "2025-02-14", amendmentType: "RESTATEMENT" };
    const later: RestatableFiling = { accession: "b", reportDate: "2024-12-31", filedAt: "2025-03-01", amendmentType: "RESTATEMENT" };

    expect(dropSupersededByRestatement([earlier, later])).toEqual([later]);
  });

  it("returns filings unchanged when there is exactly one per quarter", () => {
    const only: RestatableFiling = { accession: "a", reportDate: "2024-12-31", filedAt: "2025-02-14", amendmentType: null };
    expect(dropSupersededByRestatement([only])).toEqual([only]);
  });
});
