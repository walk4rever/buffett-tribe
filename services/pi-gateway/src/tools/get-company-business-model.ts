import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { getCompanyAnalysisSection } from "./company-analysis-shared.js";

export const getCompanyBusinessModelTool = defineTool({
  name: "get_company_business_model",
  label: "Get Company Business Model",
  description:
    "Fetch Value Tribe's generated business model canvas: customers, value proposition, channels, revenue streams, cost structure, key resources, and the nine canvas sections. Use this for questions about how a company makes money or how its business is structured. It is qualitative research content, not raw financial statements or valuation metrics.",
  promptSnippet: "get_company_business_model(company) → nine-section business model canvas",
  parameters: Type.Object({
    company: Type.String({
      description: "Company ticker or name (e.g. AAPL, 9992.HK, 600519.SS, 苹果, 泡泡玛特)",
    }),
  }),
  async execute(_id, params, signal) {
    const result = await getCompanyAnalysisSection(params.company, "canvas", signal);
    return {
      content: [{ type: "text" as const, text: result.text }],
      details: result.details,
    };
  },
});
