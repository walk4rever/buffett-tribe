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

  it("labels the implemented insurance method as P/B and states the missing specialty inputs", () => {
    const markup = renderValuationAnalysis("insurance");

    expect(markup).toContain("当前估值方法");
    expect(markup).toContain("P/B 估值");
    expect(markup).toContain("当前算法：P/B");
    expect(markup).toContain("EV、NBV、新业务价值率和偿付能力已接入适用寿险样本");
    expect(markup).toContain("市净率 P/B");
    expect(markup).toContain("平均 ROE");
    expect(markup).not.toContain("内含价值与市净率");
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

    expect(markup).toContain("P/B 估值");
    expect(markup).toContain("NIM、不良贷款、拨备覆盖率和 CET1");
    expect(markup).toContain("当前算法：P/B");
    expect(markup).toContain("市净率 P/B");
    expect(markup).not.toContain("当前 P/E");
    expect(markup).not.toContain("历史 P/E 参考带");
    expect(markup).not.toContain("5年情景测算");
    expect(markup).not.toContain("FCF Yield");
  });

  it("does not substitute P/E or claim unavailable specialty models are implemented", () => {
    const insuranceMarkup = renderValuationAnalysis("insurance");
    const propertyMarkup = renderValuationAnalysis("real_estate");

    expect(insuranceMarkup).not.toContain("内含价值与市净率");
    expect(insuranceMarkup).toContain("EV、NBV、新业务价值率和偿付能力已接入适用寿险样本");
    expect(insuranceMarkup).not.toContain("当前 P/E");
    expect(propertyMarkup).toContain("当前算法：P/B");
    expect(propertyMarkup).toContain("NOI 和出租率已接入三家代表公司");
    expect(propertyMarkup).toContain("NAV、FFO/AFFO 专业估值模型尚未完成");
    expect(propertyMarkup).not.toContain("资产净值与 FFO");
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
