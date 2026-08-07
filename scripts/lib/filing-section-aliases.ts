// Friendly category → one or more exact FilingSection keys (ordered by
// priority), covering the 10-K/20-F/40-F key sets extract-10k-sections.ts
// produces. Single source of truth for "which raw section keys carry this
// kind of content" — used both by the /agent search_filings tool (via the
// synced copy under services/pi-gateway/src/shared/, see
// services/pi-gateway/scripts/sync-shared-lib.sh) and by the batch
// generate-*.ts pipeline's fetchLatestFilingEvidence() gate.
export const SECTION_ALIASES: Record<string, string[]> = {
  business:    ["item_1_business", "item_4_company_information"],
  risk:        ["item_1a_risk_factors", "item_3_key_information"],
  mda:         ["item_7_mda", "item_5_operating_financial_review", "management_discussion_and_analysis"],
  financial:   ["item_8_financial_statements", "item_8_financial_information", "item_17_financial_statements", "item_18_financial_statements_us_gaap"],
  notes:       ["item_8_notes"],
  cybersecurity: ["item_1c_cybersecurity", "item_16k_cybersecurity"],
  compensation: ["item_11_compensation"],
  governance:  ["item_16g_corporate_governance"],
  market_risk: ["item_7a_market_risk", "item_11_market_risk"],
  properties:  ["item_2_properties"],
  legal:       ["item_3_legal"],
  // 20-F-only: "Directors, Senior Management and Employees" has no direct
  // 10-K counterpart in this map (10-K bios usually live in the proxy
  // statement, outside FilingSection entirely) — item_10_directors is the
  // closest 10-K analogue (board/governance structure, not full bios).
  management:  ["item_6_directors_management_employees", "item_10_directors"],
  // 20-F's item_7 bundles major-shareholder disclosure with related-party
  // transactions; item_12_ownership is 10-K's closest analogue.
  ownership:   ["item_7_major_shareholders_related_party", "item_12_ownership"],
};

export function resolveSectionKeys(section: string | null): string[] | null {
  if (!section) return null;
  const alias = section.toLowerCase().trim().replace(/[\s-]/g, "_");
  return SECTION_ALIASES[alias] ?? [alias];
}
