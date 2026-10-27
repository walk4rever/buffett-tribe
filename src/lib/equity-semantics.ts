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

export function resolveShareholdersCommonEquity(
  items: Record<string, NumericLineItem>,
  itemUnits?: Record<string, string | null | undefined> | null,
): number | null {
  const direct = toNumber(items.ShareholdersCommonEquity);
  const parentEquity = resolveShareholdersEquity(items, itemUnits);
  if (direct != null) {
    if (
      !unitsMatch(
        itemUnits,
        "ShareholdersEquity",
        "ShareholdersCommonEquity",
      ) ||
      parentEquity == null ||
      direct <= parentEquity + Math.max(1, Math.abs(parentEquity) * 1e-6)
    ) {
      return direct;
    }
  }

  const preferredValue = toNumber(items.PreferredStockValue);
  if (
    parentEquity == null ||
    preferredValue == null ||
    !unitsMatch(
      itemUnits,
      "ShareholdersEquity",
      "PreferredStockValue",
    )
  ) {
    return null;
  }
  return parentEquity - Math.abs(preferredValue);
}

export function resolveShareholdersEquity(
  items: Record<string, NumericLineItem>,
  itemUnits?: Record<string, string | null | undefined> | null,
): number | null {
  const direct = toNumber(items.ShareholdersEquity);
  const totalEquity = toNumber(items.TotalEquity);
  const minorityInterest = toNumber(items.MinorityInterest);
  const canDeriveParent =
    totalEquity != null &&
    minorityInterest != null &&
    unitsMatch(
      itemUnits,
      "TotalEquity",
      "MinorityInterest",
    );
  const directLooksLikeTotal =
    direct != null &&
    totalEquity != null &&
    minorityInterest != null &&
    Math.abs(direct - totalEquity) <=
      Math.max(1, Math.abs(totalEquity) * 1e-6);

  if (direct != null && !directLooksLikeTotal) return direct;
  if (canDeriveParent) return totalEquity - minorityInterest;
  return direct;
}

export function resolveTotalEquity(
  items: Record<string, NumericLineItem>,
  itemUnits?: Record<string, string | null | undefined> | null,
): number | null {
  const direct = toNumber(items.TotalEquity);
  if (direct != null) return direct;

  const parentEquity = resolveShareholdersEquity(items, itemUnits);
  const minorityInterest = toNumber(items.MinorityInterest);
  if (
    parentEquity == null ||
    minorityInterest == null ||
    !unitsMatch(
      itemUnits,
      "ShareholdersEquity",
      "MinorityInterest",
    )
  ) {
    return null;
  }
  return parentEquity + minorityInterest;
}
