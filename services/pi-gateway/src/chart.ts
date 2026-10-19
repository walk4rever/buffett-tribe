import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PYTHON_CHART_SCRIPT = `
import sys, json
import yfinance as yf
ticker = sys.argv[1]
range_val = sys.argv[2] if len(sys.argv) > 2 else "10d"
t = yf.Ticker(ticker)
df = t.history(period=range_val, interval="1d", auto_adjust=False)
if df.empty:
    print(json.dumps({"error": "empty"}))
    sys.exit(0)
res = {
    "chart": {
        "result": [{
            "meta": {
                "regularMarketPrice": float(df["Close"].iloc[-1]) if not df.empty else None,
                "symbol": ticker,
            },
            "timestamp": [int(d.timestamp()) for d in df.index],
            "indicators": {
                "quote": [{
                    "open": [float(x) if x == x else None for x in df["Open"]],
                    "high": [float(x) if x == x else None for x in df["High"]],
                    "low": [float(x) if x == x else None for x in df["Low"]],
                    "close": [float(x) if x == x else None for x in df["Close"]],
                    "volume": [int(x) if x == x else None for x in df["Volume"]],
                }],
                "adjclose": [{
                    "adjclose": [float(x) if x == x else None for x in df.get("Adj Close", df["Close"])],
                }]
            }
        }]
    }
}
print(json.dumps(res))
`;

const ALLOWED_RANGES = new Set([
  "1d", "5d", "10d", "1mo", "3mo", "6mo",
  "1y", "2y", "5y", "10y", "ytd", "max",
]);
const TICKER_PATTERN = /^[A-Z0-9.^=-]{1,20}$/;
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CONCURRENCY = 2;
const MAX_BUFFER_BYTES = 2 * 1024 * 1024;

const cache = new Map<string, { expiresAt: number; data: unknown }>();
let inFlight = 0;

export function normalizeChartTicker(value: string): string | null {
  const ticker = value.trim().toUpperCase();
  return TICKER_PATTERN.test(ticker) ? ticker : null;
}

export function normalizeChartRange(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return "10d";
  if (typeof value !== "string" || !ALLOWED_RANGES.has(value)) return null;
  return value;
}

export async function fetchChartData(ticker: string, range: string): Promise<unknown> {
  const cacheKey = `${ticker}:${range}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  if (inFlight >= MAX_CONCURRENCY) {
    throw Object.assign(new Error("Chart service is busy"), { statusCode: 503 });
  }

  inFlight += 1;
  try {
    const { stdout } = await execFileAsync(
      "python3",
      ["-c", PYTHON_CHART_SCRIPT, ticker, range],
      {
        encoding: "utf-8",
        timeout: 10_000,
        maxBuffer: MAX_BUFFER_BYTES,
      },
    );
    const data = JSON.parse(stdout);
    cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, data });
    return data;
  } finally {
    inFlight -= 1;
  }
}
