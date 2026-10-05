import { describe, expect, it } from "vitest";
import {
  buildCompanyFinancialDashboard,
  type FinancialYearItems,
} from "@/lib/company-financial-dashboard";
import { buildFinancialDashboardText } from "../scripts/lib/company-generation";

function financialYear(year: number, items: Record<string, string>): FinancialYearItems {
  return {
    year,
    periodEnd: new Date(`${year}-12-31T00:00:00.000Z`),
    items,
  };
}

const generalFinancials = [
  financialYear(2025, {
    Revenue: "1200",
    GrossProfit: "600",
    OperatingIncome: "240",
    NetIncome: "180",
    TotalAssets: "1500",
    TotalLiabilities: "600",
    ShareholdersEquity: "900",
    OperatingCashFlow: "210",
  }),
  financialYear(2024, {
    Revenue: "1000",
    GrossProfit: "480",
    OperatingIncome: "180",
    NetIncome: "140",
    TotalAssets: "1300",
    TotalLiabilities: "520",
    ShareholdersEquity: "780",
    OperatingCashFlow: "170",
  }),
  financialYear(2022, {
    Revenue: "800",
    GrossProfit: "360",
    OperatingIncome: "120",
    NetIncome: "90",
    TotalAssets: "1100",
    TotalLiabilities: "440",
    ShareholdersEquity: "660",
    OperatingCashFlow: "130",
  }),
];

const professionalFinancials = [
  financialYear(2025, {
    Revenue: "1200",
    GrossProfit: "600",
    OperatingIncome: "240",
    NetIncome: "180",
    TotalAssets: "1500",
    TotalLiabilities: "600",
    ShareholdersEquity: "900",
    OperatingCashFlow: "210",
    CapEx: "-30",
    EPSDiluted: "3",
  }),
  financialYear(2024, {
    Revenue: "1000",
    GrossProfit: "450",
    OperatingIncome: "180",
    NetIncome: "150",
    TotalAssets: "1200",
    TotalLiabilities: "500",
    ShareholdersEquity: "700",
    OperatingCashFlow: "170",
    CapEx: "20",
    EPSDiluted: "2.5",
  }),
];

describe("buildCompanyFinancialDashboard", () => {
  it("builds operating-company trend evidence without duplicating capital allocation", () => {
    const dashboard = buildCompanyFinancialDashboard(
      { sector: "Technology", metadata: { industry: "Software" }, sectorModelType: "software_platform" },
      [
        ...generalFinancials,
        financialYear(2023, { Revenue: "700", NetIncome: "80", OperatingCashFlow: "100", CapEx: "20" }),
        financialYear(2021, { Revenue: "600", NetIncome: "65", OperatingCashFlow: "80", CapEx: "15" }),
        financialYear(2020, { Revenue: "500", NetIncome: "50", OperatingCashFlow: "60", CapEx: "10" }),
      ],
    );

    expect(dashboard.template).toBe("operating");
    expect(dashboard.displayYears).toEqual([2025, 2024, 2023, 2022, 2021]);
    expect(dashboard.trendYears).toEqual([2020, 2021, 2022, 2023, 2024, 2025]);
    expect(dashboard.trends.map((trend) => trend.key)).toContain("FCFMargin");
    expect(dashboard.rows.some((row) => row.key === "ShareRepurchaseAmt")).toBe(false);
  });

  it("excludes financial years before the shared 2020 start year", () => {
    const dashboard = buildCompanyFinancialDashboard(
      { sector: "Technology", metadata: { industry: "Software" }, sectorModelType: "software_platform" },
      [
        financialYear(2021, { Revenue: "120", NetIncome: "12" }),
        financialYear(2020, { Revenue: "100", NetIncome: "10" }),
        financialYear(2019, { Revenue: "80", NetIncome: "8" }),
      ],
    );

    expect(dashboard.displayYears).toEqual([2021, 2020]);
    expect(dashboard.trendYears).toEqual([2020, 2021]);
    expect(dashboard.rows.find((row) => row.key === "RevenueGrowth")?.values[2020]).toBe("—");
  });

  it("uses bank-specific metrics instead of industrial cash conversion and leverage", () => {
    const dashboard = buildCompanyFinancialDashboard(
      { sector: "Financials", metadata: { industry: "Commercial Bank" }, sectorModelType: "banks" },
      generalFinancials,
    );

    expect(dashboard.template).toBe("bank");
    expect(dashboard.rows.map((row) => row.key)).toContain("ROA");
    expect(dashboard.rows.map((row) => row.key)).toContain("TotalLiabilities");
    expect(dashboard.rows.map((row) => row.key)).toContain("EquityToAssets");
    expect(dashboard.rows.map((row) => row.key)).not.toContain("LiabilitiesToAssets");
    expect(dashboard.rows.map((row) => row.key)).not.toContain("CashConversion");
    expect(dashboard.templateNote).toContain("客户存款");
    expect(dashboard.templateNote).toContain("净息差");
  });

  it("maps all dedicated industry models to their financial-analysis templates", () => {
    const cases = [
      ["insurance", "insurance"],
      ["capital_markets", "capital_markets"],
      ["real_estate", "real_estate"],
      ["conglomerate", "conglomerate"],
    ] as const;

    for (const [sectorModelType, template] of cases) {
      const dashboard = buildCompanyFinancialDashboard(
        { sector: "Financials", metadata: {}, sectorModelType },
        professionalFinancials,
      );

      expect(dashboard.template).toBe(template);
      if (sectorModelType === "real_estate") {
        expect(dashboard.rows.map((row) => row.key)).not.toContain("ROE");
        expect(dashboard.rows.map((row) => row.key)).toContain("FCFMargin");
        expect(dashboard.rows.map((row) => row.key)).not.toContain("CashConversion");
        expect(dashboard.templateNote).toContain("FFO/AFFO");
      }
      if (sectorModelType === "insurance") {
        expect(dashboard.templateNote).toContain("综合成本率");
      }
      if (sectorModelType === "capital_markets") {
        expect(dashboard.rows.map((row) => row.key)).toContain("RevenueGrowth");
        expect(dashboard.templateNote).toContain("AUM");
      }
      if (sectorModelType === "conglomerate") {
        expect(dashboard.templateNote).toContain("业务分部");
      }
      if (sectorModelType === "capital_markets" || sectorModelType === "conglomerate") {
        expect(dashboard.rows.map((row) => row.key)).toContain("CashConversion");
      }
    }
  });

  it("uses the legacy classifier when the explicit sector model is unavailable", () => {
    const dashboard = buildCompanyFinancialDashboard(
      { sector: "Financials", metadata: { industry: "Real Estate" } },
      generalFinancials,
    );

    expect(dashboard.template).toBe("real_estate");
  });

  it("treats persisted legacy types as missing and uses industry metadata", () => {
    const bankDashboard = buildCompanyFinancialDashboard(
      {
        sector: "Financials",
        metadata: { industry: "Commercial Bank" },
        sectorModelType: "unsupported" as never,
      },
      generalFinancials,
    );
    const realEstateDashboard = buildCompanyFinancialDashboard(
      {
        sector: "Financials",
        metadata: { industry: "Real Estate" },
        sectorModelType: "also-unsupported" as never,
      },
      generalFinancials,
    );

    expect(bankDashboard.template).toBe("bank");
    expect(realEstateDashboard.template).toBe("real_estate");
  });

  it("uses up to ten actual years for trends and five for the detail table", () => {
    const dashboard = buildCompanyFinancialDashboard(
      { sector: "Technology", metadata: {}, sectorModelType: "industrial" },
      [
        ...generalFinancials,
        financialYear(2023, { Revenue: "700" }),
        financialYear(2021, { Revenue: "600" }),
        financialYear(2020, { Revenue: "500" }),
      ],
    );

    expect(dashboard.displayYears).toEqual([2025, 2024, 2023, 2022, 2021]);
    expect(dashboard.trendYears).toEqual([2020, 2021, 2022, 2023, 2024, 2025]);
    expect(dashboard.rows.some((row) => row.key === "OperatingCashFlow")).toBe(true);
  });

  it("does not estimate ROE without the prior-year equity balance", () => {
    const dashboard = buildCompanyFinancialDashboard(
      { sector: "Technology", metadata: {}, sectorModelType: "industrial" },
      [financialYear(2025, { NetIncome: "180", ShareholdersEquity: "900" })],
    );

    expect(dashboard.rows.some((row) => row.key === "ROE")).toBe(false);
  });

  it("uses average equity for annual ROE", () => {
    const dashboard = buildCompanyFinancialDashboard(
      { sector: "Technology", metadata: {}, sectorModelType: "industrial" },
      generalFinancials,
    );
    const roe = dashboard.rows.find((row) => row.key === "ROE");

    expect(roe?.values[2025]).toBe("21.4%");
  });

  it("calculates operating-quality metrics from comparable annual inputs", () => {
    const dashboard = buildCompanyFinancialDashboard(
      { sector: "Technology", metadata: {}, sectorModelType: "industrial" },
      professionalFinancials,
    );
    const rowValue = (key: string) => dashboard.rows.find((row) => row.key === key)?.values[2025];

    expect(rowValue("RevenueGrowth")).toBe("20.0%");
    expect(rowValue("NetIncomeGrowth")).toBe("20.0%");
    expect(rowValue("FCFMargin")).toBe("15.0%");
    expect(rowValue("CapExToRevenue")).toBe("2.5%");
    expect(rowValue("AssetTurnover")).toBe("0.89x");
  });

  it("uses book equity rather than liabilities as the financial-sector balance-sheet ratio", () => {
    const dashboard = buildCompanyFinancialDashboard(
      { sector: "Financials", metadata: {}, sectorModelType: "banks" },
      professionalFinancials,
    );
    const equityToAssets = dashboard.rows.find((row) => row.key === "EquityToAssets");
    const assetGrowth = dashboard.rows.find((row) => row.key === "AssetGrowth");

    expect(equityToAssets?.values[2025]).toBe("60.0%");
    expect(assetGrowth?.values[2025]).toBe("25.0%");
    expect(dashboard.rows.some((row) => row.key === "LiabilitiesToAssets")).toBe(false);
  });

  it("does not calculate growth across a missing or non-positive prior-year value", () => {
    const dashboard = buildCompanyFinancialDashboard(
      { sector: "Technology", metadata: {}, sectorModelType: "industrial" },
      [
        financialYear(2025, { Revenue: "1200", NetIncome: "80" }),
        financialYear(2023, { Revenue: "1000", NetIncome: "-20" }),
      ],
    );

    expect(dashboard.rows.some((row) => row.key === "RevenueGrowth")).toBe(false);
    expect(dashboard.rows.some((row) => row.key === "NetIncomeGrowth")).toBe(false);
  });

  it("does not calculate margins from zero or negative revenue", () => {
    const dashboard = buildCompanyFinancialDashboard(
      { sector: "Technology", metadata: {}, sectorModelType: "industrial" },
      [financialYear(2025, {
        Revenue: "-100",
        GrossProfit: "-50",
        OperatingIncome: "-30",
        NetIncome: "-20",
        OperatingCashFlow: "30",
        CapEx: "10",
      })],
    );
    const rowKeys = dashboard.rows.map((row) => row.key);

    expect(rowKeys).not.toContain("GrossMargin");
    expect(rowKeys).not.toContain("OperatingMargin");
    expect(rowKeys).not.toContain("NetMargin");
    expect(rowKeys).not.toContain("FCFMargin");
    expect(rowKeys).not.toContain("CapExToRevenue");
  });

  it("does not treat missing CapEx as zero when calculating free cash flow", () => {
    const dashboard = buildCompanyFinancialDashboard(
      { sector: "Technology", metadata: {}, sectorModelType: "industrial" },
      [financialYear(2025, { Revenue: "500", OperatingCashFlow: "210" })],
    );

    const rowKeys = dashboard.rows.map((row) => row.key);
    expect(rowKeys).not.toContain("FreeCashFlow");
    expect(rowKeys).not.toContain("FCFMargin");
    expect(rowKeys).not.toContain("CapExToRevenue");
  });

  it("returns no trend series or detail rows when no annual financials exist", () => {
    const dashboard = buildCompanyFinancialDashboard(
      { sector: "Technology", metadata: {}, sectorModelType: "industrial" },
      [],
    );

    expect(dashboard.latestYear).toBeNull();
    expect(dashboard.trends).toEqual([]);
    expect(dashboard.rows).toEqual([]);
  });
});

describe("buildFinancialDashboardText", () => {
  it("formats key metric lines from latest financial year", () => {
    const text = buildFinancialDashboardText({
      sector: "Technology",
      metadata: null,
      financials: [
        {
          year: 2025,
          items: {
            Revenue: "1000000000",
            NetIncome: "200000000",
            OperatingIncome: "250000000",
          },
        },
      ],
    });

    expect(text.latestYear).toBe(2025);
    expect(text.cardLines).toContain("营收:");
    expect(text.cardLines).toContain("净利润:");
  });

  it("handles empty financials gracefully without throwing", () => {
    const text = buildFinancialDashboardText({
      sector: "Technology",
      metadata: null,
      financials: [],
    });

    expect(text.latestYear).toBeNull();
    expect(text.cardLines).toBe("—");
  });
});
