import { describe, expect, it } from "vitest";
import {
  buildFinancialsMarkdown,
  formatFinancialNumber,
  normalizeNumericYearsStockSplits,
  resolveFinancialLineItem,
} from "./get-company-financials.js";

describe("resolveFinancialLineItem", () => {
  it("resolves canonical keys directly", () => {
    expect(resolveFinancialLineItem("Revenue")).toBe("Revenue");
    expect(resolveFinancialLineItem("NetIncome")).toBe("NetIncome");
    expect(resolveFinancialLineItem("OperatingCashFlow")).toBe("OperatingCashFlow");
    expect(resolveFinancialLineItem("CapEx")).toBe("CapEx");
    expect(resolveFinancialLineItem("FreeCashFlow")).toBe("FreeCashFlow");
  });

  it("resolves Chinese and English aliases properly", () => {
    expect(resolveFinancialLineItem("研发费用")).toBe("RnDExpense");
    expect(resolveFinancialLineItem("研发支出")).toBe("RnDExpense");
    expect(resolveFinancialLineItem("r&d")).toBe("RnDExpense");
    expect(resolveFinancialLineItem("rnd")).toBe("RnDExpense");
    expect(resolveFinancialLineItem("营业收入")).toBe("Revenue");
    expect(resolveFinancialLineItem("营收")).toBe("Revenue");
    expect(resolveFinancialLineItem("经营现金流")).toBe("OperatingCashFlow");
    expect(resolveFinancialLineItem("自由现金流")).toBe("FreeCashFlow");
    expect(resolveFinancialLineItem("fcf")).toBe("FreeCashFlow");
    expect(resolveFinancialLineItem("sbc")).toBe("ShareBasedCompensation");
    expect(resolveFinancialLineItem("股权激励")).toBe("ShareBasedCompensation");
    expect(resolveFinancialLineItem("真自由现金流")).toBe("FCF_Ex_SBC");
    expect(resolveFinancialLineItem("roe")).toBe("ROE");
    expect(resolveFinancialLineItem("净资产收益率")).toBe("ROE");
    expect(resolveFinancialLineItem("收并购净现金流")).toBe("PurchaseSaleOfBusinessNet");
  });

  it("returns null for unrecognized line item", () => {
    expect(resolveFinancialLineItem("unknown_metric_xyz")).toBeNull();
  });
});

describe("formatFinancialNumber", () => {
  it("formats large money amounts in Yi or Wan", () => {
    expect(formatFinancialNumber(125000000000, "USD")).toBe("1250 亿");
    expect(formatFinancialNumber(3580000000, "USD")).toBe("35.8 亿");
    expect(formatFinancialNumber(-14700000000, "USD")).toBe("-147 亿");
    expect(formatFinancialNumber(500000, "USD")).toBe("50.0 万");
  });

  it("formats percentages for ratio metrics", () => {
    expect(formatFinancialNumber(0.1852, "USD", true)).toBe("18.5%");
    expect(formatFinancialNumber(-0.023, "USD", true)).toBe("-2.3%");
  });

  it("formats shares and per-share figures", () => {
    expect(formatFinancialNumber(10827000000, "shares")).toBe("10.83 亿股");
    expect(formatFinancialNumber(7.17, "USD/share")).toBe("7.17");
  });

  it("handles null and NaN safely", () => {
    expect(formatFinancialNumber(null, "USD")).toBe("—");
    expect(formatFinancialNumber(Number.NaN, "USD")).toBe("—");
  });
});

describe("normalizeNumericYearsStockSplits", () => {
  it("normalizes NVDA two-stage stock splits across FY2020-2025", () => {
    const dataByYear = new Map<number, Record<string, number>>([
      [2020, { WeightedAverageSharesDiluted: 2_472_000_000, CommonStockSharesOutstanding: 612_000_000, EPSDiluted: 1.13 }],
      [2023, { WeightedAverageSharesDiluted: 2_507_000_000, CommonStockSharesOutstanding: 2_466_136_539, EPSDiluted: 1.74 }],
      [2025, { WeightedAverageSharesDiluted: 24_804_000_000, CommonStockSharesOutstanding: 24_477_000_000, EPSDiluted: 2.94 }],
    ]);
    normalizeNumericYearsStockSplits(dataByYear);
    expect(dataByYear.get(2020)?.CommonStockSharesOutstanding).toBe(24_480_000_000);
    expect(dataByYear.get(2023)?.CommonStockSharesOutstanding).toBe(24_661_365_390);
    expect(dataByYear.get(2023)?.EPSDiluted).toBe(0.174);
  });
});

describe("buildFinancialsMarkdown", () => {
  it("renders notice when years are empty and no latestInterim", () => {
    const md = buildFinancialsMarkdown("Amazon (AMZN)", "USD", [], new Map(), ["Revenue"]);
    expect(md).toContain("未找到该公司的历史年度财务报表数据");
  });

  it("generates markdown table with years and optional latestInterim column", () => {
    const dataByYear = new Map<number, Record<string, number>>([
      [
        2024,
        {
          Revenue: 638000000000,
          OperatingCashFlow: 115900000000,
          CapEx: 83000000000,
          FreeCashFlow: 32900000000,
          ShareBasedCompensation: 24000000000,
          FCF_Ex_SBC: 8900000000,
        },
      ],
      [
        2025,
        {
          Revenue: 716900000000,
          OperatingCashFlow: 139500000000,
          CapEx: 131800000000,
          FreeCashFlow: 7700000000,
          ShareBasedCompensation: 26000000000,
          FCF_Ex_SBC: -18300000000,
        },
      ],
    ]);

    const md = buildFinancialsMarkdown(
      "Amazon.com Inc (AMZN)",
      "USD",
      [2024, 2025],
      dataByYear,
      ["Revenue", "OperatingCashFlow", "CapEx", "FreeCashFlow", "ShareBasedCompensation", "FCF_Ex_SBC"],
      {
        label: "2026 Q1 (YTD)",
        items: { Revenue: 180000000000 },
      },
    );

    expect(md).toContain("Amazon.com Inc (AMZN) 历年财务报表数据 (FY2024–2025 + 2026 Q1 (YTD))");
    expect(md).toContain("| 2024 | 2025 | 2026 Q1 (YTD) |");
    expect(md).toContain("营业收入 (Revenue)");
    expect(md).toContain("自由现金流 (FCF)");
    expect(md).toContain("扣除SBC后的真自由现金流");
    expect(md).toContain("6380 亿 | 7169 亿 | 1800 亿");
    expect(md).toContain("329 亿 | 77.0 亿 | —");
  });
});

