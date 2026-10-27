export function calculateNim(
  netInterestIncome: number | null,
  averageEarningAssets: number | null,
): number | null {
  if (
    netInterestIncome == null ||
    averageEarningAssets == null ||
    averageEarningAssets <= 0
  ) {
    return null;
  }
  return netInterestIncome / averageEarningAssets;
}

export function calculateNplRatio(
  nonPerformingLoans: number | null,
  grossLoans: number | null,
): number | null {
  if (grossLoans == null || grossLoans <= 0) return null;
  if (nonPerformingLoans == null || nonPerformingLoans < 0) return null;
  return nonPerformingLoans / grossLoans;
}

export function calculateProvisionCoverage(
  loanLossAllowance: number | null,
  nonPerformingLoans: number | null,
): number | null {
  if (loanLossAllowance == null || nonPerformingLoans == null) return null;
  if (loanLossAllowance < 0 || nonPerformingLoans <= 0) return null;
  return loanLossAllowance / nonPerformingLoans;
}
