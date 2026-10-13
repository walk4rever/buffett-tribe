import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ValuationAnalysisView } from "@/components/ValuationAnalysisView";
import type { ValueLineData } from "@/lib/value-line-data";

function renderValuationAnalysis(sectorModelType?: string) {
  const data = {
    sectorModelType,
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

    expect(markup).toContain("保险专项偿付能力与内含价值指标尚未接入");
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
});
