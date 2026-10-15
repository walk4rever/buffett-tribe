import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CompanyFinancialDashboardComponent } from "@/components/CompanyFinancialDashboard";
import type { CompanyFinancialDashboard } from "@/lib/company-financial-dashboard";
import { resolveFinancialModel } from "@/lib/financial-model";

function renderDashboard(sectorModelType: string) {
  const financialModel = resolveFinancialModel(sectorModelType)!;
  const dashboard = {
    template: financialModel.template,
    financialModel,
    templateNote: "",
    latestYear: 2024,
    displayYears: [2024],
    trendYears: [2020, 2024],
    currency: "USD",
    rows: [],
    trends: [],
  } as unknown as CompanyFinancialDashboard;

  return renderToStaticMarkup(
    <CompanyFinancialDashboardComponent dashboard={dashboard} financials={[]} />,
  );
}

describe("CompanyFinancialDashboardComponent", () => {
  it("shows the same base template and modifier labels as the shared model", () => {
    const industrialMarkup = renderDashboard("industrial");
    const energyMarkup = renderDashboard("energy_materials");
    const propertyMarkup = renderDashboard("real_estate");

    expect(industrialMarkup).toContain("工商业");
    expect(energyMarkup).toContain("工商业");
    expect(energyMarkup).toContain("能源与材料周期");
    expect(propertyMarkup).toContain("房地产与 REITs");
  });
});
