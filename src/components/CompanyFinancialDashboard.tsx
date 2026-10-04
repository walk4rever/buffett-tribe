"use client";

import type {
  CompanyFinancialDashboard as DashboardType,
  FinancialDashboardTrend,
  FinancialYearItems,
} from "@/lib/company-financial-dashboard";
import { FINANCIAL_DATA_START_YEAR } from "@/lib/financial-period";

export interface CompanyFinancialDashboardProps {
  dashboard: DashboardType;
  financials: FinancialYearItems[];
}

function formatFiscalDate(date: Date | null) {
  if (!date) return "—";
  return date.toISOString().slice(0, 10);
}

function getFiscalDate(financials: FinancialYearItems[], year: number) {
  const row = financials.find((financial) => financial.year === year);
  return row?.periodEnd ?? null;
}

function getTrendCoordinates(trend: FinancialDashboardTrend) {
  const width = 240;
  const height = 54;
  const inset = 5;
  const values = trend.points.flatMap((point) => point.value == null ? [] : [point.value]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  return trend.points.map((point, index) => ({
    ...point,
    x: trend.points.length <= 1
      ? width / 2
      : inset + (index / (trend.points.length - 1)) * (width - inset * 2),
    y: point.value == null
      ? null
      : height - inset - ((point.value - min) / range) * (height - inset * 2),
  }));
}

function getTrendPaths(trend: FinancialDashboardTrend) {
  const coordinates = getTrendCoordinates(trend);
  const paths: string[] = [];
  let currentPath: string[] = [];

  for (const point of coordinates) {
    if (point.y == null) {
      if (currentPath.length) paths.push(currentPath.join(" "));
      currentPath = [];
      continue;
    }

    currentPath.push(`${currentPath.length ? "L" : "M"}${point.x},${point.y}`);
  }

  if (currentPath.length) paths.push(currentPath.join(" "));
  return { coordinates, paths };
}

function FinancialTrendChart({ trend }: { trend: FinancialDashboardTrend }) {
  const { coordinates, paths } = getTrendPaths(trend);
  const startYear = trend.points[0]?.year;
  const endYear = trend.points[trend.points.length - 1]?.year;

  return (
    <article className="company-financial-trend-card">
      <div className="company-financial-trend-card-head">
        <h4>{trend.label}</h4>
        <strong>{trend.latestPoint?.formatted ?? "暂无有效数据"}</strong>
      </div>
      <span className="company-financial-trend-latest">
        {trend.latestPoint ? `FY ${trend.latestPoint.year}` : "等待可比数据"}
      </span>
      <svg
        className="company-financial-sparkline"
        viewBox="0 0 240 54"
        preserveAspectRatio="none"
        role="img"
        aria-label={`${trend.label}年度趋势，${startYear ?? ""}年至${endYear ?? ""}年`}
      >
        <path className="company-financial-sparkline-guide" d="M5 49 H235" />
        {paths.map((path, index) => (
          <path className="company-financial-sparkline-line" d={path} key={`${trend.key}-${index}`} />
        ))}
        {coordinates.flatMap((point) => point.y == null ? [] : [
          <circle
            className="company-financial-sparkline-point"
            cx={point.x}
            cy={point.y}
            key={`${trend.key}-${point.year}`}
            r="2.8"
          />,
        ])}
      </svg>
      <div className="company-financial-trend-years" aria-hidden="true">
        <span>{startYear ? `FY ${startYear}` : ""}</span>
        <span>{endYear && endYear !== startYear ? `FY ${endYear}` : ""}</span>
      </div>
    </article>
  );
}

export function CompanyFinancialDashboardComponent({
  dashboard,
  financials,
}: CompanyFinancialDashboardProps) {
  const { displayYears, trendYears } = dashboard;
  const yearRange = displayYears.length
    ? `${Math.min(...displayYears)}–${Math.max(...displayYears)}`
    : "";
  const trendRange = trendYears.length
    ? `${Math.min(...trendYears)}–${Math.max(...trendYears)}`
    : "";

  if (!displayYears.length) {
    return (
      <div className="company-financial-dashboard-root">
        <p className="company-empty company-financial-empty">
          暂无 FY {FINANCIAL_DATA_START_YEAR} 及以后年度财务数据。
        </p>
      </div>
    );
  }

  return (
    <div className="company-financial-dashboard-root">
      <section className="company-financial-trends" aria-labelledby="financial-trends-title">
        <div className="company-financial-trend-head">
          <h3 id="financial-trends-title">关键指标趋势</h3>
        </div>

        {dashboard.trends.length ? (
          <div className="company-financial-trend-grid">
            {dashboard.trends.map((trend) => (
              <FinancialTrendChart key={trend.key} trend={trend} />
            ))}
          </div>
        ) : (
          <p className="company-empty">趋势数据不足。</p>
        )}
        <p className="company-financial-method-note">
          年度口径自 FY {FINANCIAL_DATA_START_YEAR} 起；趋势 FY {trendRange}（{trendYears.length} 年）。{dashboard.templateNote}
        </p>
      </section>

      <section className="company-financial-history" aria-labelledby="financial-history-title">
        <div className="company-financial-trend-head">
          <h3 id="financial-history-title">年度明细</h3>
        </div>
        <p className="company-financial-method-note">
          明细 FY {yearRange}（{displayYears.length} 年）；缺少必要输入时显示“—”，同比不跨年补算，不以零填补。
        </p>

        {dashboard.rows.length ? (
          <div
            className="company-table-wrap company-financial-table-wrap"
            role="region"
            aria-label="年度财务数据，可横向滚动查看"
            tabIndex={0}
          >
            <table className="company-table company-financial-table">
              <thead>
                <tr>
                  <th scope="col">
                    <span className="company-table-label">指标</span>
                    <span className="company-table-sub">Metric</span>
                  </th>
                  {displayYears.map((year) => (
                    <th key={year} scope="col">
                      <span className="company-table-label">FY {year}</span>
                      <span className="company-table-sub">
                        {formatFiscalDate(getFiscalDate(financials, year))}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dashboard.rows.map((row) => (
                  <tr key={row.key}>
                    <th scope="row" title={row.hint}>
                      <span className="company-table-label">{row.zhLabel}</span>
                      <span className="company-table-sub">{row.enLabel}</span>
                    </th>
                    {displayYears.map((year) => (
                      <td key={`${row.key}-${year}`}>{row.values[year] ?? "—"}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="company-empty">暂无年度明细。</p>
        )}
      </section>
    </div>
  );
}
