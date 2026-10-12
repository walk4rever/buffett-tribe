import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type DictionaryEntry = {
  key: string;
  tagsUsGaap?: string[];
  tagsIfrs?: string[];
};

const dictionary = JSON.parse(
  readFileSync("scripts/lib/canonical-financial-dictionary.json", "utf8"),
) as DictionaryEntry[];

describe("cash flow dictionary mappings", () => {
  it("does not map beginning-of-period cash to ending cash balance tags", () => {
    const beginning = dictionary.find((item) => item.key === "CashBeginningOfPeriod");
    const ending = dictionary.find((item) => item.key === "CashEndOfPeriod");
    const endingTags = new Set([...(ending?.tagsUsGaap ?? []), ...(ending?.tagsIfrs ?? [])]);
    const beginningTags = [...(beginning?.tagsUsGaap ?? []), ...(beginning?.tagsIfrs ?? [])];

    expect(beginningTags).not.toContain("CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents");
    expect(beginningTags).not.toContain("CashAndCashEquivalents");
    expect(beginningTags.some((tag) => endingTags.has(tag))).toBe(false);
  });
});
