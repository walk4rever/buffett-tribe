export function formatUsdInYi(value: string | number | bigint | null): string {
  if (value == null) return "—";
  const amount = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isFinite(amount)) return "—";

  const yi = amount / 1e8;
  const absYi = Math.abs(yi);

  if (absYi >= 1000) return `${yi.toLocaleString("en-US", { maximumFractionDigits: 1 })}亿`;
  if (absYi >= 10) return `${yi.toFixed(1)}亿`;
  return `${yi.toFixed(2)}亿`;
}

export const CURRENCY_PREFIX: Record<string, string> = {
  CNY: "¥",
  HKD: "HK$",
};

/** USD (and any unrecognized currency) intentionally has no prefix — matches
 *  formatMoneyInYi's existing convention below, so callers can use one symbol
 *  table for both large "亿"-scale figures and small per-share amounts. */
export function currencyPrefix(currency: string | null | undefined): string {
  if (!currency) return "";
  return CURRENCY_PREFIX[currency] ?? "";
}

/**
 * Same magnitude formatting as formatUsdInYi, plus a currency prefix for
 * non-USD units — CNY/HKD financials would otherwise render as bare "130.4亿"
 * numbers, visually indistinguishable from a USD company's figures. USD and
 * unset/unrecognized currencies fall through to formatUsdInYi's existing
 * no-prefix output unchanged, so no US company page is affected.
 */
export function formatMoneyInYi(value: string | number | bigint | null, currency: string | null): string {
  const formatted = formatUsdInYi(value);
  if (formatted === "—") return formatted;
  const prefix = currency ? CURRENCY_PREFIX[currency] : undefined;
  return prefix ? `${prefix}${formatted}` : formatted;
}
