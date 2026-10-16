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

const CASH_FLOW_LINE_ITEMS = new Set([
  "CashReceivedFromSales",
  "OperatingCashFlow",
  "CapEx",
  "CashReceivedFromDisposalOfAssets",
  "CashPaidForInvestments",
  "InvestingCashFlow",
  "CashReceivedFromBorrowings",
  "CashRepaymentsOfBorrowings",
  "DividendsPaid",
  "ShareRepurchaseAmt",
  "PaymentsForRepurchaseOfCommonStock",
  "FinancingCashFlow",
  "NetChangeInCash",
  "CashGeneratedFromOperations",
  "PurchaseSaleOfPPE",
  "PurchaseSaleOfBusinessNet",
  "PurchaseSaleOfInvestmentsNet",
  "OtherInvestingCashFlow",
  "NetDebtIssuance",
  "OtherFinancingCashFlow",
  "CashEndOfPeriod",
  "CashBeginningOfPeriod",
  "IncomeTaxPaid",
  "InterestPaid",
]);

const OPTIONAL_CASH_FLOW_ZERO_DEFAULTS = [
  { key: "DividendsPaid", aliases: [] },
  {
    key: "ShareRepurchaseAmt",
    aliases: ["PaymentsForRepurchaseOfCommonStock"],
  },
  { key: "CashReceivedFromDisposalOfAssets", aliases: [] },
  { key: "PurchaseSaleOfBusinessNet", aliases: [] },
] as const;

function hasNumericValue(value: string | undefined) {
  if (value == null || value.trim() === "") return false;
  return Number.isFinite(Number(value));
}

export function applyOptionalCashFlowZeroDefaults<
  T extends { items: Record<string, string> },
>(financialYears: T[]): T[] {
  return financialYears.map((financialYear) => {
    const hasCashFlowData = Object.entries(financialYear.items).some(
      ([lineItem, value]) =>
        CASH_FLOW_LINE_ITEMS.has(lineItem) && hasNumericValue(value),
    );
    if (!hasCashFlowData) return financialYear;

    const items = { ...financialYear.items };
    for (const { key, aliases } of OPTIONAL_CASH_FLOW_ZERO_DEFAULTS) {
      const hasReportedValue = [key, ...aliases].some((lineItem) =>
        hasNumericValue(items[lineItem]),
      );
      if (!hasReportedValue) items[key] = "0";
    }

    return { ...financialYear, items };
  });
}

export function normalizeFinancialItems(
  values: Record<string, number | null>,
  itemUnits: Record<string, string | null | undefined>,
  context: FinancialNormalizationContext,
): Record<string, number | null> {
  return Object.fromEntries(
    Object.entries(values).map(([lineItem, value]) => {
      if (value == null) return [lineItem, null];
      if (value === 0) return [lineItem, 0];

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
