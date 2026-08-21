// Display labels for Security.kind (see scripts/lib/security-kind-classify.ts
// for how the value is derived at import time). "equity" and "unclassified"
// render no badge — only kinds we're confident are NOT an operating company
// get flagged, so a holdings row never falsely implies "this isn't a real
// company" on a guess.
const SECURITY_KIND_BADGE_LABELS: Partial<Record<string, string>> = {
  etf: "ETF",
  fund_trust: "基金/信托",
  right_warrant: "权证",
  convertible_bond: "可转债",
  option: "期权",
};

export function getSecurityKindBadgeLabel(kind: string | null | undefined): string | null {
  if (!kind) return null;
  return SECURITY_KIND_BADGE_LABELS[kind] ?? null;
}

// A kind gets a badge (see above) precisely because it's confidently NOT an
// operating company — reuse that same key set as the single source of truth
// for "does this security's issuer deserve a company page/link at all".
export function isNonCompanySecurityKind(kind: string | null | undefined): boolean {
  if (!kind) return false;
  return kind in SECURITY_KIND_BADGE_LABELS;
}
