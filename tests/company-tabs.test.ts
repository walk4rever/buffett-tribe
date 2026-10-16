import { describe, expect, it } from "vitest";

import { buildCompanyTabs } from "../src/lib/company-tabs";

const commonOptions = {
  hasBusinessCanvas: true,
  hasRealMoat: true,
  hasCapitalAllocation: true,
  hasValuation: true,
  showDeepAnalysisButton: false,
};

describe("buildCompanyTabs", () => {
  it("adds 13F as the last tab for US companies", () => {
    const tabs = buildCompanyTabs({ ...commonOptions, market: "us" });

    expect(tabs.at(-1)).toMatchObject({
      id: "holdings",
      label: "13F持仓",
    });
  });

  it.each(["cn", "hk"])("does not add 13F for the %s market", (market) => {
    const tabs = buildCompanyTabs({ ...commonOptions, market });

    expect(tabs.some((tab) => tab.id === "holdings")).toBe(false);
  });

  it("keeps the US 13F tab last when phase-one tabs are filtered", () => {
    const tabs = buildCompanyTabs({
      ...commonOptions,
      market: "us",
      hasBusinessCanvas: false,
      hasRealMoat: false,
      hasCapitalAllocation: false,
      hasValuation: false,
      showDeepAnalysisButton: true,
    });

    expect(tabs.map((tab) => tab.id)).toEqual([
      "valueline",
      "financial",
      "holdings",
    ]);
  });
});
