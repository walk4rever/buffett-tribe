export type YahooFxChartPayload = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{ close?: Array<number | null> }>;
      };
    }>;
  };
};

export type FxQuote = {
  rateToUsd: number;
  asOfDate: Date;
};

export function tradingCurrencyForMarket(market: string | null | undefined): string | null {
  switch (market) {
    case "cn":
      return "CNY";
    case "hk":
      return "HKD";
    case "us":
    case null:
    case undefined:
      return "USD";
    default:
      return null;
  }
}

export function normalizeCurrencyCode(value: string | null | undefined): string | null {
  const code = value?.trim().toUpperCase();
  return code && /^[A-Z]{3}$/.test(code) ? code : null;
}

export function currencyRateToUsd(
  currency: string,
  rates: ReadonlyMap<string, number>,
): number | null {
  const code = normalizeCurrencyCode(currency);
  if (!code) return null;
  if (code === "USD") return 1;
  const rate = rates.get(code);
  return rate != null && Number.isFinite(rate) && rate > 0 ? rate : null;
}

export function convertCurrency(
  amount: number | null,
  fromCurrency: string,
  toCurrency: string,
  rates: ReadonlyMap<string, number>,
): number | null {
  if (amount == null || !Number.isFinite(amount)) return null;
  const from = normalizeCurrencyCode(fromCurrency);
  const to = normalizeCurrencyCode(toCurrency);
  if (!from || !to) return null;
  if (from === to) return amount;

  const fromRate = currencyRateToUsd(from, rates);
  const toRate = currencyRateToUsd(to, rates);
  if (fromRate == null || toRate == null) return null;
  return amount * (fromRate / toRate);
}

export function currenciesNeededForConversion(
  pairs: Array<{
    reportingCurrency: string | null;
    tradingCurrency: string | null;
  }>,
): string[] {
  const currencies = new Set<string>();
  for (const pair of pairs) {
    const reporting = normalizeCurrencyCode(pair.reportingCurrency);
    const trading = normalizeCurrencyCode(pair.tradingCurrency);
    if (!reporting || !trading || reporting === trading) continue;
    if (reporting !== "USD") currencies.add(reporting);
    if (trading !== "USD") currencies.add(trading);
  }
  return [...currencies].sort();
}

export function extractLatestFxQuote(payload: YahooFxChartPayload): FxQuote | null {
  const result = payload.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];

  for (let index = Math.min(timestamps.length, closes.length) - 1; index >= 0; index--) {
    const rateToUsd = closes[index];
    const timestamp = timestamps[index];
    if (
      rateToUsd == null ||
      !Number.isFinite(rateToUsd) ||
      rateToUsd <= 0 ||
      !Number.isFinite(timestamp)
    ) {
      continue;
    }

    const rawDate = new Date(timestamp * 1000);
    const asOfDate = new Date(Date.UTC(
      rawDate.getUTCFullYear(),
      rawDate.getUTCMonth(),
      rawDate.getUTCDate(),
    ));
    if (!Number.isNaN(asOfDate.getTime())) return { rateToUsd, asOfDate };
  }
  return null;
}
