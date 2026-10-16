import { describe, expect, it } from "vitest";
import { resolveFinancialModel } from "@/lib/financial-model";
import {
  buildValueLineMetricProfile,
  type ValueLineMetricAnnual,
} from "@/lib/value-line-metric-profile";

function makeAnnuals(): ValueLineMetricAnnual[] {
  return Array.from({ length: 5 }, (_, index) => {
    const year = 2020 + index;
    const growth = (base: number, rate: number) => base * (1 + rate) ** index;
    return {
      year,
      revenue: growth(100, 0.08),
      netIncome: growth(12, 0.1),
      operatingCashFlow: growth(16, 0.09),
      freeCashFlow: growth(10, 0.12),
      shareholdersEquity: growth(60, 0.07),
      totalAssets: growth(240, 0.06),
      totalLiabilities: growth(150, 0.05),
      eps: growth(2, 0.11),
      shares: 100,
      dividendsPaid: growth(5, 0.08),
      assetsUnderManagement: growth(800, 0.13),
      netClientFlows: 25,
      investmentManagementFeeIncome: growth(8, 0.12),
      netFeeAndCommissionIncome: growth(15, 0.09),
      netPremiumsEarned: growth(70, 0.06),
      policyClaimsAndBenefits: -growth(45, 0.05),
      claimsRatio: 0.65,
      investmentIncome: growth(9, 0.07),
      totalInvestments: growth(180, 0.05),
      contractLiabilities: growth(40, 0.08),
      inventory: growth(55, 0.04),
      operatingIncome: growth(18, 0.075),
      investmentProperty: growth(150, 0.05),
    };
  });
}

function resolveModel(
  sector: Parameters<typeof resolveFinancialModel>[0],
  subModel?: string,
) {
  const model = resolveFinancialModel(sector)!;
  return subModel ? { ...model, subModel } : model;
}

describe("buildValueLineMetricProfile", () => {
  it.each([
    ["industrial", undefined, "现金转化率"],
    ["banks", undefined, "5年 ROA 均值"],
    ["insurance", "property_casualty", "5年赔付率"],
    ["capital_markets", "asset_mgmt", "管理资产规模"],
    ["real_estate", "developer", "合同负债 / 营收"],
    ["conglomerate", undefined, "综合现金造血"],
  ] as const)(
    "provides an applicable operating metric and four growth metrics for %s",
    (sector, subModel, expectedOperatingTitle) => {
      const profile = buildValueLineMetricProfile(
        resolveModel(sector, subModel),
        makeAnnuals(),
      );

      expect(profile.operatingMetric?.title).toBe(expectedOperatingTitle);
      expect(profile.growthMetrics).toHaveLength(4);
      expect(profile.growthMetrics.every((metric) => metric.value != null)).toBe(true);
    },
  );

  it("uses per-share paid distributions instead of net income growth for REITs", () => {
    const profile = buildValueLineMetricProfile(
      resolveModel("real_estate", "reit_property"),
      makeAnnuals(),
    );

    expect(profile.operatingMetric?.title).toBe("物业经营回报");
    expect(profile.growthMetrics).toHaveLength(4);
    expect(profile.growthMetrics.map((metric) => metric.title)).toContain(
      "每股已实施分红增长",
    );
    expect(profile.growthMetrics.map((metric) => metric.title)).not.toContain(
      "净利润增长",
    );
  });

  it("excludes premiums from years with undisclosed claims", () => {
    const annuals = makeAnnuals();
    annuals[4].policyClaimsAndBenefits = null;
    const profile = buildValueLineMetricProfile(
      resolveModel("insurance", "property_casualty"),
      annuals,
    );

    expect(profile.operatingMetric?.value).toBe("63.3%");
  });

  it("does not invent metrics when required financial data is absent", () => {
    const profile = buildValueLineMetricProfile(
      resolveModel("banks"),
      [{ year: 2024 }],
    );

    expect(profile.operatingMetric).toBeNull();
    expect(profile.growthMetrics).toHaveLength(0);
  });
});
