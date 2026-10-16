import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ValueLineBody, ValueLineHeader } from "@/components/ValueLineCard";
import type { ValueLineData } from "@/lib/value-line-data";
import { resolveFinancialModel } from "@/lib/financial-model";

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
  const data = {
    financialModel: resolveFinancialModel(sectorModelType),
    sectorModelType,
    market: "us",
    ticker: "TEST",
    canonicalName: "Test Company",
    href: "/company/test",
    pricePoints: [{ date: "2025-01-01", close: 100 }],
    valueLinePoints: [{ date: "2025-01-01", value: 80 }],
    availableSecurities: [],
    cashConversionRatio: 2,
    metric2Applicable: sectorModelType !== "capital_markets",
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
    expect(markup).toContain("总资产增长");
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

  it("omits the financial-services operating card when no source metric exists", () => {
    const markup = renderValueLine("capital_markets");

    expect(markup).not.toContain("金融服务经营");
    expect(markup).not.toContain("专项指标未接入");
    expect(markup).not.toContain("尚未接入");
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
