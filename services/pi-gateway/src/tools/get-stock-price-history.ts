import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { pool } from "../db.js";
import { findEntity } from "./find-entity.js";

type PriceRow = {
  ticker: string;
  date: string;
  close: string;
  high: string | null;
  low: string | null;
  volume: string | null;
};

async function queryStockPrices(ticker: string): Promise<PriceRow[]> {
  const cleanTicker = ticker.trim().toUpperCase();
  // Strip exchange suffix if provided (e.g. AAPL.US -> AAPL, 600519.SS -> 600519)
  const baseTicker = cleanTicker.replace(/\.(US|SS|SH|SZ|HK)$/i, "");

  const sql = `
    SELECT
      ticker,
      to_char(date, 'YYYY-MM-DD') AS date,
      close::text,
      high::text,
      low::text,
      volume::text
    FROM "StockPrice"
    WHERE (
      UPPER(ticker) = $1
      OR UPPER(ticker) = $2
      OR UPPER(ticker) LIKE $2 || '.%'
      OR UPPER(ticker) LIKE '%' || $2
    )
    ORDER BY date DESC
    LIMIT 365
  `;

  const result = await pool.query<PriceRow>(sql, [cleanTicker, baseTicker]);
  return result.rows;
}

function formatPercent(pct: number): string {
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

export function formatPriceHistory(companyLabel: string, rows: PriceRow[]): string {
  if (rows.length === 0) {
    return `未在数据库中找到 ${companyLabel} 的历史股价记录。`;
  }

  const latest = rows[0];
  const latestClose = Number(latest.close);

  let high52 = -Infinity;
  let high52Date = "";
  let low52 = Infinity;
  let low52Date = "";

  for (const r of rows) {
    const highVal = r.high != null ? Number(r.high) : Number(r.close);
    const lowVal = r.low != null ? Number(r.low) : Number(r.close);
    if (!isNaN(highVal) && highVal > high52) {
      high52 = highVal;
      high52Date = r.date;
    }
    if (!isNaN(lowVal) && lowVal < low52) {
      low52 = lowVal;
      low52Date = r.date;
    }
  }

  // Find price 30 days ago, 90 days ago, 365 days ago (or closest earlier)
  const latestDateObj = new Date(latest.date);
  function findPriceNear(daysAgo: number): number | null {
    const targetMs = latestDateObj.getTime() - daysAgo * 24 * 60 * 60 * 1000;
    for (let i = 0; i < rows.length; i++) {
      const rowMs = new Date(rows[i].date).getTime();
      if (rowMs <= targetMs) {
        return Number(rows[i].close);
      }
    }
    return rows.length > 0 ? Number(rows[rows.length - 1].close) : null;
  }

  const price30d = findPriceNear(30);
  const price90d = findPriceNear(90);
  const price1y = findPriceNear(365);

  const diffHighPct = high52 > 0 ? ((latestClose - high52) / high52) * 100 : null;
  const diffLowPct = low52 > 0 ? ((latestClose - low52) / low52) * 100 : null;
  const change30dPct = price30d != null && price30d > 0 ? ((latestClose - price30d) / price30d) * 100 : null;
  const change90dPct = price90d != null && price90d > 0 ? ((latestClose - price90d) / price90d) * 100 : null;
  const change1yPct = price1y != null && price1y > 0 ? ((latestClose - price1y) / price1y) * 100 : null;

  // Sample weekly points (every ~5 trading days, up to 8 points)
  const samples: string[] = [];
  for (let i = 0; i < Math.min(rows.length, 45); i += 5) {
    samples.push(`- ${rows[i].date}: ${Number(rows[i].close).toFixed(2)}`);
  }

  const lines: string[] = [
    `### ${companyLabel} 股价与走势概况`,
    `- **最新收盘价**: ${latestClose.toFixed(2)} (统计截至: ${latest.date})`,
    `- **52周价格区间**: 最低 ${low52.toFixed(2)} (${low52Date}) ~ 最高 ${high52.toFixed(2)} (${high52Date})`,
    `- **当前位置**: 距52周最高点 ${diffHighPct != null ? formatPercent(diffHighPct) : "N/A"}，距52周最低点 ${diffLowPct != null ? formatPercent(diffLowPct) : "N/A"}`,
    `- **阶段涨跌幅**:`,
    `  - 近 1 个月: ${change30dPct != null ? formatPercent(change30dPct) : "N/A"}`,
    `  - 近 3 个月: ${change90dPct != null ? formatPercent(change90dPct) : "N/A"}`,
    `  - 近 1 年: ${change1yPct != null ? formatPercent(change1yPct) : "N/A"}`,
    ``,
    `#### 近期收盘价抽样轨迹 (周度)`,
    ...samples,
  ];

  return lines.join("\n");
}

export const getStockPriceHistoryTool = defineTool({
  name: "get_stock_price_history",
  label: "Get Stock Price History",
  description:
    "Fetch recent stock price levels, 52-week high/low range, and 1-month/3-month/1-year performance trends for a company. Use this whenever the user asks about recent price movement, current valuation context, 52-week position, or historical price trajectory.",
  promptSnippet: "get_stock_price_history(company) → latest price, 52-week high/low, and recent trend",
  parameters: Type.Object({
    company: Type.String({
      description: "Company ticker (e.g. AAPL, 600519, 00700) or name in Chinese/English (e.g. 苹果, 贵州茅台, 腾讯控股)",
    }),
  }),
  async execute(_toolCallId, params, signal) {
    const { company } = params;

    let targetTicker = company.trim().toUpperCase();
    let companyLabel = company;

    try {
      const entity = await findEntity(company);
      if (entity?.ticker) {
        targetTicker = entity.ticker.toUpperCase();
        companyLabel = `${entity.name ?? company} (${targetTicker})`;
      }
    } catch {
      // Fall back to direct ticker search if findEntity errors
    }

    if (signal?.aborted) {
      return { content: [{ type: "text" as const, text: "Cancelled." }], details: null };
    }

    try {
      const rows = await queryStockPrices(targetTicker);
      const text = formatPriceHistory(companyLabel, rows);
      return {
        content: [{ type: "text" as const, text }],
        details: { count: rows.length, ticker: targetTicker },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `获取股价历史失败: ${msg}` }],
        details: null,
      };
    }
  },
});
