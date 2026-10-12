import { Prisma } from "@prisma/client";

import db from "@/lib/prisma";
import {
  currenciesNeededForConversion,
  extractLatestFxQuote,
  normalizeCurrencyCode,
  type YahooFxChartPayload,
} from "@/lib/fx-rates-core";

const YAHOO_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

type FxRefreshResult = {
  updated: string[];
  failed: Array<{ currency: string; error: string }>;
};

async function fetchYahooFxQuote(currency: string) {
  const ticker = `${currency}USD=X`;
  const now = new Date();
  const url = new URL(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`,
  );
  url.searchParams.set("interval", "1d");
  url.searchParams.set("period1", String(Math.floor((now.getTime() - 14 * 86400000) / 1000)));
  url.searchParams.set("period2", String(Math.floor((now.getTime() + 86400000) / 1000)));
  url.searchParams.set("events", "history");

  const response = await fetch(url, {
    headers: {
      "User-Agent": YAHOO_USER_AGENT,
      Accept: "application/json",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: "https://finance.yahoo.com/",
    },
    signal: AbortSignal.timeout(20000),
  });
  const payload = (await response.json().catch(() => null)) as YahooFxChartPayload | null;
  if (!response.ok) {
    throw new Error(`Yahoo chart returned HTTP ${response.status}`);
  }
  if (!payload) throw new Error("Yahoo returned an empty response");

  const quote = extractLatestFxQuote(payload);
  if (!quote) throw new Error(`Yahoo returned no valid daily close for ${ticker}`);
  return { ticker, ...quote };
}

export async function refreshFxRates(currencies: string[]): Promise<FxRefreshResult> {
  const normalized = [...new Set(currencies
    .map(normalizeCurrencyCode)
    .filter((currency): currency is string => currency != null && currency !== "USD"))];
  const result: FxRefreshResult = { updated: [], failed: [] };

  await Promise.all(normalized.map(async (currency) => {
    try {
      const quote = await fetchYahooFxQuote(currency);
      await db.fxRate.upsert({
        where: { currency },
        create: {
          currency,
          rateToUsd: new Prisma.Decimal(quote.rateToUsd),
          asOfDate: quote.asOfDate,
          ticker: quote.ticker,
          source: "yahoo-chart",
        },
        update: {
          rateToUsd: new Prisma.Decimal(quote.rateToUsd),
          asOfDate: quote.asOfDate,
          ticker: quote.ticker,
          source: "yahoo-chart",
        },
      });
      result.updated.push(currency);
    } catch (error) {
      result.failed.push({
        currency,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }));

  result.updated.sort();
  result.failed.sort((a, b) => a.currency.localeCompare(b.currency));
  return result;
}

export async function ensureFxRatesForPair(
  reportingCurrency: string | null | undefined,
  tradingCurrency: string | null | undefined,
): Promise<void> {
  const needed = currenciesNeededForConversion([{
    reportingCurrency: reportingCurrency ?? null,
    tradingCurrency: tradingCurrency ?? null,
  }]);
  if (!needed.length) return;

  const stored = await db.fxRate.findMany({
    where: { currency: { in: needed } },
    select: { currency: true },
  });
  const present = new Set(stored.map((rate) => rate.currency));
  const missing = needed.filter((currency) => !present.has(currency));
  if (!missing.length) return;

  const result = await refreshFxRates(missing);
  if (result.failed.length) {
    throw new Error(
      result.failed.map((item) => `${item.currency}: ${item.error}`).join("; "),
    );
  }
}

export async function getLatestFxRates(currencies: string[]): Promise<Map<string, number>> {
  const normalized = [...new Set(currencies
    .map(normalizeCurrencyCode)
    .filter((currency): currency is string => currency != null && currency !== "USD"))];
  if (!normalized.length) return new Map();

  const rows = await db.fxRate.findMany({
    where: { currency: { in: normalized } },
    select: { currency: true, rateToUsd: true },
  });
  return new Map(rows.map((row) => [row.currency, Number(row.rateToUsd)]));
}
