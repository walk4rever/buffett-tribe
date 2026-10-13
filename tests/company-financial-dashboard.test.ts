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

    expect(dashboard.template).toBe("industrial");
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
      ["capital_markets", "financial_services"],
      ["real_estate", "industrial"],
      ["conglomerate", "conglomerate"],
    ] as const;

    for (const [sectorModelType, template] of cases) {
      const dashboard = buildCompanyFinancialDashboard(
        { sector: "Financials", metadata: {}, sectorModelType },
        professionalFinancials,
      );

      expect(dashboard.template).toBe(template);
      if (sectorModelType === "real_estate") {
        expect(dashboard.financialModel.modifiers).toEqual(["real_estate"]);
        expect(dashboard.rows.map((row) => row.key)).not.toContain("ROE");
        expect(dashboard.rows.map((row) => row.key)).not.toContain("FCFMargin");
        expect(dashboard.rows.map((row) => row.key)).not.toContain("CashConversion");
        expect(dashboard.templateNote).toContain("FFO/AFFO");
      }
      if (sectorModelType === "insurance") {
        expect(dashboard.templateNote).toContain("综合成本率");
      }
      if (sectorModelType === "capital_markets") {
        expect(dashboard.rows.map((row) => row.key)).toContain("RevenueGrowth");
        expect(dashboard.rows.map((row) => row.key)).not.toContain("CashConversion");
        expect(dashboard.rows.map((row) => row.key)).not.toContain("FCFMargin");
        expect(dashboard.templateNote).not.toContain("未接入");
      }
      if (sectorModelType === "conglomerate") {
        expect(dashboard.templateNote).toContain("业务分部");
        expect(dashboard.rows.map((row) => row.key)).toContain("CashConversion");
      }
    }
  });

  it("shows financial-services operating metrics when annual reports provide them", () => {
    const dashboard = buildCompanyFinancialDashboard(
      { sector: "Financials", metadata: {}, sectorModelType: "capital_markets" },
      [
        financialYear(2025, {
          Revenue: "50000000000",
          NetIncome: "8000000000",
          TotalAssets: "100000000000",
          TotalLiabilities: "70000000000",
          ShareholdersEquity: "30000000000",
          AssetsUnderManagement: "12000000000000",
          NetClientFlows: "750000000000",
          InvestmentManagementFeeIncome: "18000000000",
          NetFeeAndCommissionIncome: "4500000000",
        }),
        financialYear(2024, {
          Revenue: "45000000000",
          NetIncome: "7000000000",
          TotalAssets: "90000000000",
          TotalLiabilities: "62000000000",
          ShareholdersEquity: "28000000000",
          AssetsUnderManagement: "10000000000000",
          NetClientFlows: "500000000000",
          InvestmentManagementFeeIncome: "16000000000",
          NetFeeAndCommissionIncome: "4000000000",
        }),
      ],
    );

    const rowKeys = dashboard.rows.map((row) => row.key);
    const trendKeys = dashboard.trends.map((trend) => trend.key);

    expect(rowKeys).toEqual(
      expect.arrayContaining([
        "AssetsUnderManagement",
        "NetClientFlows",
        "InvestmentManagementFeeIncome",
        "NetFeeAndCommissionIncome",
      ]),
    );
    expect(trendKeys).toEqual(
      expect.arrayContaining([
        "AssetsUnderManagement",
        "NetClientFlows",
        "InvestmentManagementFeeIncome",
        "NetFeeAndCommissionIncome",
      ]),
    );
    expect(dashboard.templateNote).not.toMatch(/AUM|净流入|手续费|未接入/);
  });

  it("normalizes financial-services metrics using each row's reporting currency", () => {
    const dashboard = buildCompanyFinancialDashboard(
      { sector: "Financials", metadata: {}, sectorModelType: "capital_markets" },
      [
        {
          ...financialYear(2025, {
            Revenue: "1000000000",
            AssetsUnderManagement: "1000000000000",
            NetClientFlows: "20000000000",
            InvestmentManagementFeeIncome: "5000000000",
            NetFeeAndCommissionIncome: "3000000000",
          }),
          itemUnits: {
            Revenue: "EUR",
            AssetsUnderManagement: "EUR",
            NetClientFlows: "EUR",
            InvestmentManagementFeeIncome: "EUR",
            NetFeeAndCommissionIncome: "EUR",
          },
        },
      ],
      "USD",
      {
        reportingCurrency: "EUR",
        tradingCurrency: "USD",
        fxRates: new Map([["EUR", 1.1], ["USD", 1]]),
      },
    );

    const latestValue = (key: string) =>
      dashboard.trends.find((trend) => trend.key === key)?.latestPoint?.value;

    expect(latestValue("AssetsUnderManagement")).toBeCloseTo(1_100_000_000_000);
    expect(latestValue("NetClientFlows")).toBeCloseTo(22_000_000_000);
    expect(latestValue("InvestmentManagementFeeIncome")).toBeCloseTo(5_500_000_000);
    expect(latestValue("NetFeeAndCommissionIncome")).toBeCloseTo(3_300_000_000);
  });

  it("uses the legacy classifier when the explicit sector model is unavailable", () => {
    const dashboard = buildCompanyFinancialDashboard(
      { sector: "Financials", metadata: { industry: "Real Estate" } },
      generalFinancials,
    );

    expect(dashboard.template).toBe("industrial");
    expect(dashboard.financialModel.modifiers).toEqual(["real_estate"]);
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
    expect(realEstateDashboard.template).toBe("industrial");
    expect(realEstateDashboard.financialModel.modifiers).toEqual(["real_estate"]);
  });

  it("maps all 13 persisted industries into exactly five analysis templates", () => {
    const expectedTemplates = {
      consumer_brand: "industrial",
      healthcare: "industrial",
      software_platform: "industrial",
      semiconductor_hardware: "industrial",
      industrial: "industrial",
      banks: "bank",
      insurance: "insurance",
      capital_markets: "financial_services",
      real_estate: "industrial",
      energy_materials: "industrial",
      utilities: "industrial",
      telecommunications: "industrial",
      conglomerate: "conglomerate",
    } as const;

    for (const [sectorModelType, template] of Object.entries(expectedTemplates)) {
      const dashboard = buildCompanyFinancialDashboard(
        {
          sector: "Financials",
          metadata: {},
          sectorModelType: sectorModelType as keyof typeof expectedTemplates,
        },
        professionalFinancials,
      );
      expect(dashboard.template).toBe(template);
    }
  });

  it("shows insurance premiums, claims and claims ratio when those inputs exist", () => {
    const dashboard = buildCompanyFinancialDashboard(
      { sector: "Financials", metadata: {}, sectorModelType: "insurance" },
      [
        financialYear(2025, {
          NetPremiumsEarned: "1000000000",
          PolicyClaimsAndBenefits: "-650000000",
          NetIncome: "120",
          TotalAssets: "2000",
          ShareholdersEquity: "300",
        }),
        financialYear(2024, {
          NetPremiumsEarned: "800000000",
          PolicyClaimsAndBenefits: "-600000000",
          NetIncome: "100",
          TotalAssets: "1800",
          ShareholdersEquity: "280",
        }),
      ],
    );

    expect(dashboard.template).toBe("insurance");
    expect(dashboard.rows.find((row) => row.key === "NetPremiumsEarned")?.values[2025]).toMatch(/10\.0亿/);
    expect(dashboard.rows.find((row) => row.key === "ClaimsRatio")?.values[2025]).toBe("65.0%");
    expect(dashboard.trends.map((trend) => trend.key)).toContain("ClaimsRatio");
    expect(dashboard.templateNote).toContain("赔付率");
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

  it("normalizes row currencies before calculating long-term financial trends", () => {
    const dashboard = buildCompanyFinancialDashboard(
      { sector: "Technology", metadata: {}, sectorModelType: "industrial" },
      [
        {
          ...financialYear(2025, {
            Revenue: "100000000",
            NetIncome: "20000000",
            ShareholdersEquity: "200000000",
            OperatingCashFlow: "140000000",
            CapEx: "-32000000",
          }),
          itemUnits: {
            Revenue: "CNY",
            NetIncome: "CNY",
            ShareholdersEquity: "CNY",
            OperatingCashFlow: "CNY",
            CapEx: "TWD",
          },
        },
        {
          ...financialYear(2024, {
            Revenue: "50000000",
            NetIncome: "10000000",
            ShareholdersEquity: "100000000",
          }),
          itemUnits: {
            Revenue: "CNY",
            NetIncome: "CNY",
            ShareholdersEquity: "CNY",
          },
        },
      ],
      "HKD",
      {
        reportingCurrency: "CNY",
        tradingCurrency: "HKD",
        fxRates: new Map([
          ["CNY", 0.14],
          ["TWD", 0.07],
          ["HKD", 0.07],
        ]),
      },
    );

    const valueAt = (key: string, year: number) =>
      dashboard.rows.find((row) => row.key === key)?.values[year];
    expect(valueAt("Revenue", 2025)).toMatch(/2\.00亿/);
    expect(valueAt("RevenueGrowth", 2025)).toBe("100.0%");
    expect(valueAt("ROE", 2025)).toBe("13.3%");
    expect(valueAt("FreeCashFlow", 2025)).toMatch(/2\.48亿/);
  });

  it("keeps mixed-currency metrics missing when a row unit is absent", () => {
    const dashboard = buildCompanyFinancialDashboard(
      { sector: "Technology", metadata: {}, sectorModelType: "industrial" },
      [
        {
          ...financialYear(2025, { Revenue: "100", NetIncome: "20" }),
          itemUnits: { NetIncome: "TWD" },
        },
      ],
      "HKD",
      {
        reportingCurrency: "CNY",
        tradingCurrency: "HKD",
        fxRates: new Map([["CNY", 0.14], ["TWD", 0.07], ["HKD", 0.07]]),
      },
    );

    expect(dashboard.rows.find((row) => row.key === "Revenue")).toBeUndefined();
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
