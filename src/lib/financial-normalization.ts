import {
  convertCurrency,
  extractCurrencyCode,
} from "@/lib/fx-rates-core";

export type FinancialNormalizationContext = {
  reportingCurrency: string | null;
  tradingCurrency: string | null;
  knownItemCurrencies: ReadonlySet<string>;
  fxRates: ReadonlyMap<string, number>;
};

export function normalizeFinancialItems(
  values: Record<string, number | null>,
  itemUnits: Record<string, string | null | undefined>,
  context: FinancialNormalizationContext,
): Record<string, number | null> {
  return Object.fromEntries(
    Object.entries(values).map(([lineItem, value]) => {
      if (value == null) return [lineItem, null];

      const unit = itemUnits[lineItem];
      const itemCurrency = extractCurrencyCode(unit);
      const canUseReportingCurrency =
        unit == null && context.knownItemCurrencies.size <= 1;
      const fromCurrency =
        itemCurrency ??
        (canUseReportingCurrency ? context.reportingCurrency : null);

      if (!fromCurrency || !context.tradingCurrency) return [lineItem, null];
      if (fromCurrency === context.tradingCurrency) return [lineItem, value];

      return [
        lineItem,
        convertCurrency(
          value,
          fromCurrency,
          context.tradingCurrency,
          context.fxRates,
        ),
      ];
    }),
  );
}

export function deriveSharesFromFinancials(
  netIncome: number | null,
  eps: number | null,
  netIncomeUnit: string | null | undefined,
  epsUnit: string | null | undefined,
): number | null {
  const netIncomeCurrency = extractCurrencyCode(netIncomeUnit);
  const epsCurrency = extractCurrencyCode(epsUnit);

  if (
    netIncome == null ||
    eps == null ||
    !Number.isFinite(netIncome) ||
    !Number.isFinite(eps) ||
    Math.abs(eps) <= 0.0001 ||
    Math.abs(netIncome) === 0 ||
    !netIncomeCurrency ||
    netIncomeCurrency !== epsCurrency
  ) {
    return null;
  }

  return Math.round(Math.abs(netIncome / eps));
}
