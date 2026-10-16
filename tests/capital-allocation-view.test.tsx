import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CapitalAllocationView } from "@/components/CapitalAllocationView";
import type { ValueLineData } from "@/lib/value-line-data";
import { resolveFinancialModel } from "@/lib/financial-model";

function renderCapitalAllocation(
  sectorModelType: string,
  useDerivedShares = false,
  tradingCurrency = "USD",
) {
  const data = {
    sectorModelType,
    financialModel: resolveFinancialModel(sectorModelType),
    tradingCurrency,
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
    expect(markup).not.toContain("尚未接入");
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

  it("shows table units once and omits repeated currency symbols from numeric cells", () => {
    const markup = renderCapitalAllocation("industrial", false, "HKD");
    const tableMarkup = markup.slice(markup.indexOf('class="cap-table-wrap'));

    expect(markup).toContain("金额：亿 HKD · 股数：亿股 · ROE：%");
    expect(tableMarkup).not.toContain("HK$");
    expect(tableMarkup).not.toContain("$");
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

  it("uses the property allocation model without showing industrial cash flows", () => {
    const markup = renderCapitalAllocation("real_estate");

    expect(markup).toContain("资本配置与股东回报");
    expect(markup).not.toContain("尚未接入");
    expect(markup).not.toContain("FFO/AFFO 与 NAV 尚未接入");
    expect(markup).not.toContain("资本开支 / 经营现金流");
    expect(markup).not.toContain("经营现金流 (OCF)");
    expect(markup).not.toContain("偿付能力充足率");
  });

  it("does not show an unrelated operating-metric warning in capital allocation", () => {
    const markup = renderCapitalAllocation("capital_markets");

    expect(markup).toContain("资本配置与股东回报");
    expect(markup).not.toContain("AUM");
    expect(markup).not.toContain("金融服务专项指标未接入");
    expect(markup).not.toContain("经营现金流 (OCF)");
  });

  it("keeps group cash flows while disclosing missing segment allocation data", () => {
    const markup = renderCapitalAllocation("conglomerate");

    expect(markup).toContain("资本配置与现金流");
    expect(markup).toContain("业务分部");
    expect(markup).toContain("经营现金流 (OCF)");
  });

  it("renders financial capital allocation waterfall when cumulative net income is available", () => {
    const data = {
      sectorModelType: "insurance",
      financialModel: resolveFinancialModel("insurance"),
      tradingCurrency: "USD",
      annuals: [
        {
          year: 2023,
          netIncome: 1000,
          operatingCashFlow: null,
          capEx: null,
          repurchaseAmt: 200,
          dividendsPaid: 300,
          shares: 1000,
          roe: 12,
        },
        {
          year: 2024,
          netIncome: 1200,
          operatingCashFlow: null,
          capEx: null,
          repurchaseAmt: 200,
          dividendsPaid: 300,
          shares: 980,
          roe: 14,
        },
      ],
    } as unknown as ValueLineData;

    const markup = renderToStaticMarkup(<CapitalAllocationView data={data} />);
    expect(markup).toContain("金融资本分配去向 (净利润总账)");
    expect(markup).toContain("累计归母净利润");
    expect(markup).toContain("留存扩表 / 充实资本");
    expect(markup).toContain("综合股东回报");
  });
});
