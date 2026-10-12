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

const CURRENCY_PREFIX: Record<string, string> = {
  CNY: "¥",
  HKD: "HK$",
  EUR: "€",
  CAD: "C$",
  GBP: "£",
  JPY: "¥",
  DKK: "kr ",
  TWD: "NT$",
};

export type SupportedCurrency =
  | "USD"
  | "HKD"
  | "CNY"
  | "EUR"
  | "CAD"
  | "GBP"
  | "JPY"
  | "DKK"
  | "TWD";

const CURRENCY_SYMBOL: Record<SupportedCurrency, string> = {
  USD: "$",
  HKD: "HK$",
  CNY: "¥",
  EUR: "€",
  CAD: "C$",
  GBP: "£",
  JPY: "¥",
  DKK: "kr",
  TWD: "NT$",
};

export const CURRENCY_NAMES: Record<string, string> = {
  USD: "美元 (USD)",
  CNY: "人民币 (CNY)",
  HKD: "港元 (HKD)",
  EUR: "欧元 (EUR)",
  CAD: "加元 (CAD)",
  GBP: "英镑 (GBP)",
  JPY: "日元 (JPY)",
  DKK: "丹麦克朗 (DKK)",
  TWD: "新台币 (TWD)",
};

export function currencyDisplayName(currency: string | null): string {
  if (!currency) return "美元 (USD)";
  return CURRENCY_NAMES[currency.toUpperCase()] ?? currency;
}

/** Unlike formatMoneyInYi below, always shows a symbol — including "$" for USD.
 *  For a portfolio mixing USD/HKD/CNY holdings, USD's usual site-wide no-prefix
 *  convention would be the one figure with no currency marker at all; a plain
 *  symbol reads clearer there than a separate "USD" text label next to it. */
export function currencySymbol(currency: string): string {
  return CURRENCY_SYMBOL[currency as SupportedCurrency] ?? currency;
}

/**
 * Same magnitude formatting as formatUsdInYi, plus a currency prefix for
 * non-USD units — CNY/HKD/EUR/CAD etc. financials render with appropriate symbols.
 * USD and unset currencies fall through to formatUsdInYi's existing
 * no-prefix output unchanged.
 */
export function formatMoneyInYi(value: string | number | bigint | null, currency: string | null): string {
  const formatted = formatUsdInYi(value);
  if (formatted === "—") return formatted;
  const prefix = currency ? CURRENCY_PREFIX[currency.toUpperCase()] : undefined;
  return prefix ? `${prefix}${formatted}` : formatted;
}
