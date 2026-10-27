import { describe, expect, it } from "vitest";
import {
  classifyFinancialLineage,
  combineFinancialLineage,
} from "../scripts/lib/financial-lineage";

describe("financial lineage classification", () => {
  it("accepts automated provider and XBRL rows", () => {
    expect(
      classifyFinancialLineage({
        sourceKind: "akshare",
        mappingRule: null,
      }),
    ).toBe("pipeline");
    expect(
      classifyFinancialLineage({
        sourceKind: "10k",
        mappingRule: "sec-xbrl:Revenue@2026-02-19",
      }),
    ).toBe("pipeline");
    expect(
      classifyFinancialLineage({
        sourceKind: "cn-annual-report",
        mappingRule: "derived:Revenue-CostOfRevenue",
      }),
    ).toBe("pipeline");
  });

  it("rejects manually curated fact files", () => {
    for (const mappingRule of [
      "bank-report:p. 10",
      "insurance-report:p. 12",
      "reit-report:p. 20",
      "fixture:legacy value",
    ]) {
      expect(
        classifyFinancialLineage({
          sourceKind: "hk-annual-report",
          mappingRule,
        }),
      ).toBe("fixture");
    }
  });

  it("keeps source-linked rows without an extractor marker unverified", () => {
    expect(
      classifyFinancialLineage({
        sourceKind: "hk-annual-report",
        mappingRule: null,
      }),
    ).toBe("unverified");
  });

  it("propagates the weakest input lineage", () => {
    expect(combineFinancialLineage(["pipeline", "pipeline"])).toBe("pipeline");
    expect(combineFinancialLineage(["pipeline", "unverified"])).toBe(
      "unverified",
    );
    expect(combineFinancialLineage(["pipeline", "unverified", "fixture"])).toBe(
      "fixture",
    );
  });
});
