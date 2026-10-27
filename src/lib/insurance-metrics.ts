export function calculateClaimsRatio(
  claimsAndBenefits: number | null,
  netPremiumsEarned: number | null,
): number | null {
  if (netPremiumsEarned == null || netPremiumsEarned <= 0) return null;
  if (claimsAndBenefits == null) return null;
  return Math.abs(claimsAndBenefits) / netPremiumsEarned;
}

export function calculateCombinedRatio(
  claimsAndBenefits: number | null,
  underwritingExpenses: number | null,
  netPremiumsEarned: number | null,
): number | null {
  if (netPremiumsEarned == null || netPremiumsEarned <= 0) return null;
  if (claimsAndBenefits == null || underwritingExpenses == null) return null;
  return (
    Math.abs(claimsAndBenefits) + Math.abs(underwritingExpenses)
  ) / netPremiumsEarned;
}

export function calculateNewBusinessValueMargin(
  newBusinessValue: number | null,
  presentValueOfNewBusinessPremiums: number | null,
): number | null {
  if (
    newBusinessValue == null ||
    presentValueOfNewBusinessPremiums == null ||
    presentValueOfNewBusinessPremiums <= 0
  ) {
    return null;
  }
  return newBusinessValue / presentValueOfNewBusinessPremiums;
}

export function calculateSolvencyRatio(
  actualCapital: number | null,
  minimumCapital: number | null,
): number | null {
  if (
    actualCapital == null ||
    minimumCapital == null ||
    minimumCapital <= 0 ||
    actualCapital < 0
  ) {
    return null;
  }
  return actualCapital / minimumCapital;
}
