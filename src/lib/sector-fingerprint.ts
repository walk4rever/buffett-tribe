/**
 * 财务指纹 —— 从 Financial 行（EAV 长表）算出一组「估值逻辑」特征。
 *
 * 为什么要它：行业分类的标准是「估值逻辑是否不同」，而财务指纹是估值逻辑
 * 最直接的观测值。一家公司「资产是营收的 8 倍、负债率 90%」就必然是资产
 * 负债表型金融业务，不管它名字里有没有「金融」二字；「毛利率 85%、资本
 * 开支 2%」必然是软件或品牌。比行业关键词可靠一个数量级。
 *
 * 只用比率不用绝对值：① 跨市场（USD/HKD/CNY）可比 ② 同一份财报内单位一致，
 * 比率自动消掉单位。仅 revenue 保留绝对值用于展示量级。
 *
 * 纯函数，无 I/O，可单测。
 */

/** Financial 表的一行（value 允许 Decimal 的字符串形式） */
export interface FinancialRowInput {
  periodEnd: Date | string;
  periodType: string; // 'FY' | 'Q1' | 'Q2' | 'Q3' | 'Q4'
  lineItem: string;
  value: number | string | null;
}

export interface SectorFingerprint {
  /** 采用期的标签，如 "FY2026" */
  periodLabel: string | null;
  /** 本次参与计算的期数（批量脚本只取最近 2 个 FY + 最新一期，故为 1–3） */
  periods: number;
  /** 最新期营收（原币种绝对值，仅用于展示量级） */
  revenue: number | null;
  /** 营收同比 */
  revenueYoY: number | null;
  netMargin: number | null;
  grossMargin: number | null;
  roe: number | null;
  /** 总资产 / 营收 —— >3 基本可判定资产负债表型业务 */
  assetToRevenue: number | null;
  liabilitiesToAssets: number | null;
  /** 资本开支 / 营收 —— >15% 属重资本 */
  capexToRevenue: number | null;
  /** 经营现金流 / 净利润 */
  cashConversion: number | null;
  /** 最新期是否亏损 */
  isLossMaking: boolean | null;
}

const EMPTY_FINGERPRINT: SectorFingerprint = {
  periodLabel: null,
  periods: 0,
  revenue: null,
  revenueYoY: null,
  netMargin: null,
  grossMargin: null,
  roe: null,
  assetToRevenue: null,
  liabilitiesToAssets: null,
  capexToRevenue: null,
  cashConversion: null,
  isLossMaking: null,
};

/** 保留 4 位小数，让指纹（以及由它派生的 inputsHash）可稳定复现 */
function round(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 1e4) / 1e4;
}

function toNumber(value: number | string | null): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function ratio(numerator: number | null, denominator: number | null, requirePositiveDenominator = true): number | null {
  if (numerator == null || denominator == null) return null;
  if (requirePositiveDenominator && denominator <= 0) return null;
  if (!requirePositiveDenominator && denominator === 0) return null;
  return round(numerator / denominator);
}

interface PeriodBucket {
  key: string;
  periodType: string;
  periodEnd: Date;
  values: Map<string, number>;
}

function bucketPeriods(rows: FinancialRowInput[]): PeriodBucket[] {
  const buckets = new Map<string, PeriodBucket>();
  for (const row of rows) {
    const value = toNumber(row.value);
    if (value == null) continue;
    const periodEnd = row.periodEnd instanceof Date ? row.periodEnd : new Date(row.periodEnd);
    if (Number.isNaN(periodEnd.getTime())) continue;
    const key = `${row.periodType}:${periodEnd.toISOString().slice(0, 10)}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { key, periodType: row.periodType, periodEnd, values: new Map() };
      buckets.set(key, bucket);
    }
    bucket.values.set(row.lineItem, value);
  }
  return [...buckets.values()].sort((a, b) => b.periodEnd.getTime() - a.periodEnd.getTime());
}

function pick(values: Map<string, number>, ...names: string[]): number | null {
  for (const name of names) {
    const v = values.get(name);
    if (v != null) return v;
  }
  return null;
}

/**
 * 计算财务指纹。
 *
 * 期选择：优先最新 FY，没有 FY 则用最新一期（HK/CN 早期导入可能只有 FY，
 * US 有季报，若拿季报算「资产/营收」会因营收未年化而失真，所以 FY 优先）。
 */
export function computeSectorFingerprint(rows: FinancialRowInput[]): SectorFingerprint {
  const periods = bucketPeriods(rows);
  if (periods.length === 0) return { ...EMPTY_FINGERPRINT };

  const latest = periods.find((p) => p.periodType === "FY") ?? periods[0];
  const previousFy = periods.find(
    (p) => p.periodType === "FY" && p.periodEnd.getTime() < latest.periodEnd.getTime(),
  );

  const v = latest.values;
  const revenue = pick(v, "Revenue");
  const netIncome = pick(v, "NetIncome");
  const grossProfit = pick(v, "GrossProfit");
  const totalAssets = pick(v, "TotalAssets");
  const totalLiabilities = pick(v, "TotalLiabilities");
  const equity = pick(v, "ShareholdersEquity", "StockholdersEquity");
  const capex = pick(v, "CapEx");
  const ocf = pick(v, "OperatingCashFlow");

  const prevRevenue = previousFy ? pick(previousFy.values, "Revenue") : null;

  return {
    periodLabel: `${latest.periodType}${latest.periodEnd.getUTCFullYear()}`,
    periods: periods.length,
    revenue: round(revenue),
    revenueYoY: ratio(revenue != null && prevRevenue != null ? revenue - prevRevenue : null, prevRevenue),
    netMargin: ratio(netIncome, revenue),
    grossMargin: ratio(grossProfit, revenue),
    // 权益可能为负（资不抵债），此时 ROE 无意义但仍有信息量，保留符号
    roe: ratio(netIncome, equity, false),
    assetToRevenue: ratio(totalAssets, revenue),
    liabilitiesToAssets: ratio(totalLiabilities, totalAssets),
    capexToRevenue: ratio(capex, revenue),
    cashConversion: ratio(ocf, netIncome, false),
    isLossMaking: netIncome == null ? null : netIncome < 0,
  };
}

/** 指纹里有几个可用信号（用于判断证据是否足够下结论） */
export function countFingerprintSignals(fingerprint: SectorFingerprint): number {
  const fields: Array<number | null> = [
    fingerprint.netMargin,
    fingerprint.grossMargin,
    fingerprint.assetToRevenue,
    fingerprint.liabilitiesToAssets,
    fingerprint.capexToRevenue,
    fingerprint.cashConversion,
  ];
  return fields.filter((f) => f != null).length;
}
