import { resolveNetIncomeCommon } from "@/lib/net-income-semantics";

export function calculateFreeCashFlow(
  operatingCashFlow: number | null,
  capEx: number | null,
): number | null {
  if (operatingCashFlow == null || capEx == null) return null;
  return operatingCashFlow - Math.abs(capEx);
}

export function calculateReturnOnAverageBalance(
  income: number | null,
  openingBalance: number | null,
  closingBalance: number | null,
): number | null {
  if (income == null || openingBalance == null || closingBalance == null) return null;
  const averageBalance = (openingBalance + closingBalance) / 2;
  if (averageBalance <= 0) return null;
  return income / averageBalance;
}

export interface AnnualSharesAndEps {
  year: number;
  shares: number | null;
  eps: number | null;
  netIncome?: number | null;
}

export const SPLIT_FACTOR_CANDIDATES = [
  1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20, 25, 30, 50, 100,
  1 / 2, 1 / 3, 1 / 4, 1 / 5, 1 / 6, 1 / 7, 1 / 8, 1 / 10, 1 / 12, 1 / 15, 1 / 20, 1 / 25, 1 / 30, 1 / 50, 1 / 100,
];

/**
 * Detects if a forward or reverse stock split occurred between two consecutive fiscal periods.
 * When companies split shares (e.g. NVDA 10:1 in 2024), SEC 10-K filings only retrospectively
 * restate the 3 most recent fiscal years. Filings older than 3 years remain pre-split in EDGAR,
 * causing synthetic 10x share jumps and -90% EPS drops unless normalized.
 */
export function detectSplitFactor(
  currShares: number,
  nextShares: number,
  currEps?: number | null,
  nextEps?: number | null,
): number | null {
  if (!currShares || !nextShares || currShares <= 0 || nextShares <= 0) return null;
  const ratio = nextShares / currShares;
  // Natural non-split share variance (typically under ±25% within a single year)
  if (ratio >= 0.78 && ratio <= 1.28) return null;

  let bestCandidate: number | null = null;
  let minError = Infinity;

  for (const c of SPLIT_FACTOR_CANDIDATES) {
    const err = Math.abs(ratio - c) / c;
    if (err < 0.14 && err < minError) {
      bestCandidate = c;
      minError = err;
    }
  }

  if (bestCandidate != null) {
    // If EPS is available, check that EPS direction is consistent with split
    if (currEps != null && nextEps != null && currEps !== 0 && nextEps !== 0) {
      const epsRatio = currEps / nextEps;
      // In forward split (c > 1.4), currEps should generally be higher than nextEps (or not > 3x lower)
      if (bestCandidate > 1.4 && epsRatio < 0.3) {
        return null;
      }
      // In reverse split (c < 0.7), currEps should generally be lower than nextEps (or not > 3x higher)
      if (bestCandidate < 0.7 && epsRatio > 3.0) {
        return null;
      }
    }
    return bestCandidate;
  }
  return null;
}

/**
 * Two-stage stock split normalizer for financial years:
 * Stage 1: Cross-year income statement retrospective normalization (WeightedShares & EPS).
 * Stage 2: Intra-year balance sheet period-end shares alignment with Post-Split anchors.
 */
export function normalizeFinancialYearsStockSplits<
  T extends {
    year: number;
    items: Record<string, string>;
    itemUnits?: Record<string, string>;
  },
>(
  years: T[],
  options: { allowHeuristic?: boolean } = {},
): T[] {
  if (years.length < 2) return years;
  // Production history may only be rewritten from confirmed corporate actions.
  // The share/EPS heuristic is useful for diagnostics and tests, but it cannot
  // distinguish a split from a large stock issuance or stock-for-stock merger.
  // Keep it opt-in so a missing event table cannot silently rewrite the series.
  if (options.allowHeuristic !== true) return years;

  // Clone years so we don't mutate input in place
  const res = years.map((y) => ({
    ...y,
    items: { ...y.items },
  }));

  // Sort ascending by year for time-series analysis
  const sortedIndices = res
    .map((item, idx) => ({ year: item.year, idx }))
    .sort((a, b) => a.year - b.year);

  const parseNum = (items: Record<string, string>, key: string): number | null => {
    const v = items[key];
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const getRefWeightedShares = (
    items: Record<string, string>,
    itemUnits?: Record<string, string>,
  ): number | null => {
    const diluted = parseNum(items, "WeightedAverageSharesDiluted");
    if (diluted != null && diluted > 0) return diluted;
    const basic = parseNum(items, "WeightedAverageShares");
    if (basic != null && basic > 0) return basic;

    // Fallback: common net income / EPS, with matching units required.
    const net = resolveNetIncomeCommon(items, itemUnits);
    const eps = parseNum(items, "EPSDiluted") ?? parseNum(items, "EPSBasic");
    if (net != null && eps != null && net !== 0 && eps !== 0 && (net > 0 === eps > 0)) {
      const netUnit = itemUnits?.NetIncomeCommon?.toUpperCase();
      const epsUnit = (itemUnits?.EPSDiluted ?? itemUnits?.EPSBasic)?.toUpperCase();
      if (!netUnit || !epsUnit || netUnit === epsUnit || epsUnit.includes(netUnit)) {
        const implied = Math.abs(net / eps);
        if (Number.isFinite(implied) && implied > 0) return Math.round(implied);
      }
    }
    return null;
  };

  const confirmedSplitFactors = new Set<number>();

  const timeline = sortedIndices.map(({ idx }) => {
    const item = res[idx];
    return {
      idx,
      year: item.year,
      refShares: getRefWeightedShares(item.items, item.itemUnits),
      eps: parseNum(item.items, "EPSDiluted") ?? parseNum(item.items, "EPSBasic"),
      netIncome: parseNum(item.items, "NetIncome"),
    };
  });

  // Stage 1: Income statement cross-year retrospective split detection (going backwards)
  for (let i = timeline.length - 2; i >= 0; i--) {
    const curr = timeline[i];
    const next = timeline[i + 1];

    if (curr.refShares && next.refShares) {
      const factor = detectSplitFactor(
        curr.refShares,
        next.refShares,
        curr.eps,
        next.eps,
      );

      if (factor != null && factor !== 1) {
        confirmedSplitFactors.add(factor);
        // Apply factor to all historical years <= i
        for (let j = 0; j <= i; j++) {
          const target = res[timeline[j].idx];

          for (const key of ["WeightedAverageSharesDiluted", "WeightedAverageShares"] as const) {
            const v = parseNum(target.items, key);
            if (v != null) {
              target.items[key] = String(Math.round(v * factor));
            }
          }

          for (const key of ["EPSDiluted", "EPSBasic", "DividendPerShare"] as const) {
            const v = parseNum(target.items, key);
            if (v != null) {
              target.items[key] = String(Number((v / factor).toFixed(4)));
            }
          }

          if (timeline[j].refShares != null) {
            timeline[j].refShares = Math.round(timeline[j].refShares! * factor);
          }
          if (timeline[j].eps != null) {
            timeline[j].eps = Number((timeline[j].eps! / factor).toFixed(4));
          }
        }
      }
    }
  }

  // Generate cumulative confirmed factors (e.g., if 10 is confirmed in Stage 1 and an older year
  // also had a prior 4x intra-year BS tear, 4 * 10 = 40 is valid)
  const allValidFactors = new Set<number>(confirmedSplitFactors);
  const integerSplitFactors = [2, 3, 4, 5, 6, 7, 8, 10, 15, 20];
  for (const f of confirmedSplitFactors) {
    for (const c of integerSplitFactors) {
      allValidFactors.add(f * c);
    }
  }

  // Stage 2: Balance Sheet Period-End Shares (CommonStockSharesOutstanding) Intra-Year Alignment
  // Iterate backwards from latest year so adjacent-year fallback can reference already-normalized k+1 shares
  for (let k = timeline.length - 1; k >= 0; k--) {
    const { idx } = timeline[k];
    const target = res[idx];
    const periodEndShares = parseNum(target.items, "CommonStockSharesOutstanding");
    if (periodEndShares == null || periodEndShares <= 0) continue;

    const anchorShares = timeline[k].refShares ?? getRefWeightedShares(target.items, target.itemUnits);

    let comparisonShares: number | null = anchorShares;
    if ((comparisonShares == null || comparisonShares <= 0) && k < timeline.length - 1) {
      // Fallback when no weighted-share/EPS anchor exists: compare against next chronological year's period-end shares
      const nextTarget = res[timeline[k + 1].idx];
      comparisonShares = parseNum(nextTarget.items, "CommonStockSharesOutstanding");
    }

    if (comparisonShares != null && comparisonShares > 0) {
      const ratio = comparisonShares / periodEndShares;
      if (ratio >= 0.82 && ratio <= 1.22) {
        continue;
      }

      let matchedFactor: number | null = null;
      let minErr = Infinity;

      for (const f of allValidFactors) {
        const err = Math.abs(ratio - f) / f;
        if (err < 0.16 && err < minErr) {
          matchedFactor = f;
          minErr = err;
        }
      }

      // If no confirmed factor matched, allow factor >= 2.0 or reverse <= 0.5
      // (Strict financial guard: DO NOT match 1.5x here to protect real 20-30% share issuances/M&A)
      if (matchedFactor == null) {
        for (const candidate of SPLIT_FACTOR_CANDIDATES) {
          if (candidate >= 2.0 || candidate <= 0.5) {
            const err = Math.abs(ratio - candidate) / candidate;
            if (err < 0.14 && err < minErr) {
              matchedFactor = candidate;
              minErr = err;
            }
          }
        }
      }

      if (matchedFactor != null && matchedFactor !== 1) {
        target.items["CommonStockSharesOutstanding"] = String(Math.round(periodEndShares * matchedFactor));
        // If we fell back to adjacent-year comparison (no Stage 1 anchor), also normalize EPS/DPS for this year if present
        if (anchorShares == null) {
          for (const key of ["EPSDiluted", "EPSBasic", "DividendPerShare"] as const) {
            const v = parseNum(target.items, key);
            if (v != null) {
              target.items[key] = String(Number((v / matchedFactor).toFixed(4)));
            }
          }
        }
      }
    }
  }

  return res;
}

/**
 * Normalizes an array of annual records (sorted ascending by year)
 * backwards from the latest year so that all historical shares and EPS
 * are represented on the latest split basis.
 *
 * This is a diagnostic/research helper. Callers must explicitly opt in with
 * `allowHeuristic: true`; production history is never rewritten by default.
 */
export function normalizeAnnualsStockSplits<T extends AnnualSharesAndEps>(
  annuals: T[],
  options: { allowHeuristic?: boolean } = {},
): T[] {
  if (annuals.length < 2) return annuals;
  if (options.allowHeuristic !== true) return annuals;

  const res = annuals.map((a) => ({ ...a }));

  for (let i = res.length - 2; i >= 0; i--) {
    const curr = res[i];
    const next = res[i + 1];
    if (curr.shares && next.shares) {
      const factor = detectSplitFactor(curr.shares, next.shares, curr.eps, next.eps);
      if (factor != null && factor !== 1) {
        for (let j = 0; j <= i; j++) {
          if (res[j].shares != null) {
            res[j].shares = Math.round(res[j].shares! * factor);
          }
          if (res[j].eps != null) {
            res[j].eps = Number((res[j].eps! / factor).toFixed(4));
          }
        }
      }
    }
  }

  return res;
}

export function calculateInvestedCapital(params: {
  totalEquity: number | null;
  totalDebt?: number | null;
  shortTermDebt?: number | null;
  longTermDebt?: number | null;
  cashAndEquivalents?: number | null;
}): number | null {
  if (params.totalEquity == null || params.cashAndEquivalents == null) return null;

  let debt: number;
  if (params.totalDebt != null) {
    debt = params.totalDebt;
  } else if (params.shortTermDebt != null && params.longTermDebt != null) {
    debt = params.shortTermDebt + params.longTermDebt;
  } else {
    // Missing debt information: return null rather than assuming zero debt
    return null;
  }

  const ic = params.totalEquity + debt - params.cashAndEquivalents;
  return ic;
}

export function calculateROIC(params: {
  operatingIncome: number | null;
  effectiveTaxRate?: number | null;
  currentInvestedCapital: number | null;
  previousInvestedCapital?: number | null;
}): number | null {
  if (params.operatingIncome == null || params.currentInvestedCapital == null) return null;

  // Protect against negative or near-zero invested capital (e.g. extreme buybacks or distressed balance sheets)
  if (params.currentInvestedCapital <= 0) return null;

  let averageIC = params.currentInvestedCapital;
  if (params.previousInvestedCapital != null) {
    if (params.previousInvestedCapital <= 0) return null;
    averageIC = (params.previousInvestedCapital + params.currentInvestedCapital) / 2;
    if (averageIC <= 0) return null;
  }

  // Tax rate normalization: if effective tax rate is outside [0, 0.50], fallback to standard 21%
  let t = params.effectiveTaxRate;
  if (t == null || t < 0 || t > 0.5) {
    t = 0.21;
  }

  const nopat = params.operatingIncome * (1 - t);
  return nopat / averageIC;
}
