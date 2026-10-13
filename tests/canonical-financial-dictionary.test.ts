import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CANONICAL_FINANCIAL_DICTIONARY } from "@/lib/canonical-financial-dictionary";

type DictionaryEntry = {
  key: string;
  statement?: string;
  periodType?: string;
  morningstarId?: string;
  modelSource?: string;
  tagsUsGaap?: string[];
  tagsIfrs?: string[];
  tagsCustom?: string[];
  cnAliases?: string[];
  hkAliases?: string[];
};

const dictionary = JSON.parse(
  readFileSync("scripts/lib/canonical-financial-dictionary.json", "utf8"),
) as DictionaryEntry[];
const morningstarTaxonomy = JSON.parse(
  readFileSync("scripts/lib/morningstar-master-taxonomy.json", "utf8"),
) as Array<{
  dataPointId: string;
  templates: string[];
}>;

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

describe("financial-services operating metrics", () => {
  it("extends the statement taxonomy with explicit AUM, flow, and fee definitions", () => {
    const expected = {
      AssetsUnderManagement: "instant",
      NetClientFlows: "duration",
      InvestmentManagementFeeIncome: "duration",
    };

    for (const [key, periodType] of Object.entries(expected)) {
      const item = CANONICAL_FINANCIAL_DICTIONARY.find((entry) => entry.key === key);
      const scriptItem = dictionary.find((entry) => entry.key === key);

      expect(item).toMatchObject({
        statement: "supplementary",
        periodType,
        modelSource: "buffett_tribe_extension",
      });
      expect(item?.morningstarId).toBeUndefined();
      expect(item?.tagsCustom?.length).toBeGreaterThan(0);
      expect(item?.cnAliases.length).toBeGreaterThan(0);
      expect(item?.hkAliases.length).toBeGreaterThan(0);
      expect(scriptItem).toEqual(item);
    }
  });

  it("keeps Morningstar's fee-and-commission item scoped to its bank templates", () => {
    const feeDataPoint = morningstarTaxonomy.find(
      (item) => item.dataPointId === "IFIS000460",
    );

    expect(feeDataPoint?.templates).toContain("Bank_US");
    expect(feeDataPoint?.templates).not.toContain("FinancialServices_US");
  });

  it("does not map gross or generic fee labels to net-fee metrics", () => {
    const netFees = CANONICAL_FINANCIAL_DICTIONARY.find(
      (item) => item.key === "NetFeeAndCommissionIncome",
    );
    const managementFees = CANONICAL_FINANCIAL_DICTIONARY.find(
      (item) => item.key === "InvestmentManagementFeeIncome",
    );

    expect(netFees?.tagsUsGaap).toEqual(["FeesAndCommissionsNet"]);
    expect(netFees?.hkAliases).not.toContain("Fee and commission income");
    expect(managementFees?.cnAliases).not.toContain("管理费收入");
    expect(managementFees?.tagsCustom).not.toContain("ManagementFeeRevenue");
  });
});
