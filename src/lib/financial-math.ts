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
