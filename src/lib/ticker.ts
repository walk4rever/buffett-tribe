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
  return TICKER_ALIASES[raw] ?? raw;
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
