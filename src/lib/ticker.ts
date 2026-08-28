const TICKER_ALIASES: Record<string, string> = {
  "BRK.B": "BRK-B",
  "BRK.A": "BRK-A",
  "BRK/B": "BRK-B",
  "BRK/A": "BRK-A",
  LLIVE: "LLYVK",
  YY: "JOYY",
};

export function normalizeTicker(ticker: string | null | undefined): string | null {
  if (!ticker) return null;
  const raw = ticker.trim().toUpperCase();
  if (!raw) return null;
  const aliased = TICKER_ALIASES[raw] ?? raw;

  // HK codes are stored 4-digit zero-padded site-wide (e.g. Tencent is "0700.HK",
  // never "700.HK" or "00700.HK") — reformat free-typed input to match, otherwise
  // an otherwise-valid HK ticker silently fails to join against Entity/Security/
  // StockPrice rows keyed on the padded form.
  const hkMatch = aliased.match(/^0*(\d+)\.HK$/);
  if (hkMatch) {
    return `${hkMatch[1].padStart(4, "0")}.HK`;
  }

  return aliased;
}

// US common/preferred stock, e.g. AAPL, BRK-B, JPM-PM, AGCUU
const US_TICKER = /^[A-Z]{1,5}([.-][A-Z]{1,3})?$/;
// HK exchange code, e.g. 0700.HK
const HK_TICKER = /^\d{3,5}\.HK$/;
// CN A-share code, e.g. 600519.SS, 300750.SZ
const CN_TICKER = /^\d{6}\.(SS|SZ)$/;

/**
 * Guards the Entity/Security.ticker write boundary against malformed values
 * (e.g. upstream data quirks that concatenate garbage like "ANETXXXX").
 */
export function isValidTickerFormat(ticker: string): boolean {
  return US_TICKER.test(ticker) || HK_TICKER.test(ticker) || CN_TICKER.test(ticker);
}

/**
 * Trading currency implied by a ticker's own suffix — StockPrice.close is a raw
 * quote in whatever currency the security actually trades in (Yahoo Finance
 * source), never converted, so a HK/CN holding's price and a US holding's price
 * are not directly comparable/summable without knowing which is which.
 */
export function currencyForTicker(ticker: string): "USD" | "HKD" | "CNY" {
  if (HK_TICKER.test(ticker)) return "HKD";
  if (CN_TICKER.test(ticker)) return "CNY";
  return "USD";
}
