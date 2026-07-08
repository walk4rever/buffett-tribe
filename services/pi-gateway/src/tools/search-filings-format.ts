// Pure formatting/matching helpers for search-filings.ts, split out so they can
// be unit tested without pulling in the DB pool (which throws at import time if
// DIRECT_URL isn't set) or any network/R2 dependency.

// Friendly alias → one or more exact section keys (ordered by priority)
export const SECTION_ALIASES: Record<string, string[]> = {
  business:    ["item_1_business", "item_4_company_information"],
  risk:        ["item_1a_risk_factors"],
  mda:         ["item_7_mda", "item_5_operating_financial_review", "management_discussion_and_analysis"],
  financial:   ["item_8_financial_statements", "item_8_financial_information", "item_17_financial_statements", "item_18_financial_statements_us_gaap"],
  notes:       ["item_8_notes"],
  cybersecurity: ["item_1c_cybersecurity", "item_16k_cybersecurity"],
  compensation: ["item_11_compensation"],
  governance:  ["item_16g_corporate_governance"],
  market_risk: ["item_7a_market_risk", "item_11_market_risk"],
  properties:  ["item_2_properties"],
  legal:       ["item_3_legal"],
};

export const MAX_CONTENT_CHARS = 4000;
export const EXCERPT_WINDOW = 1800;

export function resolveSectionKeys(section: string | null): string[] | null {
  if (!section) return null;
  const alias = section.toLowerCase().trim().replace(/[\s-]/g, "_");
  return SECTION_ALIASES[alias] ?? [alias];
}

export function extractExcerpt(content: string, keyword: string | null): string {
  if (!keyword) {
    return content.length <= MAX_CONTENT_CHARS
      ? content
      : content.slice(0, MAX_CONTENT_CHARS) + `\n\n[… 内容已截断，共 ${content.length} 字]`;
  }

  const idx = content.toLowerCase().indexOf(keyword.toLowerCase());
  if (idx === -1) {
    return content.slice(0, MAX_CONTENT_CHARS) + (content.length > MAX_CONTENT_CHARS ? `\n\n[… 未找到关键词"${keyword}"，显示开头内容]` : "");
  }

  const start = Math.max(0, idx - EXCERPT_WINDOW / 2);
  const end = Math.min(content.length, idx + EXCERPT_WINDOW / 2);
  const excerpt = content.slice(start, end);
  const prefix = start > 0 ? "[…] " : "";
  const suffix = end < content.length ? " […]" : "";
  return prefix + excerpt + suffix;
}

export function formatSectionLabel(key: string): string {
  return key
    .replace(/^item_\d+[a-z]?_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
