/**
 * Unified Onboarding Exclusion Taxonomy and Evaluation
 *
 * Distinguishes genuine operating companies from instruments and entities
 * that cannot or should not undergo standard company onboarding:
 * 1. Financial instruments (ETFs, index funds, trusts, crypto trusts, warrants, options)
 * 2. Over-The-Counter (OTC) / Pink Sheets (foreign ADRs ending in Y, foreign ordinaries ending in F, grey/pink markets)
 * 3. Lifecycle-terminated entities (bankruptcy Q-suffix, acquired, merged, delisted)
 * 4. SPAC investment units (U-suffix)
 * 5. Stubs with no financial filings or SEC CIK facts
 *
 * Excluded entities are assigned `onboardPhase = -1` in Entity table and
 * tagged with metadata `{ isExcluded: true, exclusionReason, exclusionLabel, excludedAt }`.
 */
import { isNonCompanySecurityKind } from "./security-kind";

export const EXCLUSION_REASONS = [
  "etf",
  "fund_trust",
  "derivative",
  "otc_pink_sheet",
  "delisted",
  "acquired",
  "spac_unit",
  "no_financial_facts",
] as const;

export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

export const EXCLUSION_LABELS: Record<ExclusionReason, string> = {
  etf: "ETF / 交易型开放式指数基金",
  fund_trust: "基金 / 投资信托 / 加密凭证",
  derivative: "衍生品（期权 / 权证 / 可转债）",
  otc_pink_sheet: "美股场外粉单 / 柜台 ADR / 外资普通股",
  delisted: "已退市 / 破产重组粉单",
  acquired: "已被收购 / 私有化",
  spac_unit: "SPAC 投资单元",
  no_financial_facts: "无有效财务事实底座",
};

export interface ExclusionCandidate {
  ticker?: string | null;
  canonicalName?: string | null;
  market?: string | null;
  code?: string | null;
  exchange?: string | null;
  onboardPhase?: number | null;
  metadata?: Record<string, unknown> | null;
  securities?: Array<{
    kind?: string | null;
    titleOfClass?: string | null;
    ticker?: string | null;
    exchange?: string | null;
  }> | null;
}

export interface ExclusionEvaluation {
  isExcluded: boolean;
  reason?: ExclusionReason;
  label?: string;
}

/**
 * Returns true if an entity has already been marked as excluded in DB.
 */
export function isExcludedEntity(entity: {
  onboardPhase?: number | null;
  metadata?: Record<string, unknown> | null;
}): boolean {
  if (entity.onboardPhase === -1) return true;
  const meta = entity.metadata;
  if (meta && typeof meta === "object" && (meta as Record<string, unknown>).isExcluded === true) {
    return true;
  }
  return false;
}

/**
 * Evaluates whether a company candidate should be excluded from standard onboarding.
 */
export function evaluateOnboardExclusion(input: ExclusionCandidate): ExclusionEvaluation {
  const meta = (input.metadata ?? {}) as Record<string, unknown>;
  const ticker = (input.ticker ?? input.code ?? "").trim().toUpperCase();
  const canonicalName = (input.canonicalName ?? "").trim().toUpperCase();
  const market = (input.market ?? "").trim().toLowerCase();
  const exchange = (input.exchange ?? (meta.exchange as string) ?? "").trim().toUpperCase();

  // 1. Explicitly recorded historical exclusions in metadata
  if (meta.isExcluded === true && typeof meta.exclusionReason === "string") {
    const reason = meta.exclusionReason as ExclusionReason;
    if (EXCLUSION_REASONS.includes(reason)) {
      return {
        isExcluded: true,
        reason,
        label: (meta.exclusionLabel as string) || EXCLUSION_LABELS[reason],
      };
    }
  }

  // 2. Acquired / merged / taken private
  if (meta.unmatchedReason === "acquired" || meta.acquired === true) {
    return { isExcluded: true, reason: "acquired", label: EXCLUSION_LABELS.acquired };
  }

  // 3. Explicitly marked delisted
  if (meta.unmatchedReason === "delisted" || meta.delisted === true) {
    return { isExcluded: true, reason: "delisted", label: EXCLUSION_LABELS.delisted };
  }

  // 4. No financial facts / permanent stub
  if (meta.unmatchedReason === "no_financial_facts") {
    return { isExcluded: true, reason: "no_financial_facts", label: EXCLUSION_LABELS.no_financial_facts };
  }

  // 5. Securities-level inspection (ETF / Fund / Warrant / Option / Convertible)
  if (input.securities && input.securities.length > 0) {
    const allNonCompany = input.securities.every((s) => isNonCompanySecurityKind(s.kind));
    if (allNonCompany) {
      const firstKind = input.securities[0]?.kind;
      if (firstKind === "etf") {
        return { isExcluded: true, reason: "etf", label: EXCLUSION_LABELS.etf };
      }
      if (firstKind === "fund_trust") {
        return { isExcluded: true, reason: "fund_trust", label: EXCLUSION_LABELS.fund_trust };
      }
      if (firstKind === "right_warrant" || firstKind === "option" || firstKind === "convertible_bond") {
        return { isExcluded: true, reason: "derivative", label: EXCLUSION_LABELS.derivative };
      }
      return { isExcluded: true, reason: "fund_trust", label: EXCLUSION_LABELS.fund_trust };
    }
  }

  // 6. Ticker or name explicit ETF / Index
  if (meta.unmatchedReason === "etf" || /\bETF\b/i.test(canonicalName)) {
    return { isExcluded: true, reason: "etf", label: EXCLUSION_LABELS.etf };
  }

  // 7. OTC pink sheet checks (for US market or OTC exchange)
  const isOtcExchange =
    exchange === "OTC" ||
    exchange === "OTCMKTS" ||
    exchange === "PINK" ||
    exchange === "GREY" ||
    exchange === "OVER-THE-COUNTER";

  if (isOtcExchange) {
    return { isExcluded: true, reason: "otc_pink_sheet", label: EXCLUSION_LABELS.otc_pink_sheet };
  }

  // 8. US market 5-letter ticker symbology rules (FINRA standard 5th letter)
  if (market === "us" || (!market && ticker.length === 5)) {
    // 5 letters ending with Q -> Bankruptcy / chapter 11 delisted pink sheet (e.g. SONDQ, FTCHQ, STRYQ)
    if (ticker.length === 5 && ticker.endsWith("Q")) {
      return { isExcluded: true, reason: "delisted", label: EXCLUSION_LABELS.delisted };
    }

    // 5 letters ending with Y or F -> OTC ADR or foreign ordinary (e.g. TCEHY, BYDDF, EDPFY, MTNOY)
    if (ticker.length === 5 && (ticker.endsWith("Y") || ticker.endsWith("F"))) {
      return { isExcluded: true, reason: "otc_pink_sheet", label: EXCLUSION_LABELS.otc_pink_sheet };
    }

    // 5 letters ending with U -> SPAC unit (e.g. CPARU, AGCUU, RSVAU)
    if (ticker.length === 5 && ticker.endsWith("U")) {
      return { isExcluded: true, reason: "spac_unit", label: EXCLUSION_LABELS.spac_unit };
    }
  }

  return { isExcluded: false };
}
