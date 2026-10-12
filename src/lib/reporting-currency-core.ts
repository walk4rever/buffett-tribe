import { normalizeCurrencyCode } from "./fx-rates-core";

type CurrencyEntity = {
  id: string;
  reportingCurrency: string | null;
  metadata: unknown;
};

type FinancialUnit = {
  entityId: string;
  unit: string | null;
  periodEnd: Date;
};

export function resolveReportingCurrency(
  entityId: string,
  familyIds: string[],
  entities: CurrencyEntity[],
  financialUnits: FinancialUnit[],
): string | null {
  const orderedIds = [...new Set([entityId, ...familyIds])];
  const entitiesById = new Map(entities.map((entity) => [entity.id, entity]));

  for (const id of orderedIds) {
    const currency = normalizeCurrencyCode(entitiesById.get(id)?.reportingCurrency);
    if (currency) return currency;
  }

  for (const id of orderedIds) {
    const metadata = entitiesById.get(id)?.metadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) continue;
    const legacyCurrency = (metadata as Record<string, unknown>).currency;
    const currency = normalizeCurrencyCode(
      typeof legacyCurrency === "string" ? legacyCurrency : null,
    );
    if (currency) return currency;
  }

  for (const id of orderedIds) {
    const latestUnit = financialUnits
      .filter((row) => row.entityId === id)
      .sort((a, b) => b.periodEnd.getTime() - a.periodEnd.getTime())
      .map((row) => normalizeCurrencyCode(row.unit))
      .find((currency): currency is string => currency != null);
    if (latestUnit) return latestUnit;
  }

  return null;
}
