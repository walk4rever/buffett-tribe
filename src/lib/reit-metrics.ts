export function calculateNoi(
  propertyRevenue: number | null,
  propertyOperatingExpenses: number | null,
): number | null {
  if (propertyRevenue == null || propertyOperatingExpenses == null) {
    return null;
  }
  if (propertyRevenue <= 0) return null;
  return propertyRevenue - propertyOperatingExpenses;
}

export function calculateOccupancy(
  leasedArea: number | null,
  availableArea: number | null,
): number | null {
  if (leasedArea == null || availableArea == null || availableArea <= 0) {
    return null;
  }
  if (leasedArea < 0 || leasedArea > availableArea) return null;
  return leasedArea / availableArea;
}

export function calculateSameStoreNoiGrowth(
  currentNoi: number | null,
  previousNoi: number | null,
): number | null {
  if (currentNoi == null || previousNoi == null || previousNoi <= 0) {
    return null;
  }
  return currentNoi / previousNoi - 1;
}

export function calculateAffo(
  ffo: number | null,
  recurringCapex: number | null,
  otherAdjustments: number | null = 0,
): number | null {
  if (ffo == null || recurringCapex == null || otherAdjustments == null) {
    return null;
  }
  return ffo - recurringCapex + otherAdjustments;
}

export function calculateFfoPerShare(
  ffo: number | null,
  dilutedSharesAndUnits: number | null,
): number | null {
  if (
    ffo == null ||
    dilutedSharesAndUnits == null ||
    dilutedSharesAndUnits <= 0
  ) {
    return null;
  }
  return ffo / dilutedSharesAndUnits;
}
