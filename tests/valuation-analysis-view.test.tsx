import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ValuationAnalysisView } from "@/components/ValuationAnalysisView";
import type { ValueLineData } from "@/lib/value-line-data";
import { resolveFinancialModel } from "@/lib/financial-model";

function renderValuationAnalysis(sectorModelType?: string) {
  const data = {
    sectorModelType,
    financialModel: resolveFinancialModel(sectorModelType ?? "industrial"),
    tradingCurrency: "USD",
    reportingCurrency: "USD",
    latestPrice: 100,
    latestPriceDate: "2025-01-01",
    pricePoints: [{ close: 100 }],
    peRatio: 16,
    benchmarkPe: 15,
    valuationCurrencyAvailable: true,
    valuationAnnuals: [
      { year: 2023, eps: 5, freeCashFlow: 20 },
      { year: 2024, eps: 6, freeCashFlow: 24 },
    ],
    historicalPePoints: [
      { date: "2023-01-01", close: 80, eps: 5 },
      { date: "2024-01-01", close: 100, eps: 6 },
    ],
    marketCap: 1000,
    pbRatio: 2,
    cashConversionRatio: 1.1,
    roeAvg5Y: 14,
    roeStability: "solid",
  } as unknown as ValueLineData;

  return renderToStaticMarkup(<ValuationAnalysisView data={data} />);
}

describe("ValuationAnalysisView", () => {
  it("provides accessible year controls for the historical valuation chart", () => {
    const markup = renderValuationAnalysis();

    expect(markup).toContain('aria-label="选择估值图表年份"');
    expect(markup).toContain('aria-label="查看 FY2023 数据"');
    expect(markup).toContain('aria-label="查看 FY2024 数据"');
  });

  it("keeps industrial cash-flow multiples out of financial-sector valuation", () => {
    const markup = renderValuationAnalysis("insurance");

    expect(markup).toContain("行业特定估值通道");
    expect(markup).toContain("保险业核心聚焦内含价值变动");
    expect(markup).toContain("市净率 P/B");
    expect(markup).toContain("平均 ROE");
    expect(markup).not.toContain("FCF Yield");
    expect(markup).not.toContain("OCF / 净利润");
  });

  it("keeps scenario controls in a collapsed secondary section", () => {
    const markup = renderValuationAnalysis();

    expect(markup).toContain('<details class="val-sim-block">');
    expect(markup).toContain("5年情景测算");
    expect(markup).not.toContain('<details class="val-sim-block" open="">');
  });

  it("uses the bank valuation anchor instead of presenting P/E as the primary model", () => {
    const markup = renderValuationAnalysis("banks");

    expect(markup).toContain("市净率与 ROE");
    expect(markup).toContain("银行业核心聚焦信贷资产质量");
    expect(markup).toContain("市净率 P/B");
    expect(markup).not.toContain("当前 P/E");
    expect(markup).not.toContain("历史 P/E 参考带");
    expect(markup).not.toContain("5年情景测算");
    expect(markup).not.toContain("FCF Yield");
  });

  it("does not substitute P/E for unavailable insurance or property valuation models", () => {
    const insuranceMarkup = renderValuationAnalysis("insurance");
    const propertyMarkup = renderValuationAnalysis("real_estate");

    expect(insuranceMarkup).toContain("内含价值与市净率");
    expect(insuranceMarkup).not.toContain("当前 P/E");
    expect(propertyMarkup).toContain("资产净值与 FFO");
    expect(propertyMarkup).not.toContain("当前 P/E");
    expect(propertyMarkup).not.toContain("历史 P/E 参考带");
  });

  it("does not append a missing-input warning to the financial-services P/E model", () => {
    const markup = renderValuationAnalysis("capital_markets");

    expect(markup).toContain("当前 P/E");
    expect(markup).not.toMatch(/手续费收入、AUM 与净流入尚未接入|仅作参考/);
    expect(markup).not.toContain("FCF Yield");
  });
});
