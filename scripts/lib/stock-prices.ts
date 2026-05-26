import { PrismaClient } from "@prisma/client";

export type StockPriceRecord = {
  ticker: string;
  date: Date;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: bigint | null;
  adjustedClose: number | null;
};

export type YahooChartResponse = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
        adjclose?: Array<{
          adjclose?: Array<number | null>;
        }>;
      };
      meta?: {
        currency?: string;
        instrumentType?: string;
      };
    }>;
    error?: {
      code?: string;
      description?: string;
    } | null;
  };
};

export type PriceWindow = {
  start: Date;
  endExclusive: Date;
};

const YF_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export function parseUtcDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid UTC date: ${value}`);
  }
  return startOfUtcDay(date);
}

export function todayUtc(): Date {
  return startOfUtcDay(new Date());
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function formatDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function normalizeTicker(ticker: string): string {
  const normalized = ticker.trim().toUpperCase();
  if (!normalized) throw new Error("Ticker is required");
  return normalized;
}

export function buildWindows(
  start: Date,
  endExclusive: Date,
  chunkDays = 180,
  overlapDays = 5
): PriceWindow[] {
  if (chunkDays <= 0) throw new Error("chunkDays must be positive");
  if (overlapDays < 0) throw new Error("overlapDays must be non-negative");

  const windows: PriceWindow[] = [];
  let cursor = startOfUtcDay(start);
  const finish = startOfUtcDay(endExclusive);

  while (cursor < finish) {
    const candidateEnd = addDays(cursor, chunkDays);
    const end = candidateEnd > finish ? finish : candidateEnd;

    if (end <= cursor) {
      break;
    }

    windows.push({ start: cursor, endExclusive: end });

    if (end.getTime() >= finish.getTime()) {
      break;
    }

    const nextCursor = addDays(end, -overlapDays);
    cursor = nextCursor > cursor ? nextCursor : addDays(cursor, 1);
  }

  return windows;
}

export async function fetchYahooChartWindow(
  ticker: string,
  start: Date,
  endExclusive: Date,
  retries = 5
): Promise<YahooChartResponse> {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`);
  url.searchParams.set("interval", "1d");
  url.searchParams.set("period1", String(Math.floor(start.getTime() / 1000)));
  url.searchParams.set("period2", String(Math.floor(endExclusive.getTime() / 1000)));
  url.searchParams.set("events", "history");

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": YF_USER_AGENT,
          Accept: "application/json",
          "Accept-Language": "en-US,en;q=0.9",
          Referer: "https://finance.yahoo.com/",
        },
      });

      const body = (await res.json().catch(() => null)) as YahooChartResponse | null;
      if (!res.ok) {
        const detail = body?.chart?.error?.description || body?.chart?.error?.code || `${res.status} ${res.statusText}`;
        throw new Error(`Yahoo Finance API error: ${detail}`);
      }
      if (body?.chart?.error) {
        throw new Error(
          `Yahoo Finance API error: ${body.chart.error.description || body.chart.error.code || "unknown"}`
        );
      }
      return body ?? {};
    } catch (err) {
      lastError = err;
      if (attempt === retries) break;
      const backoffMs = 500 * attempt * attempt;
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Yahoo Finance API request failed");
}

export function normalizeYahooChartResponse(
  ticker: string,
  payload: YahooChartResponse
): StockPriceRecord[] {
  const result = payload.chart?.result?.[0];
  if (!result) return [];

  const timestamps = result.timestamp ?? [];
  if (timestamps.length === 0) return [];

  const quote = result.indicators?.quote?.[0];
  if (!quote) {
    throw new Error(`Yahoo response for ${ticker} is missing quote data`);
  }

  const closes = quote.close ?? [];
  const opens = quote.open ?? [];
  const highs = quote.high ?? [];
  const lows = quote.low ?? [];
  const volumes = quote.volume ?? [];
  const adjclose = result.indicators?.adjclose?.[0]?.adjclose ?? [];
  const len = timestamps.length;

  const byDate = new Map<string, StockPriceRecord>();
  for (let i = 0; i < len; i++) {
    const close = closes[i];
    if (close == null || !Number.isFinite(close)) continue;

    const rawDate = new Date(timestamps[i] * 1000);
    const date = new Date(
      Date.UTC(rawDate.getUTCFullYear(), rawDate.getUTCMonth(), rawDate.getUTCDate())
    );
    if (Number.isNaN(date.getTime())) continue;

    const key = formatDateKey(date);
    byDate.set(key, {
      ticker,
      date,
      open: opens[i] != null && Number.isFinite(opens[i] as number) ? (opens[i] as number) : null,
      high: highs[i] != null && Number.isFinite(highs[i] as number) ? (highs[i] as number) : null,
      low: lows[i] != null && Number.isFinite(lows[i] as number) ? (lows[i] as number) : null,
      close,
      volume: volumes[i] != null && Number.isFinite(volumes[i] as number) ? BigInt(Math.round(volumes[i] as number)) : null,
      adjustedClose: adjclose[i] != null && Number.isFinite(adjclose[i] as number) ? (adjclose[i] as number) : null,
    });
  }

  return [...byDate.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}

export async function replaceStockPriceWindow(
  db: PrismaClient,
  ticker: string,
  start: Date,
  endExclusive: Date,
  records: StockPriceRecord[]
): Promise<void> {
  if (records.length === 0) return;

  await db.$transaction([
    db.stockPrice.deleteMany({
      where: {
        ticker,
        date: {
          gte: start,
          lt: endExclusive,
        },
      },
    }),
    db.stockPrice.createMany({
      data: records,
    }),
  ]);
}

export async function upsertStockPriceRecords(
  db: PrismaClient,
  records: StockPriceRecord[],
  batchSize = 250
): Promise<void> {
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    await db.$transaction(
      batch.map((record) =>
        db.stockPrice.upsert({
          where: {
            ticker_date: {
              ticker: record.ticker,
              date: record.date,
            },
          },
          create: record,
          update: record,
        })
      )
    );
  }
}
