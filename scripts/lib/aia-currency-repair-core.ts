export function getAiaCorrectedFinancialUnit(unit: string | null): string | null {
  if (unit == null) return null;
  const match = unit.trim().match(/^USD(\/(?:shares?|ADS|ADR))?$/i);
  if (!match) return unit;
  return `CNY${match[1]?.toLowerCase() ?? ""}`;
}
