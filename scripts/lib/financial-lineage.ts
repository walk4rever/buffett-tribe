export type FinancialLineage = "pipeline" | "fixture" | "unverified";

const FIXTURE_RULE_RE =
  /^(?:fixture:|bank-report:|insurance-report:|reit-report:)/i;
const AUTOMATED_RULE_RE =
  /^(?:sec-xbrl:|akshare:|yfinance:|derived:|annual-report-extractor:|cn-reit-annual-report:|hk-annual-report:)/i;
const PROVIDER_SOURCE_KINDS = new Set(["akshare", "yfinance"]);

/**
 * Classify how a Financial row entered the database.
 *
 * `pipeline` means an onboarding/provider extractor produced the row.
 * `fixture` means a human-curated fact file produced it and must not be
 * counted as production coverage. `unverified` means the source exists, but
 * the row does not carry enough evidence to prove which extractor wrote it.
 */
export function classifyFinancialLineage(input: {
  sourceKind: string | null;
  mappingRule: string | null;
}): FinancialLineage {
  const mappingRule = input.mappingRule?.trim() ?? "";
  if (FIXTURE_RULE_RE.test(mappingRule)) return "fixture";
  if (PROVIDER_SOURCE_KINDS.has(input.sourceKind ?? "")) return "pipeline";
  if (AUTOMATED_RULE_RE.test(mappingRule)) return "pipeline";
  return "unverified";
}

export function combineFinancialLineage(
  lineages: FinancialLineage[],
): FinancialLineage {
  if (lineages.includes("fixture")) return "fixture";
  if (lineages.includes("unverified")) return "unverified";
  return "pipeline";
}
