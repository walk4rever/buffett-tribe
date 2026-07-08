import { describe, expect, it } from "vitest";
import { extractExcerpt, formatSectionLabel, resolveSectionKeys } from "./search-filings-format.js";

describe("resolveSectionKeys", () => {
  it("returns null when no section is given", () => {
    expect(resolveSectionKeys(null)).toBeNull();
  });

  it("resolves a friendly alias to its ordered section keys", () => {
    expect(resolveSectionKeys("business")).toEqual(["item_1_business", "item_4_company_information"]);
    expect(resolveSectionKeys("mda")).toEqual([
      "item_7_mda",
      "item_5_operating_financial_review",
      "management_discussion_and_analysis",
    ]);
  });

  it("normalizes case, spaces, and hyphens before alias lookup", () => {
    expect(resolveSectionKeys("Market Risk")).toEqual(["item_7a_market_risk", "item_11_market_risk"]);
    expect(resolveSectionKeys("market-risk")).toEqual(["item_7a_market_risk", "item_11_market_risk"]);
  });

  it("passes through an exact section key that isn't an alias", () => {
    expect(resolveSectionKeys("item_9_accountants")).toEqual(["item_9_accountants"]);
  });
});

describe("extractExcerpt", () => {
  it("returns short content unchanged when no keyword is given", () => {
    expect(extractExcerpt("hello world", null)).toBe("hello world");
  });

  it("truncates long content with a notice when no keyword is given", () => {
    const content = "a".repeat(5000);
    const result = extractExcerpt(content, null);
    expect(result.startsWith("a".repeat(4000))).toBe(true);
    expect(result).toContain("内容已截断，共 5000 字");
  });

  it("finds a keyword deep in long content and windows around it, case-insensitively", () => {
    const content = "x".repeat(3000) + "Disney Aspire program" + "y".repeat(3000);
    const result = extractExcerpt(content, "aspire");
    expect(result).toContain("Disney Aspire program");
    expect(result.startsWith("[…] ")).toBe(true);
    expect(result.endsWith(" […]")).toBe(true);
  });

  it("does not truncate the prefix ellipsis when the match is near the start", () => {
    const content = "Aspire program details " + "z".repeat(5000);
    const result = extractExcerpt(content, "Aspire");
    expect(result.startsWith("[…] ")).toBe(false);
    expect(result).toContain("Aspire program details");
  });

  it("falls back to the start of content with a not-found notice when the keyword is missing", () => {
    const content = "b".repeat(5000);
    const result = extractExcerpt(content, "nonexistent-keyword");
    expect(result).toContain('未找到关键词"nonexistent-keyword"，显示开头内容');
  });

  it("omits the not-found notice when short content has no match", () => {
    const result = extractExcerpt("short content", "nope");
    expect(result).toBe("short content");
  });
});

describe("formatSectionLabel", () => {
  it("strips the item number prefix and title-cases the rest", () => {
    expect(formatSectionLabel("item_1_business")).toBe("Business");
    expect(formatSectionLabel("item_7_mda")).toBe("Mda");
    expect(formatSectionLabel("item_1a_risk_factors")).toBe("Risk Factors");
  });

  it("leaves non-item-prefixed keys mostly intact aside from casing", () => {
    expect(formatSectionLabel("management_discussion_and_analysis")).toBe("Management Discussion And Analysis");
  });
});
