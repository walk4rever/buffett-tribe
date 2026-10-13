import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CapitalAllocationView } from "@/components/CapitalAllocationView";
import type { ValueLineData } from "@/lib/value-line-data";

function renderCapitalAllocation(
  sectorModelType: string,
  useDerivedShares = false,
) {
  const data = {
    sectorModelType,
    tradingCurrency: "USD",
    annuals: [
      {
        year: 2022,
        operatingCashFlow: null,
        capEx: null,
        repurchaseAmt: null,
        dividendsPaid: 50,
        shares: 1020,
        sharesSource: useDerivedShares ? "derived" : "disclosed_period_end",
        roe: 10,
      },
      {
        year: 2023,
        operatingCashFlow: null,
        capEx: null,
        repurchaseAmt: 100,
        dividendsPaid: null,
        shares: 1000,
        sharesSource: useDerivedShares ? "derived" : "disclosed_period_end",
        roe: 12,
      },
      {
        year: 2024,
        operatingCashFlow: null,
        capEx: null,
        repurchaseAmt: 0,
        dividendsPaid: 70,
        shares: 980,
        sharesSource: useDerivedShares ? "derived" : "disclosed_period_end",
        roe: 14,
      },
    ],
  } as unknown as ValueLineData;

  return renderToStaticMarkup(<CapitalAllocationView data={data} />);
}

describe("CapitalAllocationView", () => {
  it("shows insurance shareholder-return measures and their disclosure coverage", () => {
    const markup = renderCapitalAllocation("insurance");

    expect(markup).toContain("资本配置与股东回报");
    expect(markup.match(/披露 2\/3 年/g)).toHaveLength(2);
    expect(markup).toContain("区间平均 ROE");
    expect(markup).toContain("偿付能力充足率");
    expect(markup).not.toContain("资本开支 / 经营现金流");
    expect(markup).not.toContain("经营现金流 (OCF)");
  });

  it("retains the industrial cash-flow view for operating companies", () => {
    const markup = renderCapitalAllocation("industrial");

    expect(markup).toContain("资本配置与现金流");
    expect(markup).toContain("资本开支 / 经营现金流");
    expect(markup).toContain("经营现金流 (OCF)");
    expect(markup).not.toContain("偿付能力充足率");
  });

  it("shows derived share values without marking them as estimates or missing", () => {
    const markup = renderCapitalAllocation("insurance", true);

    expect(markup).toContain("股数与回购金额");
    expect(markup).toContain("区间股数变化");
    expect(markup).toContain("-3.9%");
    expect(markup).not.toContain("推算");
    expect(markup).not.toContain("期末披露股数不足");
  });

  it("provides touch-friendly year selection for the share chart", () => {
    const markup = renderCapitalAllocation("insurance");

    expect(markup).toContain('aria-label="选择图表财年"');
    expect(markup).toContain('aria-label="查看 FY2022 数据"');
    expect(markup).toContain('aria-label="查看 FY2024 数据"');
  });
});
