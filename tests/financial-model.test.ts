import { describe, expect, it } from "vitest";
import {
  FINANCIAL_MODEL_TEMPLATES,
  getDefaultFinancialModel,
  isPePrimaryValuationAnchor,
  resolveFinancialModel,
} from "@/lib/financial-model";
import { SECTOR_MODEL_13_TYPES } from "@/lib/sector-classification";

describe("financial model registry", () => {
  it("defines exactly the six agreed base templates", () => {
    expect(FINANCIAL_MODEL_TEMPLATES).toEqual([
      "industrial",
      "bank",
      "insurance",
      "financial_services",
      "real_estate",
      "conglomerate",
    ]);
  });

  it("maps every persisted sector type to exactly one base template", () => {
    const expected = {
      consumer_brand: "industrial",
      healthcare: "industrial",
      software_platform: "industrial",
      semiconductor_hardware: "industrial",
      industrial: "industrial",
      banks: "bank",
      insurance: "insurance",
      capital_markets: "financial_services",
      real_estate: "real_estate",
      energy_materials: "industrial",
      utilities: "industrial",
      telecommunications: "industrial",
      conglomerate: "conglomerate",
    } as const;

    expect(Object.keys(expected)).toHaveLength(SECTOR_MODEL_13_TYPES.length);
    for (const type of SECTOR_MODEL_13_TYPES) {
      expect(resolveFinancialModel(type).template).toBe(expected[type]);
    }
  });

  it("keeps cyclical distinctions as modifiers of the industrial template while real_estate is independent", () => {
    expect(resolveFinancialModel("real_estate")).toMatchObject({
      template: "real_estate",
      modifiers: [],
      valuationAnchor: "nav_ffo",
      capitalAllocationModel: "property_returns",
    });
    expect(resolveFinancialModel("energy_materials")).toMatchObject({
      template: "industrial",
      modifiers: ["energy_materials"],
      valuationAnchor: "normalized_earnings",
    });
    expect(resolveFinancialModel("utilities")).toMatchObject({
      template: "industrial",
      modifiers: ["utilities"],
      valuationAnchor: "regulated_assets",
    });
  });

  it("uses distinct anchors and allocation rules for the templates", () => {
    expect(resolveFinancialModel("banks")).toMatchObject({
      template: "bank",
      valuationAnchor: "pb_roe",
      capitalAllocationModel: "financial_returns",
      showIndustrialCashFlow: false,
    });
    expect(resolveFinancialModel("insurance")).toMatchObject({
      template: "insurance",
      valuationAnchor: "embedded_value_pb",
      capitalAllocationModel: "financial_returns",
      showIndustrialCashFlow: false,
    });
    expect(resolveFinancialModel("capital_markets")).toMatchObject({
      template: "financial_services",
      valuationAnchor: "fee_earnings",
      capitalAllocationModel: "financial_services_returns",
      showIndustrialCashFlow: false,
    });
    expect(resolveFinancialModel("real_estate")).toMatchObject({
      template: "real_estate",
      valuationAnchor: "nav_ffo",
      capitalAllocationModel: "property_returns",
      showIndustrialCashFlow: false,
    });
    expect(resolveFinancialModel("conglomerate")).toMatchObject({
      template: "conglomerate",
      valuationAnchor: "sotp",
      capitalAllocationModel: "group_returns",
    });
  });

  it("returns no guessed model for an unsupported persisted sector value", () => {
    expect(resolveFinancialModel("unsupported")).toBeNull();
    expect(resolveFinancialModel(null)).toBeNull();
  });

  it("labels the unclassified fallback as generic rather than confirmed industrial", () => {
    expect(getDefaultFinancialModel()).toMatchObject({
      template: "industrial",
      templateLabel: "通用工商业",
      sectorModelType: null,
    });
  });

  it("uses one shared legacy fallback for uncategorized companies", () => {
    expect(
      resolveFinancialModel(null, {
        sector: "Financials",
        industry: "Real Estate Investment Trust",
      }),
    ).toMatchObject({
      template: "real_estate",
      subModel: "reit_property",
    });
    expect(
      resolveFinancialModel(null, {
        sector: "Financials",
        industry: "Commercial Bank",
      })?.template,
    ).toBe("bank");
    expect(resolveFinancialModel(null, { sector: "Technology" })).toBeNull();
  });

  it("does not treat book-value, NAV or sum-of-parts anchors as P/E models", () => {
    expect(isPePrimaryValuationAnchor(resolveFinancialModel("industrial")!.valuationAnchor)).toBe(true);
    expect(isPePrimaryValuationAnchor(resolveFinancialModel("banks")!.valuationAnchor)).toBe(false);
    expect(isPePrimaryValuationAnchor(resolveFinancialModel("insurance")!.valuationAnchor)).toBe(false);
    expect(isPePrimaryValuationAnchor(resolveFinancialModel("real_estate")!.valuationAnchor)).toBe(false);
    expect(isPePrimaryValuationAnchor(resolveFinancialModel("energy_materials")!.valuationAnchor)).toBe(false);
    expect(isPePrimaryValuationAnchor(resolveFinancialModel("utilities")!.valuationAnchor)).toBe(false);
    expect(isPePrimaryValuationAnchor(resolveFinancialModel("telecommunications")!.valuationAnchor)).toBe(false);
    expect(isPePrimaryValuationAnchor(resolveFinancialModel("semiconductor_hardware")!.valuationAnchor)).toBe(false);
    expect(isPePrimaryValuationAnchor(resolveFinancialModel("conglomerate")!.valuationAnchor)).toBe(false);
  });
});
