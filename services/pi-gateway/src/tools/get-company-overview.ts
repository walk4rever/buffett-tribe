import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { getCompanyAnalysisSection } from "./company-analysis-shared.js";

export const getCompanyOverviewTool = defineTool({
  name: "get_company_overview",
  label: "Get Company Overview",
  description:
    "Fetch Value Tribe's generated company overview: what the company does, its main products or services, revenue mix, and a concise business description. Use this for introductory company questions. It is qualitative research content, not raw financial statements, capital allocation, or valuation metrics.",
  promptSnippet: "get_company_overview(company) → company description, main products, and revenue mix",
  parameters: Type.Object({
    company: Type.String({
      description: "Company ticker or name (e.g. AAPL, 9992.HK, 600519.SS, 苹果, 泡泡玛特)",
    }),
  }),
  async execute(_id, params, signal) {
    const result = await getCompanyAnalysisSection(params.company, "overview", signal);
    return {
      content: [{ type: "text" as const, text: result.text }],
      details: result.details,
    };
  },
});
