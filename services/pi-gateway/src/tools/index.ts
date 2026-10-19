import { searchWisdomTool } from "./search-wisdom.js";
import { createSearchHoldingsTool } from "./search-holdings.js";
import { searchFilingsTool } from "./search-filings.js";
import { getInsightContentTool } from "./get-insight-content.js";
import { getCompanyOverviewTool } from "./get-company-overview.js";
import { getCompanyBusinessModelTool } from "./get-company-business-model.js";
import { getCompanyMoatTool } from "./get-company-moat.js";
import { getStockPriceHistoryTool } from "./get-stock-price-history.js";
import { getCompanyFinancialsTool } from "./get-company-financials.js";
import { getCompanyCapitalAllocationTool } from "./get-company-capital-allocation.js";
import { getCompanyValuationTool } from "./get-company-valuation.js";
import { webSearchTool } from "./web-search.js";
import { fetchWebPageTool } from "./fetch-web-page.js";

export const STATIC_GATEWAY_TOOLS = [
  searchWisdomTool,
  searchFilingsTool,
  getInsightContentTool,
  getCompanyOverviewTool,
  getCompanyBusinessModelTool,
  getCompanyMoatTool,
  getStockPriceHistoryTool,
  getCompanyFinancialsTool,
  getCompanyCapitalAllocationTool,
  getCompanyValuationTool,
  webSearchTool,
  fetchWebPageTool,
] as const;

/** search_holdings reads the live Filer roster when the session is created,
 *  so the complete tool set is built asynchronously per session. */
export async function buildGatewayTools() {
  const searchHoldingsTool = await createSearchHoldingsTool();
  return [searchHoldingsTool, ...STATIC_GATEWAY_TOOLS];
}
