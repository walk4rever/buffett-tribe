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
      sector: true,
      onboardPhase: true,
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

  // 2. Refresh Stock Prices for ALL tickers of this company in parallel
  const priceResults = await Promise.all(
    distinctTickers.map((t) => fetchAndUpsertRecentPrices(t, dryRun))
  );

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

  // 6. Update Entity metadata (unless dryRun)
  if (!dryRun) {
    await prisma.entity.update({
      where: { id: entity.id },
      data: {
        updatedAt: new Date(),
        metadata: {
          ...meta,
          lastP3UpdateAt: nowIso,
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
          },
        } as unknown as Prisma.InputJsonValue,
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
    updatedAt: nowIso,
    durationMs,
  };
}
