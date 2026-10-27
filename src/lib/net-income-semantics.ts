type NumericLineItem = string | number | null | undefined;

function toNumber(value: NumericLineItem): number | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function unitsMatch(
  itemUnits:
    | Record<string, string | null | undefined>
    | null
    | undefined,
  ...keys: string[]
) {
  if (!itemUnits) return true;
  const units = keys
    .map((key) => itemUnits[key])
    .filter((unit): unit is string => Boolean(unit));
  return new Set(units).size <= 1;
}

export function resolveNetIncomeTotal(
  items: Record<string, NumericLineItem>,
  itemUnits?: Record<string, string | null | undefined> | null,
): number | null {
  const direct = toNumber(items.NetIncomeTotal);
  if (direct != null) return direct;

  const parent = toNumber(items.NetIncome);
  const minority = toNumber(items.MinorityInterestIncome);
  if (
    parent == null ||
    minority == null ||
    !unitsMatch(itemUnits, "NetIncome", "MinorityInterestIncome")
  ) {
    return null;
  }
  return parent + minority;
}

export function resolveNetIncomeCommon(
  items: Record<string, NumericLineItem>,
  itemUnits?: Record<string, string | null | undefined> | null,
): number | null {
  const direct = toNumber(items.NetIncomeCommon);
  const parent = toNumber(items.NetIncome);
  if (direct != null) {
    const sameUnit = unitsMatch(itemUnits, "NetIncome", "NetIncomeCommon");
    if (
      !sameUnit ||
      parent == null ||
      direct <= parent + Math.max(1, Math.abs(parent) * 1e-6)
    ) {
      return direct;
    }
  }

  const preferredDividends = toNumber(items.PreferredDividends);
  if (
    parent == null ||
    preferredDividends == null ||
    !unitsMatch(itemUnits, "NetIncome", "PreferredDividends")
  ) {
    return null;
  }
  return parent - Math.abs(preferredDividends);
}
