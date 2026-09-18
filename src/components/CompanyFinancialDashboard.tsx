"use client";

import { useState } from "react";
import type {
  CompanyFinancialDashboard as DashboardType,
  FinancialYearItems,
} from "@/lib/company-financial-dashboard";
import type { FinancialQuarterItems, TtmMetrics } from "@/lib/ttm-metrics";
import { formatMoneyInYi } from "@/lib/currency";

export interface CompanyFinancialDashboardProps {
  dashboard: DashboardType;
  financials: FinancialYearItems[];
  quarterlyFinancials: FinancialQuarterItems[];
  ttmMetrics: TtmMetrics | null;
  currency: string | null;
  emptyMessage: string;
}

function formatFiscalDate(date: Date | null) {
  if (!date) return "—";
  return date.toISOString().slice(0, 10);
}

function getFiscalDate(financials: FinancialYearItems[], year: number) {
  const row = financials.find((f) => f.year === year);
  return row?.periodEnd ?? null;
}

const QUARTERLY_METRIC_ROWS = [
  { key: "Revenue", zhLabel: "营业收入", enLabel: "Revenue", isMoney: true },
  { key: "GrossProfit", zhLabel: "毛利润", enLabel: "Gross Profit", isMoney: true },
  { key: "OperatingIncome", zhLabel: "营业利润", enLabel: "Operating Income", isMoney: true },
  { key: "NetIncome", zhLabel: "归母净利润", enLabel: "Net Income", isMoney: true },
  { key: "OperatingCashFlow", zhLabel: "经营活动现金流", enLabel: "Operating Cash Flow", isMoney: true },
  { key: "CapEx", zhLabel: "资本支出 (CapEx)", enLabel: "Capital Expenditures", isMoney: true },
  { key: "EPSDiluted", zhLabel: "摊薄每股收益", enLabel: "Diluted EPS", isMoney: false },
  { key: "TotalAssets", zhLabel: "资产总计", enLabel: "Total Assets", isMoney: true },
  { key: "TotalLiabilities", zhLabel: "负债合计", enLabel: "Total Liabilities", isMoney: true },
  { key: "ShareholdersEquity", zhLabel: "股东权益", enLabel: "Shareholders Equity", isMoney: true },
];

export function CompanyFinancialDashboardComponent({
  dashboard,
  financials,
  quarterlyFinancials,
  ttmMetrics,
  currency,
  emptyMessage,
}: CompanyFinancialDashboardProps) {
  const [viewMode, setViewMode] = useState<"annual" | "quarterly">("annual");

  const displayYears = dashboard.displayYears;
  const hasQuarterlyData = quarterlyFinancials.length > 0;

  // Render cards: prefer TTM cards if isTtm is true
  const renderCards = () => {
    if (ttmMetrics && ttmMetrics.isTtm) {
      return [
        {
          key: "rev-ttm",
          label: "营业收入 (TTM)",
          value: ttmMetrics.revenue != null ? formatMoneyInYi(ttmMetrics.revenue, currency) : "—",
          hint: "滚动 12 个月累计",
        },
        {
          key: "ni-ttm",
          label: "归母净利润 (TTM)",
          value: ttmMetrics.netIncome != null ? formatMoneyInYi(ttmMetrics.netIncome, currency) : "—",
          hint: "滚动 12 个月累计",
        },
        {
          key: "pe-ttm",
          label: "市盈率 PE (TTM)",
          value: ttmMetrics.peTtm != null ? `${ttmMetrics.peTtm}x` : "—",
          hint: ttmMetrics.latestPrice ? `当前股价 ¥${ttmMetrics.latestPrice}` : "动态市盈率",
        },
        {
          key: "margin-ttm",
          label: "净利率 (TTM)",
          value: ttmMetrics.netMarginPct != null ? `${ttmMetrics.netMarginPct}%` : "—",
          hint: "净利润 / 营业收入",
        },
        {
          key: "roe-ttm",
          label: "净资产收益率 ROE",
          value: ttmMetrics.roePct != null ? `${ttmMetrics.roePct}%` : "—",
          hint: "TTM 净利润 / 最新净资产",
        },
        {
          key: "fcf-ttm",
          label: "自由现金流 (TTM)",
          value: ttmMetrics.freeCashFlow != null ? formatMoneyInYi(ttmMetrics.freeCashFlow, currency) : "—",
          hint: "经营现金流 - 资本支出",
        },
      ];
    }

    return dashboard.cards;
  };

  const cards = renderCards();

  const formatQuarterValue = (valStr: string | undefined, isMoney: boolean) => {
    if (!valStr) return "—";
    const n = Number(valStr);
    if (!Number.isFinite(n)) return "—";
    if (isMoney) return formatMoneyInYi(n, currency);
    return n.toFixed(2);
  };

  return (
    <div className="company-financial-dashboard-root">
      {ttmMetrics ? (
        <div className="company-ttm-banner">
          <span className="company-ttm-pill">{ttmMetrics.isTtm ? "TTM 动态追踪" : "年报基准"}</span>
          <span className="company-ttm-desc">
            {ttmMetrics.isTtm
              ? `滚动 12 个月（截至 ${ttmMetrics.asOfPeriod} · ${ttmMetrics.asOfDate}，涵盖 ${ttmMetrics.periodsIncluded.map((p) => p.label).join(" + ")}）`
              : `最新完整财年 · ${ttmMetrics.asOfPeriod}（截至 ${ttmMetrics.asOfDate}）`}
          </span>
        </div>
      ) : null}

      <div className="company-kpi-grid">
        {cards.map((card) => (
          <article className="company-kpi-card" key={card.key}>
            <p>{card.label}</p>
            <strong>{card.value}</strong>
            <span>{card.hint}</span>
          </article>
        ))}
      </div>

      <div className="company-financial-trend-head">
        <div className="company-financial-trend-title-row">
          <h3>趋势证据</h3>
          {hasQuarterlyData ? (
            <div className="company-view-toggle" role="group" aria-label="报表周期切换">
              <button
                type="button"
                className={`company-view-toggle-btn ${viewMode === "annual" ? "company-view-toggle-btn--active" : ""}`}
                onClick={() => setViewMode("annual")}
              >
                年度 (FY)
              </button>
              <button
                type="button"
                className={`company-view-toggle-btn ${viewMode === "quarterly" ? "company-view-toggle-btn--active" : ""}`}
                onClick={() => setViewMode("quarterly")}
              >
                单季 (Quarterly)
              </button>
            </div>
          ) : null}
        </div>
        <span>
          {viewMode === "annual"
            ? displayYears.length
              ? `${displayYears[displayYears.length - 1]}–${displayYears[0]}`
              : ""
            : quarterlyFinancials.length
              ? `${quarterlyFinancials[quarterlyFinancials.length - 1].periodLabel} → ${quarterlyFinancials[0].periodLabel}`
              : ""}
        </span>
      </div>

      {viewMode === "annual" ? (
        displayYears.length ? (
          <div className="company-table-wrap">
            <table className="company-table">
              <thead>
                <tr>
                  <th>
                    <span className="company-table-label">指标</span>
                    <span className="company-table-sub">Metric</span>
                  </th>
                  {displayYears.map((year) => (
                    <th key={year}>
                      <span className="company-table-label">FY {year}</span>
                      <span className="company-table-sub">
                        {formatFiscalDate(getFiscalDate(financials, year))}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dashboard.rows.map((line) => (
                  <tr key={line.key}>
                    <td>
                      <span className="company-table-label">{line.zhLabel}</span>
                      <span className="company-table-sub">{line.enLabel}</span>
                    </td>
                    {displayYears.map((year) => (
                      <td key={`${line.key}-${year}`}>{line.values[year] ?? "—"}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="company-empty">{emptyMessage}</p>
        )
      ) : (
        /* Quarterly View */
        <div className="company-table-wrap">
          <table className="company-table">
            <thead>
              <tr>
                <th>
                  <span className="company-table-label">单季指标</span>
                  <span className="company-table-sub">Quarterly Metric</span>
                </th>
                {quarterlyFinancials.map((q) => (
                  <th key={`${q.periodLabel}-${q.periodEnd.toISOString()}`}>
                    <span className="company-table-label">{q.periodLabel}</span>
                    <span className="company-table-sub">{formatFiscalDate(q.periodEnd)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {QUARTERLY_METRIC_ROWS.map((row) => (
                <tr key={row.key}>
                  <td>
                    <span className="company-table-label">{row.zhLabel}</span>
                    <span className="company-table-sub">{row.enLabel}</span>
                  </td>
                  {quarterlyFinancials.map((q) => (
                    <td key={`${row.key}-${q.periodLabel}`}>
                      {formatQuarterValue(q.items[row.key], row.isMoney)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {viewMode === "annual" && dashboard.longTermTrends.length ? (
        <div className="company-long-term-block" aria-label="长期趋势摘要">
          <div className="company-financial-trend-head">
            <h3>长期复合增长</h3>
          </div>
          <div className="company-long-term-trends">
            {dashboard.longTermTrends.map((trend) => (
              <article key={trend.key}>
                <span>{trend.label}</span>
                <strong>{trend.value}</strong>
                <small>{trend.hint}</small>
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
