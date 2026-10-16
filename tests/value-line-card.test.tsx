import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ValueLineBody, ValueLineHeader } from "@/components/ValueLineCard";
import type { ValueLineData } from "@/lib/value-line-data";
import { resolveFinancialModel } from "@/lib/financial-model";
import {
  buildValueLineMetricProfile,
  type ValueLineMetricAnnual,
} from "@/lib/value-line-metric-profile";

function metricAnnuals(): ValueLineMetricAnnual[] {
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
      investmentIncome: growth(9, 0.07),
      totalInvestments: growth(180, 0.05),
      contractLiabilities: growth(40, 0.08),
      inventory: growth(55, 0.04),
      operatingIncome: growth(18, 0.075),
      investmentProperty: growth(150, 0.05),
    };
  });
}

function renderHeader(sectorModelType: string) {
  const data = {
    financialModel: resolveFinancialModel(sectorModelType),
    sectorModelType,
    market: "us",
    ticker: "TEST",
    canonicalName: "Test Company",
    href: "/company/test",
    availableSecurities: [],
    latestPrice: 100,
    marketCap: 1_000_000,
    peRatio: 18,
    pbRatio: 2.4,
    valuationStatus: "fair",
    valuationDiffPct: 0,
  } as unknown as ValueLineData;

  return renderToStaticMarkup(
    <ValueLineHeader
      data={data}
      selectedTicker="TEST"
      onSelectTicker={() => undefined}
    />,
  );
}

function renderValueLine(
  sectorModelType: string,
  overrides: Partial<ValueLineData> = {},
) {
  const financialModel =
    overrides.financialModel ?? resolveFinancialModel(sectorModelType);
  const annuals = overrides.annuals ?? metricAnnuals();
  const profile = buildValueLineMetricProfile(financialModel!, annuals, {
    cashConversionRatio: 1.4,
    currencySymbol: "$",
  });
  const data = {
    financialModel,
    sectorModelType,
    market: "us",
    ticker: "TEST",
    canonicalName: "Test Company",
    href: "/company/test",
    pricePoints: [{ date: "2025-01-01", close: 100 }],
    valueLinePoints: [{ date: "2025-01-01", value: 80 }],
    availableSecurities: [],
    cashConversionRatio: 2,
    metric2Title: profile.operatingMetric?.title ?? "",
    metric2Badge: profile.operatingMetric?.badge ?? "",
    metric2BadgeClass: profile.operatingMetric?.badgeClass ?? "",
    metric2MainNum: profile.operatingMetric?.value ?? "",
    metric2SubText: profile.operatingMetric?.subText ?? "",
    metric2Applicable: profile.operatingMetric != null,
    growthMetrics: profile.growthMetrics,
    ...overrides,
  } as unknown as ValueLineData;

  return renderToStaticMarkup(<ValueLineBody data={data} />);
}

describe("ValueLineBody", () => {
  it("does not plot a generic P/E value line or industrial cash conversion for banks", () => {
    const markup = renderValueLine("banks");

    expect(markup).toContain("市净率与 ROE");
    expect(markup).not.toContain("尚未接入");
    expect(markup).not.toContain("价值参考线:");
    expect(markup).not.toContain("2x");
  });

  it("labels property valuation anchor without showing generic P/E corridor", () => {
    const markup = renderValueLine("real_estate");

    expect(markup).toContain("资产净值与 FFO");
    expect(markup).not.toContain("尚未接入");
    expect(markup).not.toContain("价值参考线:");
  });

  it("omits Net Income CAGR and Free Cash Flow CAGR for REITs", () => {
    const markup = renderValueLine("real_estate", {
      financialModel: {
        ...resolveFinancialModel("real_estate")!,
        subModel: "reit_property",
        subModelLabel: "持有型 REITs",
      },
    });

    expect(markup).toContain("营收增长");
    expect(markup).toContain("投资物业增长");
    expect(markup).toContain("每股已实施分红增长");
    expect(markup).toContain("物业资产组合扩张");
    expect(markup).toContain("股东权益增长");
    expect(markup).not.toContain("净利润增长");
    expect(markup).not.toContain("自由现金流增长");
    expect(markup).not.toContain("数据未接入");
    expect(markup).not.toContain("专项指标未接入");
  });

  it("uses reported AUM instead of a missing industrial cash-conversion placeholder", () => {
    const markup = renderValueLine("capital_markets", {
      metric2Applicable: true,
      metric2Title: "管理资产规模",
      metric2Badge: "FY2025",
      metric2MainNum: "$12.0万亿",
      metric2SubText: "期末客户管理资产",
    });

    expect(markup).toContain("管理资产规模");
    expect(markup).toContain("$12.0万亿");
    expect(markup).toContain("期末客户管理资产");
    expect(markup).not.toContain("专项指标未接入");
    expect(markup).not.toContain("AUM、净流入");
  });

  it("keeps the operating metric slot with an unavailable value when data is absent", () => {
    const markup = renderValueLine("capital_markets", { annuals: [] });

    expect(markup).toContain("5年净利率");
    expect(markup).not.toContain("专项指标未接入");
    expect(markup).not.toContain("尚未接入");
    expect((markup.match(/class="vl-triad-box"/g) ?? []).length).toBe(8);
  });

  it.each([
    "industrial",
    "banks",
    "insurance",
    "capital_markets",
    "real_estate",
    "conglomerate",
  ])("keeps both four-card perspective rows for sparse %s data", (sector) => {
    const markup = renderValueLine(sector, { annuals: [{ year: 2024 }] });
    const cardCount = (markup.match(/class="vl-triad-box"/g) ?? []).length;

    expect(cardCount).toBe(8);
    expect(markup).toContain("经营质量 · 资本配置 · 财务安全");
    expect(markup).toContain("长期增长");
  });

  it.each([
    ["industrial", undefined],
    ["banks", undefined],
    ["insurance", "property_casualty"],
    ["capital_markets", "asset_mgmt"],
    ["real_estate", "developer"],
    ["real_estate", "reit_property"],
    ["conglomerate", undefined],
  ] as const)("renders eight metric cards for %s / %s with complete data", (sector, subModel) => {
    const financialModel = {
      ...resolveFinancialModel(sector)!,
      ...(subModel ? { subModel } : {}),
    };
    const markup = renderValueLine(sector, { financialModel });
    const cardCount = (markup.match(/class="vl-triad-box"/g) ?? []).length;

    expect(cardCount).toBe(8);
  });
});

describe("ValueLineHeader", () => {
  it("hides generic P/E and legacy valuation status for non-P/E anchors", () => {
    const markup = renderHeader("banks");

    expect(markup).toContain("PB");
    expect(markup).not.toContain(">PE</span>");
    expect(markup).not.toContain("合理估值中枢");
    expect(markup).toContain("行业特定估值通道");
  });

  it("keeps P/E and its valuation status for P/E-primary models", () => {
    const markup = renderHeader("industrial");

    expect(markup).toContain(">PE</span>");
    expect(markup).toContain("18x");
    expect(markup).toContain("合理估值中枢");
  });
});
