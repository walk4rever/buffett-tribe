// Manual entry per TODO.md P0 ②: "两家公司写小种子脚本手工录入，不先建
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
  "601088.SS": {
    market: "cn",
    code: "601088",
    currency: "CNY",
    canonicalName: "中国神华能源股份有限公司",
    nameZh: "中国神华",
    nameEnShort: "China Shenhua",
    sector: "Energy",
    industry: "煤炭",
    exchange: "上海证券交易所",
  },
  "300750.SZ": {
    market: "cn",
    code: "300750",
    currency: "CNY",
    canonicalName: "宁德时代新能源科技股份有限公司",
    nameZh: "宁德时代",
    nameEnShort: "CATL",
    sector: "Industrials",
    industry: "动力电池",
    exchange: "深圳证券交易所",
  },
  "0700.HK": {
    market: "hk",
    code: "00700",
    currency: "CNY",
    canonicalName: "TENCENT HOLDINGS LIMITED",
    nameZh: "腾讯控股",
    nameEnShort: "Tencent",
    sector: "Communication Services",
    industry: "互联网",
    exchange: "香港交易所",
  },
  "9633.HK": {
    market: "hk",
    code: "09633",
    currency: "CNY",
    canonicalName: "NONGFU SPRING CO., LTD.",
    nameZh: "农夫山泉",
    nameEnShort: "Nongfu Spring",
    sector: "Consumer Staples",
    industry: "包装饮用水",
    exchange: "香港交易所",
  },
  "3690.HK": {
    market: "hk",
    code: "03690",
    currency: "CNY",
    canonicalName: "MEITUAN",
    nameZh: "美团",
    nameEnShort: "Meituan",
    sector: "Consumer Discretionary",
    industry: "本地生活服务",
    exchange: "香港交易所",
  },
  "600036.SS": {
    market: "cn",
    code: "600036",
    currency: "CNY",
    canonicalName: "招商银行股份有限公司",
    nameZh: "招商银行",
    nameEnShort: "China Merchants Bank",
    sector: "Financials",
    industry: "银行",
    exchange: "上海证券交易所",
  },
  "000568.SZ": {
    market: "cn",
    code: "000568",
    currency: "CNY",
    canonicalName: "泸州老窖股份有限公司",
    nameZh: "泸州老窖",
    nameEnShort: "Luzhou Laojiao",
    sector: "Consumer Staples",
    industry: "白酒",
    exchange: "深圳证券交易所",
  },
  "600900.SS": {
    market: "cn",
    code: "600900",
    currency: "CNY",
    canonicalName: "中国长江电力股份有限公司",
    nameZh: "长江电力",
    nameEnShort: "China Yangtze Power",
    sector: "Utilities",
    industry: "水电",
    exchange: "上海证券交易所",
  },
  "2328.HK": {
    market: "hk",
    code: "02328",
    currency: "CNY",
    canonicalName: "PICC PROPERTY AND CASUALTY COMPANY LIMITED",
    nameZh: "中国财险",
    nameEnShort: "PICC P&C",
    sector: "Financials",
    industry: "财产保险",
    exchange: "香港交易所",
  },
};
