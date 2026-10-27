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

export function resolveInvestmentGains(
  items: Record<string, NumericLineItem>,
  itemUnits?: Record<string, string | null | undefined> | null,
): number | null {
  const investmentIncome = toNumber(items.InvestmentIncome);
  const fairValueChange = toNumber(items.FairValueChangeIncome);
  const netInvestmentIncome = toNumber(items.NetInvestmentIncome);

  if (
    netInvestmentIncome != null &&
    unitsMatch(
      itemUnits,
      "NetInvestmentIncome",
      "InvestmentIncome",
      "FairValueChangeIncome",
    )
  ) {
    return netInvestmentIncome;
  }

  if (
    investmentIncome != null &&
    fairValueChange != null &&
    unitsMatch(
      itemUnits,
      "InvestmentIncome",
      "FairValueChangeIncome",
    )
  ) {
    return investmentIncome + fairValueChange;
  }
  return investmentIncome ?? fairValueChange;
}

export function resolveOperatingRevenue(
  items: Record<string, NumericLineItem>,
  itemUnits?: Record<string, string | null | undefined> | null,
): number | null {
  const direct = toNumber(items.OperatingRevenue);
  if (direct != null) return direct;

  const revenue = toNumber(items.Revenue);
  if (revenue == null) return null;
  const investmentGains = resolveInvestmentGains(items, itemUnits) ?? 0;
  return revenue - investmentGains;
}
