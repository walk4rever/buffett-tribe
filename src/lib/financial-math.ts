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

const SPLIT_FACTOR_CANDIDATES = [
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
  currNet?: number | null,
  nextNet?: number | null,
): number | null {
  if (!currShares || !nextShares || currShares <= 0 || nextShares <= 0) return null;
  const ratio = nextShares / currShares;
  // Natural non-split share variance (typically under ±25% within a single year)
  if (ratio >= 0.78 && ratio <= 1.28) return null;

  for (const c of SPLIT_FACTOR_CANDIDATES) {
    if (Math.abs(ratio - c) / c < 0.14) {
      // If EPS & Net are available and positive, verify that EPS drop corresponds to the split
      if (currEps && nextEps && currNet && nextNet && currEps > 0 && nextEps > 0 && currNet > 0 && nextNet > 0) {
        const expectedNextEps = currEps * (nextNet / currNet);
        const epsRatio = expectedNextEps / nextEps;
        if (Math.abs(epsRatio - c) / c > 0.20) {
          // EPS does not confirm split (e.g. M&A share issuance)
          continue;
        }
      }
      return c;
    }
  }
  return null;
}

/**
 * Normalizes an array of annual records (sorted ascending by year)
 * backwards from the latest year so that all historical shares and EPS
 * are represented on the latest split basis.
 */
export function normalizeAnnualsStockSplits<T extends AnnualSharesAndEps>(annuals: T[]): T[] {
  if (annuals.length < 2) return annuals;

  const res = annuals.map((a) => ({ ...a }));

  for (let i = res.length - 2; i >= 0; i--) {
    const curr = res[i];
    const next = res[i + 1];
    if (curr.shares && next.shares) {
      const factor = detectSplitFactor(curr.shares, next.shares, curr.eps, next.eps, curr.netIncome, next.netIncome);
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

