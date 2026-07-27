// Manual entry per TODOS.md P0 ②: "两家公司写小种子脚本手工录入，不先建
// akshare 公司信息管线，等链路验证后再决定批量化". Add one row per company
// as it's onboarded — no code changes needed elsewhere.
//
// `currency` is the company's real reporting currency, verified against its
// actual annual report — not derived from `market`. A HK-listed company can
// report in RMB (e.g. Pop Mart, mainland-domiciled): confirmed by
// cross-checking akshare's stock_financial_hk_report_em() FY2024 revenue
// figure for 09992 against the real publicly reported RMB figure — they
// match, and akshare exposes no currency column of its own.
export type CnHkSeed = {
  market: "cn" | "hk";
  code: string;
  currency: "CNY" | "HKD" | "USD";
  canonicalName: string;
  nameZh: string;
  nameEnShort: string;
  sector: string;
  industry: string;
  exchange: string;
};

export const CN_HK_SEEDS: Record<string, CnHkSeed> = {
  "9992.HK": {
    market: "hk",
    code: "09992",
    currency: "CNY",
    canonicalName: "POP MART INTERNATIONAL GROUP LIMITED",
    nameZh: "泡泡玛特",
    nameEnShort: "Pop Mart",
    sector: "Consumer Discretionary",
    industry: "潮流玩具",
    exchange: "香港交易所",
  },
  "600519.SS": {
    market: "cn",
    code: "600519",
    currency: "CNY",
    canonicalName: "贵州茅台酒股份有限公司",
    nameZh: "贵州茅台",
    nameEnShort: "Kweichow Moutai",
    sector: "Consumer Staples",
    industry: "白酒",
    exchange: "上海证券交易所",
  },
};
