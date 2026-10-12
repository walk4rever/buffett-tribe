import { Prisma } from "@prisma/client";

import db from "@/lib/prisma";
import { withShortWriteTransaction } from "@/lib/db-short-write";
import {
  currenciesNeededForConversion,
  extractLatestFxQuote,
  normalizeCurrencyCode,
  type YahooFxChartPayload,
} from "@/lib/fx-rates-core";

const YAHOO_USER_AGENT = "Mozilla/5.0";
const YAHOO_CHART_HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"] as const;
const MAX_YAHOO_ATTEMPTS = 3;

type FxRefreshResult = {
  updated: string[];
  failed: Array<{ currency: string; error: string }>;
};

function retryDelayMs(response: Response, attempt: number) {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.min(10_000, Math.max(0, seconds * 1000));
    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) return Math.min(10_000, Math.max(0, retryAt - Date.now()));
  }
  return Math.min(5_000, 500 * 2 ** attempt);
}

type FxQuoteResult = {
  rateToUsd: number;
  asOfDate: Date;
  ticker: string;
  source: string;
};

type FrankfurterPayload = {
  amount?: number;
  base?: string;
  date?: string;
  rates?: Record<string, number>;
};

async function fetchFrankfurterFxQuote(currency: string): Promise<FxQuoteResult> {
  const url = new URL("https://api.frankfurter.app/latest");
  url.searchParams.set("from", currency);
  url.searchParams.set("to", "USD");

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`Frankfurter returned HTTP ${response.status}`);
  }

  const payload = (await response.json().catch(() => null)) as FrankfurterPayload | null;
  const rate = payload?.rates?.USD;
  if (rate == null || !Number.isFinite(rate) || rate <= 0) {
    throw new Error(`Frankfurter returned invalid USD rate for ${currency}`);
  }

  const asOfDate = payload?.date ? new Date(payload.date) : new Date();
  return {
    rateToUsd: rate,
    asOfDate,
    ticker: `${currency}USD`,
    source: "frankfurter-ecb",
  };
}

async function fetchYahooFxQuote(currency: string): Promise<FxQuoteResult> {
  const ticker = `${currency}USD=X`;
  const now = new Date();

  for (let attempt = 0; attempt < MAX_YAHOO_ATTEMPTS; attempt += 1) {
    const host = YAHOO_CHART_HOSTS[attempt % YAHOO_CHART_HOSTS.length];
    const url = new URL(
      `https://${host}/v8/finance/chart/${encodeURIComponent(ticker)}`,
    );
    url.searchParams.set("interval", "1d");
    url.searchParams.set("period1", String(Math.floor((now.getTime() - 14 * 86400000) / 1000)));
    url.searchParams.set("period2", String(Math.floor((now.getTime() + 86400000) / 1000)));
    url.searchParams.set("events", "history");

    const response = await fetch(url, {
      headers: {
        "User-Agent": YAHOO_USER_AGENT,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(20000),
    });
    if ((response.status === 429 || response.status >= 500) && attempt < MAX_YAHOO_ATTEMPTS - 1) {
      const delay = retryDelayMs(response, attempt);
      console.warn(`[fx] Yahoo chart HTTP ${response.status}; retrying in ${delay}ms`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }
    if (!response.ok) throw new Error(`Yahoo chart returned HTTP ${response.status}`);

    const payload = (await response.json().catch(() => null)) as YahooFxChartPayload | null;
    if (!payload) throw new Error("Yahoo returned an empty response");

    const quote = extractLatestFxQuote(payload);
    if (!quote) throw new Error(`Yahoo returned no valid daily close for ${ticker}`);
    return { ticker, source: "yahoo-chart", ...quote };
  }

  throw new Error(`Yahoo chart failed after ${MAX_YAHOO_ATTEMPTS} attempts`);
}

async function fetchFxQuote(currency: string): Promise<FxQuoteResult> {
  try {
    return await fetchFrankfurterFxQuote(currency);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[fx] Frankfurter failed for ${currency} (${msg}), falling back to Yahoo chart`);
    return await fetchYahooFxQuote(currency);
  }
}

export async function refreshFxRates(currencies: string[]): Promise<FxRefreshResult> {
  const normalized = [...new Set(currencies
    .map(normalizeCurrencyCode)
    .filter((currency): currency is string => currency != null && currency !== "USD"))];
  const result: FxRefreshResult = { updated: [], failed: [] };

  await Promise.all(normalized.map(async (currency) => {
    try {
      const quote = await fetchFxQuote(currency);
      await withShortWriteTransaction(db, (tx) =>
        tx.fxRate.upsert({
          where: { currency },
          create: {
            currency,
            rateToUsd: new Prisma.Decimal(quote.rateToUsd),
            asOfDate: quote.asOfDate,
            ticker: quote.ticker,
            source: quote.source,
          },
          update: {
            rateToUsd: new Prisma.Decimal(quote.rateToUsd),
            asOfDate: quote.asOfDate,
            ticker: quote.ticker,
            source: quote.source,
          },
        }),
      );
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
