import { describe, expect, it } from "vitest";
import { buildFinancialServicesMetricCard } from "@/lib/financial-services-metrics";

describe("buildFinancialServicesMetricCard", () => {
  it("shows only disclosed financial-services metrics with their own report years", () => {
    const card = buildFinancialServicesMetricCard(
      [
        {
          year: 2024,
          assetsUnderManagement: 10_000_000_000_000,
          netClientFlows: 250_000_000_000,
          investmentManagementFeeIncome: 16_000_000_000,
          netFeeAndCommissionIncome: 4_000_000_000,
        },
        {
          year: 2025,
          assetsUnderManagement: 12_000_000_000_000,
          netClientFlows: null,
          investmentManagementFeeIncome: 18_000_000_000,
          netFeeAndCommissionIncome: null,
        },
      ],
      "$",
    );

    expect(card).toEqual({
      applicable: true,
      title: "管理资产规模",
      badge: "FY2025 · 公司披露",
      mainNum: "$12.0万亿",
      subText:
        "FY2025 期末客户管理资产（公司披露） · FY2024 净流入 $2,500亿（公司披露） · FY2025 管理费 $180.0亿 · FY2024 手续费净收入 $40.0亿",
    });
  });

  it("hides the operating card when no source metric is present", () => {
    expect(
      buildFinancialServicesMetricCard(
        [{ year: 2025, assetsUnderManagement: null, netClientFlows: null }],
        "$",
      ),
    ).toEqual({
      applicable: false,
      title: "",
      badge: "",
      mainNum: "",
      subText: "",
    });
  });

  it("does not infer net client flows from AUM changes", () => {
    const card = buildFinancialServicesMetricCard(
      [
        { year: 2024, assetsUnderManagement: 10_000_000_000_000 },
        { year: 2025, assetsUnderManagement: 12_000_000_000_000 },
      ],
      "$",
    );

    expect(card.subText).toBe("FY2025 期末客户管理资产（公司披露）");
    expect(card.subText).not.toContain("净流入");
  });
});
