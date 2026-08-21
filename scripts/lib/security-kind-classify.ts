/**
 * security-kind-classify.ts
 *
 * Classifies a 13F info-table row's instrument type from `titleOfClass` (and
 * `putCall`, for option lines) into a coarse taxonomy. This distinguishes
 * "real operating company equity" (common stock, ADRs, foreign ordinary
 * shares) from instruments whose issuer is never eligible for a company page
 * (ETFs, fund/trust units, rights/warrants, convertible debt, options) — see
 * PRODUCT.md 数据资产清单 for why this exists: 13F filers report every
 * §13(f) security they hold, not just operating companies, and the import
 * pipeline previously stamped every one of them as Entity.type='company'.
 *
 * Deliberately keyword-based, not LLM-based: titleOfClass is a fairly
 * standardized SEC vocabulary, and issuer-name keyword matching (e.g. "TRUST"
 * in the name) would misclassify real operating companies like Northern
 * Trust Corp — so classification here uses titleOfClass/putCall only, never
 * the issuer name. Ambiguous/unrecognized values fall back to "unclassified"
 * rather than guessing — see backfill-security-kind.ts for the manual-review
 * export of that bucket.
 */

export const SECURITY_KINDS = [
  "equity",
  "etf",
  "fund_trust",
  "right_warrant",
  "convertible_bond",
  "option",
  "unclassified",
] as const;

export type SecurityKind = (typeof SECURITY_KINDS)[number];

export type EquitySubtype = "adr" | "foreign_ordinary";

export interface SecurityKindClassification {
  kind: SecurityKind;
  subtype?: EquitySubtype;
}

const DATE_PATTERN = /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/;
const ADR_PATTERN = /\bADR\b|\bADS\b/;
const FOREIGN_ORDINARY_PATTERN = /\bORD\b|\bORDINARY\b/;
const EQUITY_HINT_PATTERN = /\bCOM\b|\bSHS\b|\bCL[. ]|\bCLASS\b|\bSTOCK\b|\bCOMMON\b/;

export function classifySecurityKind(input: {
  titleOfClass?: string | null;
  putCall?: string | null;
}): SecurityKindClassification {
  const putCall = (input.putCall ?? "").trim().toUpperCase();
  if (putCall === "PUT" || putCall === "CALL") {
    return { kind: "option" };
  }

  const title = (input.titleOfClass ?? "").trim().toUpperCase();
  if (!title) return { kind: "unclassified" };

  // A trailing expiration date is a distinctive marker for rights/warrants —
  // no other 13F titleOfClass value carries one, so check it before any
  // broader keyword match.
  if (DATE_PATTERN.test(title)) return { kind: "right_warrant" };
  if (/\bWARRANT\b/.test(title) || /^RIGHT\b/.test(title)) return { kind: "right_warrant" };

  if (/\bETF\b/.test(title)) return { kind: "etf" };
  if (/\bCONV\b/.test(title)) return { kind: "convertible_bond" };
  // NOTE: "SH BEN INT" ("shares of beneficial interest") is deliberately NOT
  // treated as fund_trust. It's the standard titleOfClass for REITs legally
  // organized as a business trust rather than a corporation (e.g. Vornado
  // Realty Trust) — real operating companies, not fund units. Since the same
  // wording is used by both, it's left unclassified rather than guessed
  // either way.
  // UNIT-titled instruments (e.g. QQQ's real 13F titleOfClass "UNIT SER 1",
  // or "TR UNIT") are unit investment trust / fund shares, not corporate
  // stock. No equity titleOfClass in observed data contains "UNIT".
  if (/\bUNIT\b/.test(title)) return { kind: "fund_trust" };

  if (ADR_PATTERN.test(title)) return { kind: "equity", subtype: "adr" };
  if (FOREIGN_ORDINARY_PATTERN.test(title)) return { kind: "equity", subtype: "foreign_ordinary" };

  if (EQUITY_HINT_PATTERN.test(title)) return { kind: "equity" };

  return { kind: "unclassified" };
}
