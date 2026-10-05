import { describe, expect, it } from "vitest";
import {
  mergeCompanyEntityIds,
  parseCompanyEntityIds,
} from "../../src/lib/insight-company-links";

describe("insight company links", () => {
  it("trims and deduplicates selected company ids", () => {
    expect(parseCompanyEntityIds([" company-a ", "company-a", "company-b"])).toEqual([
      "company-a",
      "company-b",
    ]);
  });

  it("accepts an empty list to remove all company links", () => {
    expect(parseCompanyEntityIds([])).toEqual([]);
  });

  it("rejects malformed or excessively large company id lists", () => {
    expect(parseCompanyEntityIds("company-a")).toBeNull();
    expect(parseCompanyEntityIds(["company-a", 12])).toBeNull();
    expect(parseCompanyEntityIds([" ".repeat(2)])).toBeNull();
    expect(parseCompanyEntityIds(Array.from({ length: 101 }, (_, i) => `company-${i}`))).toBeNull();
  });

  it("replaces company links without removing links to other entity types", () => {
    expect(
      mergeCompanyEntityIds(
        ["master-a", "company-old", "company-removed", "master-b"],
        ["company-old", "company-removed"],
        ["company-new", "company-old", "company-new"],
      ),
    ).toEqual(["master-a", "master-b", "company-new", "company-old"]);
  });
});
