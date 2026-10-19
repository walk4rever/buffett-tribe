import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { getCompanyAnalysisSection } from "./company-analysis-shared.js";

export const getCompanyMoatTool = defineTool({
  name: "get_company_moat",
  label: "Get Company Moat",
  description:
    "Fetch Value Tribe's generated moat analysis: competitive advantage, moat type, strength, durability, dimension scores, supporting evidence, and risks. Use this for questions about why a company can sustain returns or defend its position. It is qualitative research content, not capital allocation or valuation metrics.",
  promptSnippet: "get_company_moat(company) → moat summary, dimension scores, durability, and risks",
  parameters: Type.Object({
    company: Type.String({
      description: "Company ticker or name (e.g. AAPL, 9992.HK, 600519.SS, 苹果, 泡泡玛特)",
    }),
  }),
  async execute(_id, params, signal) {
    const result = await getCompanyAnalysisSection(params.company, "moat", signal);
    return {
      content: [{ type: "text" as const, text: result.text }],
      details: result.details,
    };
  },
});
