import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { computeValuationMetrics } from "@/lib/valuation-metrics";

export interface Phase3RedFlag {
  code: string;
  level: "warning" | "alert";
  title: string;
  message: string;
}

export interface Phase3UpdateOptions {
  entityId?: string;
  ticker?: string;
  dryRun?: boolean;
  enqueueP3?: boolean;
}

export interface Phase3UpdateResult {
  success: boolean;
  entityId: string;
  ticker: string;
  allTickers: string[];
  canonicalName: string;
  nameZh?: string | null;
  onboardPhase: number;
  latestPrice: number | null;
  priceDate: string | null;
  priceRefreshed: boolean;
  currentPe: number | null;
  benchmarkPe: number | null;
  valuationStatus: "undervalued" | "fair" | "overvalued" | "insufficient";
  valuationDiffPct: number | null;
  redFlags: Phase3RedFlag[];
  fundamentalHealth: "healthy" | "attention" | "warning";
  summary: string;
  updatedAt: string;
  durationMs: number;
  newFilingsCount?: number;
  newFilings?: Array<{ kind: string; form: string; periodLabel: string; filingDate: string; url: string }>;
  p3Enqueued?: boolean;
  error?: string;
}

/**
 * Helper to parse Yahoo Chart API result format and upsert recent price bars into StockPrice.
 */
async function parseAndUpsertYahooBars(
  ticker: string,
  result: Record<string, unknown>,
  dryRun = false
): Promise<{ ticker: string; latestPrice: number | null; priceDate: string | null; refreshed: boolean }> {
  const timestamps = (result.timestamp as number[]) || [];
  const indicators = result.indicators as Record<string, unknown> | undefined;
  const quote = ((indicators?.quote as Array<Record<string, unknown>>) || [])[0] || {};
  const adjcloseList = ((indicators?.adjclose as Array<Record<string, unknown>>) || [])[0]?.adjclose as Array<number | null> || [];
  const opens = (quote.open as Array<number | null>) || [];
  const highs = (quote.high as Array<number | null>) || [];
  const lows = (quote.low as Array<number | null>) || [];
  const closes = (quote.close as Array<number | null>) || [];
  const volumes = (quote.volume as Array<number | null>) || [];

  const bars: Array<{
    ticker: string;
    date: Date;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number;
    volume: bigint | null;
    adjustedClose: number | null;
  }> = [];

  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (close == null || !Number.isFinite(close)) continue;
    const rawDate = new Date(timestamps[i] * 1000);
    const date = new Date(Date.UTC(rawDate.getUTCFullYear(), rawDate.getUTCMonth(), rawDate.getUTCDate()));

    bars.push({
      ticker,
      date,
      open: opens[i] != null && Number.isFinite(opens[i] as number) ? (opens[i] as number) : null,
      high: highs[i] != null && Number.isFinite(highs[i] as number) ? (highs[i] as number) : null,
      low: lows[i] != null && Number.isFinite(lows[i] as number) ? (lows[i] as number) : null,
      close: Number(close.toFixed(4)),
      volume: volumes[i] != null && Number.isFinite(volumes[i] as number) ? BigInt(Math.round(volumes[i] as number)) : null,
      adjustedClose: adjcloseList[i] != null && Number.isFinite(adjcloseList[i] as number) ? Number((adjcloseList[i] as number).toFixed(4)) : null,
    });
  }

  if (bars.length > 0 && !dryRun) {
    await prisma.$transaction(
      bars.map((b) =>
        prisma.stockPrice.upsert({
          where: {
            ticker_date: {
              ticker: b.ticker,
              date: b.date,
            },
          },
          create: b,
          update: b,
        })
      )
    );
  }

  if (bars.length > 0) {
    const last = bars[bars.length - 1];
    return {
      ticker,
      latestPrice: last.close,
      priceDate: last.date.toISOString().slice(0, 10),
      refreshed: true,
    };
  }

  return getLatestPriceFromDb(ticker, false);
}

/**
 * Fetch recent price bars directly:
 * 1. Try relay gateway (air7 yfinance proxy) which is immune to Vercel/cloud datacenter 429 IP blocks.
 * 2. Try direct Yahoo Finance chart API.
 * 3. Try local yfinance fallback (.venv/bin/python) for local development or mini.
 * 4. Fall back to existing database price.
 */
async function fetchAndUpsertRecentPrices(
  ticker: string,
  dryRun = false
): Promise<{ ticker: string; latestPrice: number | null; priceDate: string | null; refreshed: boolean }> {
  const encoded = encodeURIComponent(ticker.trim().toUpperCase());

  // 1. Try relay gateway (production air7 service, works from Vercel Serverless)
  const gatewayBase = process.env.PI_GATEWAY_URL || "https://relay.air7.fun/pi";
  try {
    const gatewayUrl = `${gatewayBase.replace(/\/+$/, "")}/chart/${encoded}?range=10d`;
    const gRes = await fetch(gatewayUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (gRes.ok) {
      const gData = await gRes.json();
      const result = gData?.chart?.result?.[0];
      if (result) {
        return parseAndUpsertYahooBars(ticker, result, dryRun);
      }
    } else {
      console.warn(`[phase3-update] Gateway returned ${gRes.status} for ${ticker}`);
    }
  } catch (err) {
    console.warn(`[phase3-update] Gateway quote fetch failed for ${ticker}:`, err);
  }

  // 2. Direct Yahoo Finance chart API (fallback if gateway unavailable)
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?interval=1d&range=10d`;
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(4500),
    });

    if (res.ok) {
      const data = await res.json();
      const result = data?.chart?.result?.[0];
      if (result) {
        return parseAndUpsertYahooBars(ticker, result, dryRun);
      }
    } else {
      console.warn(`[phase3-update] Yahoo quote HTTP ${res.status} for ${ticker}`);
    }
  } catch (err) {
    console.warn(`[phase3-update] Yahoo quote fetch failed for ${ticker}:`, err);
  }

  // 3. Local Python yfinance (for local dev or mini machine)
  return tryYfinanceFallback(ticker, dryRun);
}

async function tryYfinanceFallback(
  ticker: string,
  dryRun = false
): Promise<{ ticker: string; latestPrice: number | null; priceDate: string | null; refreshed: boolean }> {
  try {
    const { existsSync, readFileSync, unlinkSync } = await import("node:fs");
    const { spawnSync } = await import("node:child_process");
    const python = existsSync(".venv/bin/python") ? ".venv/bin/python" : null;
    if (python) {
      const start = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
      const possibleJsonPaths = [
        `/tmp/stock-prices-yf/${ticker.toUpperCase()}.json`,
        `/tmp/stock-prices-yf/${ticker.toUpperCase().replace(/\.[A-Z]+$/, "")}.json`,
      ];
      const args = ["scripts/fetch-stock-prices-yf.py", "--ticker", ticker, "--start", start, "--keep-files"];
      const res = spawnSync(python, args, { encoding: "utf-8", timeout: 10000 });
      const foundPath = possibleJsonPaths.find((p) => existsSync(p));
      if (res.status === 0 && foundPath) {
        const raw = readFileSync(foundPath, "utf-8");
        unlinkSync(foundPath);
        // Clean up corresponding CSV if generated
        const csvPath = foundPath.replace(/\.json$/, ".csv");
        if (existsSync(csvPath)) unlinkSync(csvPath);

        const data = JSON.parse(raw);
        const result = data?.chart?.result?.[0];
        if (result) {
          return parseAndUpsertYahooBars(ticker, result, dryRun);
        }
      }
    }
  } catch (e) {
    console.warn(`[phase3-update] yfinance fallback failed for ${ticker}:`, e);
  }
  return getLatestPriceFromDb(ticker, false);
}

async function getLatestPriceFromDb(
  ticker: string,
  refreshed = false
): Promise<{ ticker: string; latestPrice: number | null; priceDate: string | null; refreshed: boolean }> {
  const row = await prisma.stockPrice.findFirst({
    where: { ticker },
    orderBy: { date: "desc" },
    select: { close: true, date: true },
  });
  return {
    ticker,
    latestPrice: row?.close ? Number(row.close.toString()) : null,
    priceDate: row?.date ? row.date.toISOString().slice(0, 10) : null,
    refreshed,
  };
}

/**
 * Deterministic fundamental red flag detection based on recent Financial data.
 * Zero LLM hallucination.
 */
async function detectFundamentalHealth(
  entityId: string,
  sector?: string | null
): Promise<{
  redFlags: Phase3RedFlag[];
  fundamentalHealth: "healthy" | "attention" | "warning";
  latestFY: number | null;
}> {
  const redFlags: Phase3RedFlag[] = [];

  const rows = await prisma.financial.findMany({
    where: { entityId, periodType: "FY" },
    orderBy: { periodEnd: "desc" },
    select: { lineItem: true, value: true, periodEnd: true },
    take: 30,
  });

  if (!rows.length) {
    return { redFlags, fundamentalHealth: "healthy", latestFY: null };
  }

  // Group by fiscal year end
  const byYearEnd = new Map<string, Record<string, number>>();
  for (const r of rows) {
    if (!r.value) continue;
    const dateKey = r.periodEnd.toISOString().slice(0, 10);
    const map = byYearEnd.get(dateKey) ?? {};
    map[r.lineItem] = Number(r.value.toString());
    byYearEnd.set(dateKey, map);
  }

  const sortedDates = [...byYearEnd.keys()].sort().reverse();
  const latestDate = sortedDates[0];
  const priorDate = sortedDates[1];

  const latest = latestDate ? byYearEnd.get(latestDate) : undefined;
  const prior = priorDate ? byYearEnd.get(priorDate) : undefined;
  const latestFY = latestDate ? parseInt(latestDate.slice(0, 4), 10) : null;

  if (latest) {
    const rev = latest.Revenue;
    const net = latest.NetIncome;
    const ocf = latest.OperatingCashFlow;
    const assets = latest.TotalAssets;
    const liab = latest.TotalLiabilities;

    // Rule 1: Cash Divergence (Revenue grew, but Cash Flow dropped significantly)
    if (prior && rev != null && prior.Revenue != null && ocf != null && prior.OperatingCashFlow != null) {
      const revGrowth = (rev - prior.Revenue) / Math.abs(prior.Revenue);
      const ocfGrowth = (ocf - prior.OperatingCashFlow) / Math.abs(prior.OperatingCashFlow);
      if (revGrowth > 0.03 && ocfGrowth < -0.15) {
        redFlags.push({
          code: "CASH_DIVERGENCE",
          level: "warning",
          title: "现金流背离预警",
          message: `营收同比增长 ${(revGrowth * 100).toFixed(1)}%，但经营现金流同比下滑 ${(Math.abs(ocfGrowth) * 100).toFixed(1)}%，需关注回款与营运资本占用。`,
        });
      }
    }

    // Rule 2: Low Cash Conversion (Net income is positive, but OCF is much lower)
    if (net != null && net > 0 && ocf != null) {
      const ratio = ocf / net;
      if (ratio < 0.65) {
        redFlags.push({
          code: "WEAK_CASH_CONVERSION",
          level: "warning",
          title: "造血转化率偏低",
          message: `经营现金流 / 净利润比率为 ${(ratio * 100).toFixed(0)}% (低于 65% 警戒线)，盈利质量需进一步穿透。`,
        });
      }
    }

    // Rule 3: High Leverage (Total Liabilities / Total Assets > 75%, skip banks/insurance)
    const isFinancialSector = sector?.toLowerCase().includes("bank") || sector?.toLowerCase().includes("insurance") || sector?.includes("银行") || sector?.includes("保险");
    if (!isFinancialSector && assets != null && assets > 0 && liab != null) {
      const debtRatio = (liab / assets) * 100;
      if (debtRatio > 78) {
        redFlags.push({
          code: "HIGH_LEVERAGE",
          level: "alert",
          title: "资产负债率高企",
          message: `总负债率达 ${debtRatio.toFixed(1)}%，在利率或宏观下行周期中需警惕偿债与再融资压力。`,
        });
      }
    }
  }

  const fundamentalHealth: "healthy" | "attention" | "warning" =
    redFlags.some((f) => f.level === "alert")
      ? "warning"
      : redFlags.length > 0
        ? "attention"
        : "healthy";

  return { redFlags, fundamentalHealth, latestFY };
}

/**
 * Generate a crisp, objective 1-2 sentence Phase 3 situational judgment.
 */
function buildSituationalSummary(params: {
  canonicalName: string;
  nameZh?: string | null;
  latestPrice: number | null;
  valuationStatus: "undervalued" | "fair" | "overvalued" | "insufficient";
  valuationDiffPct: number | null;
  fundamentalHealth: "healthy" | "attention" | "warning";
  redFlags: Phase3RedFlag[];
  latestFY: number | null;
}): string {
  const name = params.nameZh ?? params.canonicalName;
  let valText = "";
  if (params.valuationStatus === "undervalued" && params.valuationDiffPct != null) {
    valText = `当前市价处于估值走廊折价 ~${Math.abs(params.valuationDiffPct)}% 的价值击球区；`;
  } else if (params.valuationStatus === "overvalued" && params.valuationDiffPct != null) {
    valText = `当前市价处于估值偏高溢价区 (溢价 ~${params.valuationDiffPct}%)；`;
  } else if (params.valuationStatus === "fair") {
    valText = `当前市价处于合理估值中枢区间；`;
  } else {
    valText = `当前处于历史估值跟踪区间；`;
  }

  let healthText = "";
  if (params.fundamentalHealth === "healthy") {
    healthText = `最新财报经营造血与现金流稳健，未检测到基本面恶化信号。`;
  } else if (params.redFlags.length > 0) {
    healthText = params.redFlags.map((r) => r.title).join("、") + "，建议持续跟踪下一期披露。";
  } else {
    healthText = `基本面态势保持平稳。`;
  }

  return `${name}${valText}${healthText}`;
}

const SEC_HEADERS = {
  "User-Agent": "buffett-tribe research walkklaw@gmail.com",
  Accept: "application/json",
};

interface SyncIncrementalFilingsResult {
  newFilingsCount: number;
  newFilings: Array<{
    kind: string;
    form: string;
    periodLabel: string;
    filingDate: string;
    url: string;
  }>;
}

function computeFiscalPeriod(reportDateStr: string, fye = "1231", form = "10-Q") {
  const [yStr, mStr] = reportDateStr.split("-");
  const rYear = parseInt(yStr, 10);
  const rMonth = parseInt(mStr, 10);
  const fEndMonth = parseInt(fye.slice(0, 2), 10) || 12;

  let fiscalYear = rYear;
  if (fEndMonth !== 12 && rMonth > fEndMonth) {
    fiscalYear = rYear + 1;
  }

  let monthDiff = (rMonth - fEndMonth + 12) % 12;
  if (monthDiff === 0) monthDiff = 12;

  let quarter: number | null = Math.round(monthDiff / 3);
  if (quarter === 0) quarter = 4;

  if (form.startsWith("10-K") || form.startsWith("20-F") || form.startsWith("40-F")) {
    quarter = null;
  }

  return { fiscalYear, quarter };
}

const CHINESE_YEAR_MAP: Record<string, number> = {
  "二零二零": 2020, "二零二一": 2021, "二零二二": 2022, "二零二三": 2023,
  "二零二四": 2024, "二零二五": 2025, "二零二六": 2026, "二零二七": 2027,
};

function extractHkYear(title: string): number | null {
  for (const [k, v] of Object.entries(CHINESE_YEAR_MAP)) {
    if (title.includes(k)) return v;
  }
  const m = title.match(/(?:20\d{2})/);
  return m ? parseInt(m[0], 10) : null;
}

const CN_ANNUAL_RE = /^.*?(\d{4})年?年度报告$/;
const CN_INTERIM_RE = /^.*?(\d{4})年?半年度报告$/;
const CN_Q1_RE = /^.*?(\d{4})年?第一季度报告$/;
const CN_Q3_RE = /^.*?(\d{4})年?第三季度报告$/;
const HK_EXCLUDE_RE = /補充|補遺|澄清|股東特別大會|通函|董事會會議召開日期|股份發行人的證券變動月報表|摘要|建议|委任|变更/i;

async function syncUsIncrementalFilings(
  company: {
    id: string;
    cik: string | null;
    canonicalName: string;
    metadata: unknown;
  },
  dryRun = false
): Promise<SyncIncrementalFilingsResult> {
  const result: SyncIncrementalFilingsResult = { newFilingsCount: 0, newFilings: [] };
  if (!company.cik) return result;

  try {
    const paddedCik = company.cik.padStart(10, "0");
    const cleanCik = parseInt(company.cik, 10).toString();

    const existing = await prisma.extSource.findMany({
      where: {
        filerEntityId: company.id,
        kind: { in: ["10k", "10q", "20f", "40f"] },
      },
      select: { accessionNumber: true },
    });
    const existingAccessions = new Set(existing.map((e) => e.accessionNumber).filter(Boolean));

    const res = await fetch(`https://data.sec.gov/submissions/CIK${paddedCik}.json`, {
      headers: SEC_HEADERS,
      signal: AbortSignal.timeout(4000),
    });

    if (!res.ok) {
      console.warn(`[phase3-update] SEC submissions fetch returned ${res.status} for CIK ${company.cik}`);
      return result;
    }

    const data = await res.json();
    const fye = data.fiscalYearEnd || (company.metadata as Record<string, unknown>)?.fiscalYearEnd || "1231";
    const recent = data?.filings?.recent;
    if (!recent || !Array.isArray(recent.form)) return result;

    const toUpsert: Array<{
      kind: string;
      form: string;
      accessionNumber: string;
      periodYear: number;
      periodQuarter: number | null;
      filedAt: Date;
      reportDate: string;
      url: string;
      primaryDoc: string;
      periodLabel: string;
    }> = [];

    const targetForms = new Set(["10-Q", "10-Q/A", "10-K", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A"]);

    for (let i = 0; i < recent.form.length; i++) {
      const form = recent.form[i];
      if (!targetForms.has(form)) continue;

      const accn = recent.accessionNumber[i];
      if (!accn) continue;

      if (existingAccessions.has(accn)) break;
      if (toUpsert.length >= 8) break;

      const filingDate = recent.filingDate[i];
      const reportDate = recent.reportDate[i] || filingDate;
      const primaryDoc = recent.primaryDocument[i] || "";
      const { fiscalYear, quarter } = computeFiscalPeriod(reportDate, String(fye), form);

      const kind = form.startsWith("10-Q")
        ? "10q"
        : form.startsWith("20-F")
        ? "20f"
        : form.startsWith("40-F")
        ? "40f"
        : "10k";

      const accnClean = accn.replace(/-/g, "");
      const url = primaryDoc
        ? `https://www.sec.gov/Archives/edgar/data/${cleanCik}/${accnClean}/${primaryDoc}`
        : `https://www.sec.gov/cgi-bin/viewer?action=view&cik=${cleanCik}&accession_number=${accn}&xbrl_type=v`;

      const periodLabel = fiscalYear ? `${fiscalYear}${quarter ? ` Q${quarter}` : ""}` : "—";

      toUpsert.push({
        kind,
        form,
        accessionNumber: accn,
        periodYear: fiscalYear,
        periodQuarter: quarter,
        filedAt: new Date(filingDate),
        reportDate,
        url,
        primaryDoc,
        periodLabel,
      });
    }

    if (toUpsert.length > 0 && !dryRun) {
      for (const item of toUpsert) {
        await prisma.extSource.upsert({
          where: {
            ExtSource_filer_accession_unique: {
              filerEntityId: company.id,
              accessionNumber: item.accessionNumber,
            },
          },
          create: {
            kind: item.kind,
            filerEntityId: company.id,
            accessionNumber: item.accessionNumber,
            periodYear: item.periodYear,
            periodQuarter: item.periodQuarter,
            filedAt: item.filedAt,
            url: item.url,
            metadata: {
              form: item.form,
              accession: item.accessionNumber,
              accessionNumber: item.accessionNumber,
              primaryDocument: item.primaryDoc,
              reportDate: item.reportDate,
              filedAt: item.filedAt.toISOString().slice(0, 10),
              source: "sec-submissions-fast",
            },
          },
          update: {
            kind: item.kind,
            periodYear: item.periodYear,
            periodQuarter: item.periodQuarter,
            filedAt: item.filedAt,
            url: item.url,
          },
        });
      }
    }

    result.newFilingsCount = toUpsert.length;
    result.newFilings = toUpsert.map((u) => ({
      kind: u.kind,
      form: u.form,
      periodLabel: u.periodLabel,
      filingDate: u.filedAt.toISOString().slice(0, 10),
      url: u.url,
    }));
  } catch (err) {
    console.warn(`[phase3-update] US filing sync error for ${company.canonicalName}:`, err);
  }

  return result;
}

async function syncCnIncrementalFilings(
  company: {
    id: string;
    code: string | null;
    ticker: string | null;
    canonicalName: string;
  },
  dryRun = false
): Promise<SyncIncrementalFilingsResult> {
  const result: SyncIncrementalFilingsResult = { newFilingsCount: 0, newFilings: [] };
  const rawCode = (company.code || company.ticker?.split(".")[0] || "").trim();
  if (!rawCode || !/^\d{1,6}$/.test(rawCode)) return result;
  const code = rawCode.padStart(6, "0");
  const orgId = code.startsWith("6")
    ? `gssh0${code}`
    : code.startsWith("0") || code.startsWith("3")
    ? `gssz0${code}`
    : `gsbj${code}`;

  try {
    const existing = await prisma.extSource.findMany({
      where: {
        filerEntityId: company.id,
        kind: { in: ["cn-annual-report", "cn-interim-report", "cn-quarterly-report"] },
      },
      select: { accessionNumber: true },
    });
    const existingAccessions = new Set(existing.map((e) => e.accessionNumber).filter(Boolean));

    const fromDate = new Date(Date.now() - 540 * 86400000).toISOString().slice(0, 10);
    const toDate = new Date().toISOString().slice(0, 10);
    const queryUrl = "http://www.cninfo.com.cn/new/hisAnnouncement/query";
    const body = new URLSearchParams({
      pageNum: "1",
      pageSize: "50",
      column: "szse",
      tabName: "fulltext",
      plate: "",
      stock: `${code},${orgId}`,
      searchkey: "",
      category: "category_ndbg_szsh;category_bndbg_szsh;category_yjdbg_szsh;category_sjdbg_szsh",
      seDate: `${fromDate}~${toDate}`,
      isHLtitle: "false",
    });

    const res = await fetch(queryUrl, {
      method: "POST",
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
      signal: AbortSignal.timeout(4000),
    });

    if (!res.ok) {
      console.warn(`[phase3-update] cninfo returned status ${res.status} for ${code}`);
      return result;
    }

    const data = await res.json();
    const announcements = data.announcements || [];
    const toUpsert: Array<{
      kind: string;
      form: string;
      accessionNumber: string;
      periodYear: number;
      periodQuarter: number | null;
      filedAt: Date;
      url: string;
      title: string;
      periodLabel: string;
    }> = [];

    for (const item of announcements) {
      const title = String(item.announcementTitle || "");
      const adjunct = String(item.adjunctUrl || "");
      if (!adjunct || /摘要|英文版|英文|取消|更正|提示性公告/i.test(title)) continue;

      let periodYear: number | null = null;
      let periodQuarter: number | null = null;
      let kind = "";
      let form = "";

      const mAnnual = title.match(CN_ANNUAL_RE);
      const mInterim = title.match(CN_INTERIM_RE);
      const mQ1 = title.match(CN_Q1_RE);
      const mQ3 = title.match(CN_Q3_RE);

      if (mAnnual) {
        periodYear = parseInt(mAnnual[1], 10);
        periodQuarter = null;
        kind = "cn-annual-report";
        form = "年度报告";
      } else if (mInterim) {
        periodYear = parseInt(mInterim[1], 10);
        periodQuarter = 2;
        kind = "cn-interim-report";
        form = "半年度报告";
      } else if (mQ1) {
        periodYear = parseInt(mQ1[1], 10);
        periodQuarter = 1;
        kind = "cn-quarterly-report";
        form = "一季度报告";
      } else if (mQ3) {
        periodYear = parseInt(mQ3[1], 10);
        periodQuarter = 3;
        kind = "cn-quarterly-report";
        form = "三季度报告";
      } else {
        continue;
      }

      const qLabel = periodQuarter === 2 ? "h1" : periodQuarter ? `q${periodQuarter}` : "";
      const accessionNumber = qLabel ? `${kind}-${periodYear}-${qLabel}` : `${kind}-${periodYear}`;

      if (existingAccessions.has(accessionNumber)) continue;
      if (toUpsert.length >= 8) break;

      const url = adjunct.startsWith("http") ? adjunct : `http://static.cninfo.com.cn/${adjunct}`;
      const filedAt = item.announcementTime ? new Date(item.announcementTime) : new Date();
      const periodLabel = `${periodYear}${periodQuarter ? (periodQuarter === 2 ? " H1" : ` Q${periodQuarter}`) : ""}`;

      toUpsert.push({
        kind,
        form,
        accessionNumber,
        periodYear,
        periodQuarter,
        filedAt,
        url,
        title,
        periodLabel,
      });
    }

    if (toUpsert.length > 0 && !dryRun) {
      for (const item of toUpsert) {
        await prisma.extSource.upsert({
          where: {
            ExtSource_filer_accession_unique: {
              filerEntityId: company.id,
              accessionNumber: item.accessionNumber,
            },
          },
          create: {
            kind: item.kind,
            filerEntityId: company.id,
            accessionNumber: item.accessionNumber,
            periodYear: item.periodYear,
            periodQuarter: item.periodQuarter,
            filedAt: item.filedAt,
            url: item.url,
            metadata: {
              code,
              form: item.form,
              title: item.title,
              market: "cn",
              ticker: company.ticker,
              source: "cninfo-fast",
            },
          },
          update: {
            kind: item.kind,
            periodYear: item.periodYear,
            periodQuarter: item.periodQuarter,
            filedAt: item.filedAt,
            url: item.url,
          },
        });
      }
    }

    result.newFilingsCount = toUpsert.length;
    result.newFilings = toUpsert.map((u) => ({
      kind: u.kind,
      form: u.form,
      periodLabel: u.periodLabel,
      filingDate: u.filedAt.toISOString().slice(0, 10),
      url: u.url,
    }));
  } catch (err) {
    console.warn(`[phase3-update] CN filing sync error for ${company.canonicalName}:`, err);
  }

  return result;
}

async function syncHkIncrementalFilings(
  company: {
    id: string;
    code: string | null;
    ticker: string | null;
    canonicalName: string;
    metadata: unknown;
  },
  dryRun = false
): Promise<SyncIncrementalFilingsResult> {
  const result: SyncIncrementalFilingsResult = { newFilingsCount: 0, newFilings: [] };
  const rawCode = (company.code || company.ticker?.split(".")[0] || "").replace(/^0+/, "");
  if (!rawCode) return result;
  const normalizedCode = rawCode.padStart(5, "0");

  try {
    const existing = await prisma.extSource.findMany({
      where: {
        filerEntityId: company.id,
        kind: { in: ["hk-annual-report", "hk-interim-report", "hk-quarterly-report"] },
      },
      select: { accessionNumber: true },
    });
    const existingAccessions = new Set(existing.map((e) => e.accessionNumber).filter(Boolean));

    // 1. Resolve stockId (use cached from metadata if available)
    const meta = (company.metadata && typeof company.metadata === "object" ? company.metadata : {}) as Record<string, unknown>;
    let stockId = typeof meta.hkexStockId === "string" || typeof meta.hkexStockId === "number" ? String(meta.hkexStockId) : null;

    if (!stockId) {
      const prefixUrl = `https://www1.hkexnews.hk/search/prefix.do?callback=callback&lang=ZH&type=A&name=${normalizedCode}&market=SEHK`;
      const r1 = await fetch(prefixUrl, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(6000),
      });
      const text1 = await r1.text();
      const m1 = text1.trim().match(/^callback\(([\s\S]*)\);?$/);
      if (!m1) return result;
      const payload1 = JSON.parse(m1[1]);
      const stock = payload1.stockInfo?.find((s: Record<string, unknown>) => String(s.code).padStart(5, "0") === normalizedCode);
      if (!stock?.stockId) return result;
      stockId = String(stock.stockId);
      // Persist to entity metadata for future instant lookups
      if (!dryRun) {
        prisma.entity.update({
          where: { id: company.id },
          data: { metadata: { ...meta, hkexStockId: stockId } },
        }).catch(() => {});
      }
    }

    // 2. Query titleSearchServlet
    const fromDate = new Date(Date.now() - 540 * 86400000).toISOString().slice(0, 10).replace(/-/g, "");
    const toDate = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const queryUrl = "https://www1.hkexnews.hk/search/titleSearchServlet.do";
    const params = new URLSearchParams({
      sortDir: "0",
      sortByRecordDate: "on",
      category: "0",
      market: "SEHK",
      stockId,
      documentType: "-1",
      t1code: "40000",
      t2Gcode: "-2",
      t2code: "-2",
      from: fromDate,
      to: toDate,
      lang: "ZH",
      title: "",
    });

    const r2 = await fetch(`${queryUrl}?${params.toString()}`, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: "https://www1.hkexnews.hk/search/titlesearch.xhtml?lang=zh",
      },
      signal: AbortSignal.timeout(6500),
    });
    const data2 = await r2.json();
    const items = typeof data2.result === "string" ? JSON.parse(data2.result) : (data2.result || []);

    const toUpsert: Array<{
      kind: string;
      form: string;
      accessionNumber: string;
      periodYear: number;
      periodQuarter: number | null;
      filedAt: Date;
      url: string;
      title: string;
      periodLabel: string;
    }> = [];

    for (const item of items) {
      const title = String(item.TITLE || "");
      if (HK_EXCLUDE_RE.test(title)) continue;

      let kind = "";
      let form = "";
      let periodQuarter: number | null = null;

      if (/年報|年度報告|Annual Report/i.test(title)) {
        kind = "hk-annual-report";
        form = "年報";
        periodQuarter = null;
      } else if (/中期報告|半年度報告|Interim Report/i.test(title)) {
        kind = "hk-interim-report";
        form = "中期報告";
        periodQuarter = 2;
      } else if (/第一季度|第一季|First Quarter/i.test(title)) {
        kind = "hk-quarterly-report";
        form = "第一季度業績";
        periodQuarter = 1;
      } else if (/第三季度|第三季|Third Quarter/i.test(title)) {
        kind = "hk-quarterly-report";
        form = "第三季度業績";
        periodQuarter = 3;
      } else {
        continue;
      }

      const year = extractHkYear(title);
      if (!year) continue;

      const qLabel = periodQuarter === 2 ? "h1" : periodQuarter ? `q${periodQuarter}` : "";
      const accessionNumber = qLabel ? `${kind}-${year}-${qLabel}` : `${kind}-${year}`;

      if (existingAccessions.has(accessionNumber)) continue;
      if (toUpsert.length >= 8) break;

      const fileLink = String(item.FILE_LINK || "");
      const url = fileLink.startsWith("http") ? fileLink : `https://www1.hkexnews.hk${fileLink}`;

      let filedAt = new Date();
      if (item.DATE_TIME) {
        const parts = String(item.DATE_TIME).split(" ")[0].split("/");
        if (parts.length === 3) {
          filedAt = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
        }
      }

      const periodLabel = `${year}${periodQuarter ? (periodQuarter === 2 ? " H1" : ` Q${periodQuarter}`) : ""}`;

      toUpsert.push({
        kind,
        form,
        accessionNumber,
        periodYear: year,
        periodQuarter,
        filedAt,
        url,
        title,
        periodLabel,
      });
    }

    if (toUpsert.length > 0 && !dryRun) {
      for (const item of toUpsert) {
        await prisma.extSource.upsert({
          where: {
            ExtSource_filer_accession_unique: {
              filerEntityId: company.id,
              accessionNumber: item.accessionNumber,
            },
          },
          create: {
            kind: item.kind,
            filerEntityId: company.id,
            accessionNumber: item.accessionNumber,
            periodYear: item.periodYear,
            periodQuarter: item.periodQuarter,
            filedAt: item.filedAt,
            url: item.url,
            metadata: {
              code: normalizedCode,
              form: item.form,
              title: item.title,
              market: "hk",
              ticker: company.ticker,
              source: "hkex-fast",
            },
          },
          update: {
            kind: item.kind,
            periodYear: item.periodYear,
            periodQuarter: item.periodQuarter,
            filedAt: item.filedAt,
            url: item.url,
          },
        });
      }
    }

    result.newFilingsCount = toUpsert.length;
    result.newFilings = toUpsert.map((u) => ({
      kind: u.kind,
      form: u.form,
      periodLabel: u.periodLabel,
      filingDate: u.filedAt.toISOString().slice(0, 10),
      url: u.url,
    }));
  } catch (err) {
    console.warn(`[phase3-update] HK filing sync error for ${company.canonicalName}:`, err);
  }

  return result;
}

async function syncIncrementalFilingLinks(
  company: {
    id: string;
    cik: string | null;
    market: string | null;
    code: string | null;
    ticker: string | null;
    canonicalName: string;
    metadata: unknown;
  },
  dryRun = false
): Promise<SyncIncrementalFilingsResult> {
  const market = (company.market || (company.cik ? "us" : "")).toLowerCase();
  let result: SyncIncrementalFilingsResult = { newFilingsCount: 0, newFilings: [] };

  if (market === "us") {
    result = await syncUsIncrementalFilings(company, dryRun);
  } else if (market === "cn") {
    result = await syncCnIncrementalFilings(company, dryRun);
  } else if (market === "hk") {
    result = await syncHkIncrementalFilings(company, dryRun);
  }

  if (result.newFilingsCount > 0) {
    console.log(
      `[phase3-update] [${market.toUpperCase()}] Synced ${result.newFilingsCount} new filing link(s) for ${company.canonicalName}:`,
      result.newFilings.map((f) => `${f.periodLabel} (${f.form})`).join(", ")
    );
  }

  return result;
}

/**
 * Main Phase 3 Update Executor
 * - Refreshes stock price snapshot
 * - Recomputes deterministic valuation position
 * - Runs red flag detection
 * - Stores state into Entity metadata
 */
export async function runPhase3Update(
  options: Phase3UpdateOptions
): Promise<Phase3UpdateResult> {
  const startTime = Date.now();

  const { entityId, ticker, dryRun = false } = options;
  if (!entityId && !ticker) {
    throw new Error("必须提供 entityId 或 ticker");
  }

  // 1. Locate the Entity
  const entity = await prisma.entity.findFirst({
    where: {
      type: "company",
      ...(entityId ? { id: entityId } : {}),
      ...(ticker
        ? {
            OR: [
              { ticker: { equals: ticker.trim().toUpperCase(), mode: "insensitive" } },
              { securitiesAsCompany: { some: { ticker: { equals: ticker.trim().toUpperCase(), mode: "insensitive" } } } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      ticker: true,
      canonicalName: true,
      cik: true,
      market: true,
      code: true,
      sector: true,
      onboardPhase: true,
      priority: true,
      priorityRequestedAt: true,
      metadata: true,
      securitiesAsCompany: {
        select: { ticker: true },
      },
    },
  });

  if (!entity) {
    throw new Error(`未找到标的: ${entityId || ticker}`);
  }

  if (entity.onboardPhase < 2 && !dryRun) {
    throw new Error(
      `标的 [${entity.ticker || entity.canonicalName}] 当前处于 Phase ${entity.onboardPhase}，尚未完成 Phase 2 深度研报。请先通过 '⚡深析' 完成 P2 建档。`
    );
  }

  // Collect all distinct tickers associated with this company
  const distinctTickers = Array.from(
    new Set(
      [
        ticker?.trim().toUpperCase(),
        entity.ticker?.trim().toUpperCase(),
        ...(entity.securitiesAsCompany?.map((s) => s.ticker?.trim().toUpperCase()) || []),
      ].filter((t): t is string => Boolean(t))
    )
  );

  if (distinctTickers.length === 0) {
    throw new Error(`标的 [${entity.canonicalName}] 缺少有效交易代码 (ticker)`);
  }

  // Determine the primary ticker (prefer explicitly requested ticker if valid, else entity.ticker or first)
  const normalizedRequested = ticker?.trim().toUpperCase();
  const primaryTicker =
    (normalizedRequested && distinctTickers.includes(normalizedRequested)
      ? normalizedRequested
      : null) ??
    entity.ticker?.trim().toUpperCase() ??
    distinctTickers[0];

  const meta = (entity.metadata as Record<string, unknown>) || {};
  const nameZh = typeof meta.nameZh === "string" ? meta.nameZh : null;

  // 2. Parallel: Refresh Stock Prices for ALL tickers + Discover & Link Incremental Filings (US/CN/HK)
  const [priceResults, filingsSyncResult] = await Promise.all([
    Promise.all(distinctTickers.map((t) => fetchAndUpsertRecentPrices(t, dryRun))),
    syncIncrementalFilingLinks(
      {
        id: entity.id,
        cik: entity.cik,
        market: entity.market,
        code: entity.code,
        ticker: entity.ticker,
        canonicalName: entity.canonicalName,
        metadata: entity.metadata,
      },
      dryRun
    ),
  ]);

  const primaryPriceInfo =
    priceResults.find((p) => p.ticker === primaryTicker) ??
    priceResults[0];

  // 3. Compute Valuation Metrics & Corridor Position for primaryTicker
  const metrics = await computeValuationMetrics({
    entityId: entity.id,
    ticker: primaryTicker,
  });

  const latestPrice = primaryPriceInfo.latestPrice ?? metrics?.latestPrice ?? null;
  const currentPe = metrics?.pe?.current ?? null;
  const benchmarkPe = metrics?.pe?.median ?? null;

  let valuationStatus: Phase3UpdateResult["valuationStatus"] = "fair";
  let valuationDiffPct: number | null = null;

  if (currentPe != null && benchmarkPe != null && benchmarkPe > 0) {
    const diff = ((currentPe - benchmarkPe) / benchmarkPe) * 100;
    valuationDiffPct = Math.round(diff);
    if (diff <= -12) {
      valuationStatus = "undervalued";
    } else if (diff >= 15) {
      valuationStatus = "overvalued";
    } else {
      valuationStatus = "fair";
    }
  } else if (!currentPe || !benchmarkPe) {
    valuationStatus = "insufficient";
  }

  // 4. Fundamental Health & Red Flag Detector
  const healthInfo = await detectFundamentalHealth(entity.id, entity.sector);

  // 5. Build Situational Summary
  const summary = buildSituationalSummary({
    canonicalName: entity.canonicalName,
    nameZh,
    latestPrice,
    valuationStatus,
    valuationDiffPct,
    fundamentalHealth: healthInfo.fundamentalHealth,
    redFlags: healthInfo.redFlags,
    latestFY: healthInfo.latestFY,
  });

  const nowIso = new Date().toISOString();

  // 6. Update Entity metadata & Enqueue Fast-Track P3 Task (if new filings discovered or requested)
  const shouldEnqueueP3 =
    (filingsSyncResult.newFilingsCount > 0 || Boolean(options.enqueueP3)) && entity.onboardPhase >= 2;
  const nextPriority = shouldEnqueueP3 ? Math.max(entity.priority ?? 0, 100) : undefined;
  const nextPriorityRequestedAt = shouldEnqueueP3 ? new Date() : undefined;

  const nextMeta: Record<string, unknown> = {
    ...meta,
    lastP3UpdateAt: nowIso,
    ...(shouldEnqueueP3
      ? {
          fastTrack: true,
          p3Pending: true,
          p3PendingReason: filingsSyncResult.newFilingsCount > 0 ? "new_filings_detected" : "manual_enqueue",
          p3PendingFilings: filingsSyncResult.newFilings,
          p3PendingAt: nowIso,
        }
      : {}),
    p3: {
      updatedAt: nowIso,
      primaryTicker,
      refreshedTickers: distinctTickers,
      latestPrice,
      priceDate: primaryPriceInfo.priceDate,
      valuationStatus,
      valuationDiffPct,
      currentPe,
      benchmarkPe,
      redFlags: healthInfo.redFlags,
      fundamentalHealth: healthInfo.fundamentalHealth,
      summary,
      newFilingsCount: filingsSyncResult.newFilingsCount,
      latestFilingsSyncAt: nowIso,
      p3Enqueued: shouldEnqueueP3,
    },
  };

  if (!dryRun) {
    await prisma.entity.update({
      where: { id: entity.id },
      data: {
        updatedAt: new Date(),
        ...(nextPriority != null ? { priority: nextPriority } : {}),
        ...(nextPriorityRequestedAt != null ? { priorityRequestedAt: nextPriorityRequestedAt } : {}),
        metadata: nextMeta as unknown as Prisma.InputJsonValue,
      },
    });
  }

  const durationMs = Date.now() - startTime;

  return {
    success: true,
    entityId: entity.id,
    ticker: primaryTicker,
    allTickers: distinctTickers,
    canonicalName: entity.canonicalName,
    nameZh,
    onboardPhase: entity.onboardPhase,
    latestPrice,
    priceDate: primaryPriceInfo.priceDate,
    priceRefreshed: primaryPriceInfo.refreshed,
    currentPe,
    benchmarkPe,
    valuationStatus,
    valuationDiffPct,
    redFlags: healthInfo.redFlags,
    fundamentalHealth: healthInfo.fundamentalHealth,
    summary,
    newFilingsCount: filingsSyncResult.newFilingsCount,
    newFilings: filingsSyncResult.newFilings,
    p3Enqueued: shouldEnqueueP3,
    updatedAt: nowIso,
    durationMs,
  };
}
