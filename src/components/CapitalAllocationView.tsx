"use client";

import { useMemo, useState } from "react";
import type { ValueLineData } from "@/lib/value-line-data";
import { currencySymbol, formatUsdInYi } from "@/lib/currency";
import { computeCapitalAllocationStats } from "@/lib/capital-allocation-metrics";
import { getCapitalAllocationShareSeries } from "@/lib/share-count-utils";
import {
  getDefaultFinancialModel,
  resolveFinancialModel,
} from "@/lib/financial-model";

type CapitalAllocationViewProps = {
  data: ValueLineData;
};

/**
 * Catmull-Rom to Cubic Bezier Spline for smooth share count curves
 */
function buildSmoothSpline(pts: Array<{ x: number; y: number }>): string {
  if (!pts.length) return "";
  if (pts.length === 1)
    return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 5.5;
    const cp1y = p1.y + (p2.y - p0.y) / 5.5;
    const cp2x = p2.x - (p3.x - p1.x) / 5.5;
    const cp2y = p2.y - (p3.y - p1.y) / 5.5;
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

export function CapitalAllocationView({ data }: CapitalAllocationViewProps) {
  const financialModel =
    data.financialModel ??
    resolveFinancialModel(data.sectorModelType) ??
    getDefaultFinancialModel();
  const allocationModel = financialModel.capitalAllocationModel;
  const showIndustrialCashFlow = financialModel.showIndustrialCashFlow;
  const isInsurance = financialModel.template === "insurance";
  const isShareholderReturnModel =
    allocationModel !== "operating_cashflow" &&
    allocationModel !== "group_returns";
  const displayCurrency = data.tradingCurrency;
  const currencySym = displayCurrency ? currencySymbol(displayCurrency) : "";
  const [hoverYearIdx, setHoverYearIdx] = useState<number | null>(null);

  const stats = useMemo(() => {
    return computeCapitalAllocationStats(data.annuals || []);
  }, [data.annuals]);

  if (!stats) {
    return (
      <div className="company-placeholder-grid">
        <article className="company-placeholder-card">
          <h3>资本配置历史数据不足</h3>
          <p>
            该标的暂无连续多期现金流与股本明细，待更多年度财报入库后自动生成资本配置全景总账。
          </p>
        </article>
      </div>
    );
  }

  const periodCountLabel = `${stats.periodCount} 个已披露财年`;
  const flowCoverageLabel = !showIndustrialCashFlow
    ? "工商业现金流指标不适用"
    : `${stats.flowCoverage}/${stats.periodCount} 年 OCF 与 CapEx 数据完整`;
  const roeCoverage = stats.annuals.filter(
    (annual) => annual.roe != null,
  ).length;
  const latestRoeAnnual = stats.annuals.findLast(
    (annual) => annual.roe != null,
  );
  const shareDeltaText =
    stats.shareDeltaPct == null
      ? "—"
      : `${stats.shareDeltaPct > 0 ? "+" : ""}${stats.shareDeltaPct}%`;
  const shareDesc = "股数净变动不等同于回购注销。";
  const formatAmount = (value: number | null) =>
    value == null
      ? "—"
      : `${currencySym ? `${currencySym} ` : ""}${formatUsdInYi(value)}`;
  const getDisclosureStatus = (
    coverage: number,
    total: number,
    amount: number | null,
    kind: "回购" | "分红",
  ) => {
    if (coverage === 0) return "未披露";
    if (coverage < total) return `披露 ${coverage}/${total} 年`;
    if (amount === 0) return `区间未${kind}`;
    return `${
      stats.annuals.filter((annual) => {
        const value =
          kind === "回购" ? annual.repurchaseAmt : annual.dividendsPaid;
        return value != null && value !== 0;
      }).length
    } 年有实施`;
  };

  let reinvestIntensity = "轻资产型";
  if (stats.capexPct != null && stats.capexPct > 50) {
    reinvestIntensity = "重资产再投资";
  } else if (stats.capexPct != null && stats.capexPct > 25) {
    reinvestIntensity = "稳健再投资";
  }

  // Dual-Axis SVG Chart Coordinates
  const chartW = 840;
  const chartH = 300;
  const padL = 76;
  const padR = 76;
  const padT = 36;
  const padB = 38;
  const innerW = chartW - padL - padR;
  const innerH = chartH - padT - padB;

  const shareSeries = getCapitalAllocationShareSeries(stats.annuals);
  const sharesArr = shareSeries.flatMap((point) =>
    point.shares == null ? [] : [point.shares],
  );
  const rawMinShares = sharesArr.length ? Math.min(...sharesArr) : 1;
  const rawMaxShares = sharesArr.length ? Math.max(...sharesArr) : 1;
  const sharesDiff = rawMaxShares - rawMinShares;
  // If share count is very stable (< 8% fluctuation), give a gentle 15% top/bottom margin
  // so the line doesn't appear drastically wild/distorted
  const marginShares = Math.max(sharesDiff * 0.3, rawMaxShares * 0.08);
  const minShares = Math.max(0, rawMinShares - marginShares);
  const maxShares = rawMaxShares + marginShares;

  const annualByYear = new Map(
    stats.annuals.map((annual) => [annual.year, annual]),
  );
  const rawMaxBuyback = Math.max(
    0,
    ...shareSeries.map((point) => {
      const amount = annualByYear.get(point.year)?.repurchaseAmt;
      return amount == null ? 0 : Math.abs(amount);
    }),
  );
  // Leave 25% head space for buyback bars so they don't overpower the shares line
  const maxBuyback = rawMaxBuyback > 0 ? rawMaxBuyback * 1.35 : 100;

  const chartPoints = shareSeries.map((point, i) => {
    const x =
      padL +
      (shareSeries.length > 1
        ? (i / (shareSeries.length - 1)) * innerW
        : innerW / 2);
    const sharesRatio =
      point.shares == null
        ? null
        : (point.shares - minShares) / Math.max(1, maxShares - minShares);
    const y = sharesRatio == null ? null : padT + (1 - sharesRatio) * innerH;
    const annual = annualByYear.get(point.year);
    return {
      x,
      y,
      year: point.year,
      shares: point.shares,
      buyback:
        annual?.repurchaseAmt == null ? null : Math.abs(annual.repurchaseAmt),
    };
  });

  const sharesSplineSegments: Array<Array<{ x: number; y: number }>> = [];
  let currentSplineSegment: Array<{ x: number; y: number }> = [];
  for (const point of chartPoints) {
    if (point.y == null || point.shares == null) {
      if (currentSplineSegment.length) {
        sharesSplineSegments.push(currentSplineSegment);
        currentSplineSegment = [];
      }
      continue;
    }
    currentSplineSegment.push({ x: point.x, y: point.y });
  }
  if (currentSplineSegment.length) {
    sharesSplineSegments.push(currentSplineSegment);
  }
  const sharesSplines = sharesSplineSegments
    .map(buildSmoothSpline)
    .filter(Boolean);

  const activeHover =
    hoverYearIdx !== null && chartPoints[hoverYearIdx]
      ? chartPoints[hoverYearIdx]
      : null;

  // 3-Level Y Axis Ticks
  const yTicks = [
    { ratio: 0, shares: maxShares, buyback: maxBuyback },
    {
      ratio: 0.5,
      shares: (minShares + maxShares) / 2,
      buyback: maxBuyback * 0.5,
    },
    { ratio: 1, shares: minShares, buyback: 0 },
  ];

  return (
    <div className="cap-alloc-deep-dive">
      <div className="val-section-head">
        <div>
          <div className="val-title-row">
            <h3 className="val-title">
              {isShareholderReturnModel
                ? "资本配置与股东回报"
                : allocationModel === "group_returns"
                  ? "集团资本配置与现金流"
                  : "资本配置与现金流"}
            </h3>
          </div>
          <p className="val-subtitle">
            FY{stats.earliestYear}–FY{stats.latestYear} · {periodCountLabel}
            {displayCurrency ? ` · ${displayCurrency}` : " · 币种待确认"}
          </p>
        </div>
      </div>

      <div className="val-multiples-grid cap-alloc-summary-grid">
        <div className="val-multiple-card">
          <span className="val-card-label">
            {isInsurance ? "区间股数变化" : "总股数净变化"}
          </span>
          <div className="val-card-val-row">
            <span
              className="val-card-val"
              style={{
                color:
                  stats.shareDeltaPct != null && stats.shareDeltaPct < 0
                    ? "#047857"
                    : "#0f172a",
              }}
            >
              {shareDeltaText}
            </span>
          </div>
          <span className="val-card-hint">
            {stats.sharesStart != null && stats.sharesEnd != null
              ? `${formatUsdInYi(stats.sharesStart)}股 → ${formatUsdInYi(stats.sharesEnd)}股`
              : "可比年度股数不足"}
          </span>
        </div>

        <div className="val-multiple-card">
          <span className="val-card-label">
            {isInsurance ? "区间已披露回购合计" : "已披露回购金额合计"}
          </span>
          <div className="val-card-val-row">
            <span
              className="val-card-val"
              style={{ color: stats.cumBuybacks ? "#4f46e5" : "#64748b" }}
            >
              {formatAmount(stats.cumBuybacks)}
            </span>
            <span className="val-card-subtag val-tag--sub-slate">
              {getDisclosureStatus(
                stats.buybackCoverage,
                stats.periodCount,
                stats.cumBuybacks,
                "回购",
              )}
            </span>
          </div>
          <span className="val-card-hint">
            {isInsurance
              ? "金额不等同于实际注销股数"
              : "回购金额不等同于实际注销股数"}
          </span>
        </div>

        <div className="val-multiple-card">
          <span className="val-card-label">
            {isInsurance ? "区间已披露现金分红" : "已披露现金分红合计"}
          </span>
          <div className="val-card-val-row">
            <span
              className="val-card-val"
              style={{ color: stats.cumDividends ? "#0f766e" : "#64748b" }}
            >
              {formatAmount(stats.cumDividends)}
            </span>
            <span className="val-card-subtag val-tag--sub-slate">
              {getDisclosureStatus(
                stats.dividendCoverage,
                stats.periodCount,
                stats.cumDividends,
                "分红",
              )}
            </span>
          </div>
          <span className="val-card-hint">
            {isInsurance
              ? "仅计已实施现金分红"
              : "现金流量表披露的现金分红金额"}
          </span>
        </div>

        {showIndustrialCashFlow ? (
          <div className="val-multiple-card">
            <span className="val-card-label">资本开支 / 经营现金流</span>
            <div className="val-card-val-row">
              <span className="val-card-val">
                {stats.capexPct != null ? `${stats.capexPct}%` : "—"}
              </span>
              {stats.capexPct != null ? (
                <span className="val-card-subtag val-tag--sub-slate">
                  {reinvestIntensity}
                </span>
              ) : null}
            </div>
            <span className="val-card-hint">
              {stats.cumCapEx != null
                ? `完整期累计 CapEx ${formatAmount(stats.cumCapEx)} · ${flowCoverageLabel}`
                : "经营现金流或资本开支数据不足"}
            </span>
          </div>
        ) : (
          <div className="val-multiple-card">
            <span className="val-card-label">区间平均 ROE</span>
            <div className="val-card-val-row">
              <span className="val-card-val">
                {stats.avgRoe == null ? "—" : `${stats.avgRoe}%`}
              </span>
            </div>
            <span className="val-card-hint">
              有数据 {roeCoverage}/{stats.periodCount} 年
              {latestRoeAnnual
                ? ` · FY${latestRoeAnnual.year} ${latestRoeAnnual.roe}%`
                : ""}
            </span>
          </div>
        )}
      </div>

      {isInsurance ? (
        <aside
          className="cap-insurance-context"
          aria-label="保险专项指标覆盖范围"
        >
          <span className="cap-insurance-context-label">
            保险专项指标未接入
          </span>
          <p>
            偿付能力充足率、内含价值与新业务价值率，暂不据此评价保险资本充足性。
          </p>
        </aside>
      ) : null}

      {!isInsurance &&
      isShareholderReturnModel &&
      allocationModel !== "financial_services_returns" ? (
        <aside className="cap-insurance-context" aria-label="专项资本配置指标覆盖范围">
          <span className="cap-insurance-context-label">
            {allocationModel === "property_returns"
              ? "地产专项指标未接入"
              : "银行专项指标未接入"}
          </span>
          <p>
            {allocationModel === "property_returns"
              ? "FFO/AFFO 与 NAV 尚未接入，不以工业现金流或净利润替代。"
              : "资产质量、资本充足率与风险加权资产尚未接入，暂以回购、分红、股数和 ROE 展示股东回报。"}
          </p>
        </aside>
      ) : null}

      {allocationModel === "group_returns" ? (
        <aside className="cap-insurance-context" aria-label="集团资本配置口径">
          <span className="cap-insurance-context-label">合并报表口径</span>
          <p>业务分部尚未拆分，现金流与股东回报按集团合并数据呈现。</p>
        </aside>
      ) : null}

      {/* Cash flow totals use only years with both OCF and CapEx reported. Financial institutions (banks/insurance) do not use industrial CapEx waterfall. */}
      {showIndustrialCashFlow &&
      stats.flowCoverage > 0 &&
      stats.cumOcf != null &&
      stats.cumCapEx != null &&
      stats.cumFcf != null ? (
        <div className="val-chart-block">
          <div className="val-chart-header">
            <div>
              <h4 className="val-block-title">经营现金流 (OCF) 资本去向</h4>
              <span className="val-block-desc">
                仅汇总 OCF 与 CapEx 均有披露的财年（{flowCoverageLabel}
                ）；不含并购、偿债和现金变动
              </span>
            </div>
          </div>

          {/* Waterfall Step Columns with Clean Connectors */}
          <div className="cap-wf-steps-grid">
            {/* Step 1: Cumulative OCF Base */}
            <div
              className="cap-wf-step-card cap-wf-step-card--base"
              title="仅汇总数据完整财年的经营现金流"
            >
              <div className="cap-wf-step-badge">1. 资金源头</div>
              <div className="cap-wf-step-val">
                {formatAmount(stats.cumOcf)}
              </div>
              <div className="cap-wf-step-name">累计经营现金流</div>
              <div className="cap-wf-step-sub">{flowCoverageLabel}</div>
            </div>

            <div className="cap-wf-connector">−</div>

            {/* Step 2: CapEx Reinvestment */}
            <div
              className="cap-wf-step-card cap-wf-step-card--capex"
              title="累计资本开支，仅计 OCF 与 CapEx 均有披露的财年"
            >
              <div className="cap-wf-step-badge">2. 再投资支出</div>
              <div className="cap-wf-step-val cap-wf-step-val--red">
                -{formatAmount(stats.cumCapEx)}
              </div>
              <div className="cap-wf-step-name">资本支出 (CapEx)</div>
              <div className="cap-wf-step-sub">
                {stats.capexPct != null
                  ? `占 OCF ${stats.capexPct}% · ${reinvestIntensity}`
                  : "OCF 为负或数据不足"}
              </div>
            </div>

            <div className="cap-wf-connector">=</div>

            {/* Step 3: Free Cash Flow */}
            <div
              className="cap-wf-step-card cap-wf-step-card--fcf"
              title="FCF 按 OCF 减资本开支计算"
            >
              <div className="cap-wf-step-badge">3. 自由现金流</div>
              <div className="cap-wf-step-val cap-wf-step-val--green">
                {formatAmount(stats.cumFcf)}
              </div>
              <div className="cap-wf-step-name">自由现金流 (FCF)</div>
              <div className="cap-wf-step-sub">
                {stats.fcfPct != null
                  ? `OCF 转化率 ${stats.fcfPct}%`
                  : "OCF 为负或数据不足"}
              </div>
            </div>

            <div className="cap-wf-connector">−</div>

            {/* Step 4: Share Buybacks */}
            <div
              className="cap-wf-step-card cap-wf-step-card--buyback"
              title="仅在回购金额披露完整时纳入 FCF 扣减"
            >
              <div className="cap-wf-step-badge">4. 股东回购</div>
              <div className="cap-wf-step-val cap-wf-step-val--blue">
                {stats.completeFlowBuybacks == null
                  ? "—"
                  : `-${currencySym}${formatUsdInYi(stats.completeFlowBuybacks)}`}
              </div>
              <div className="cap-wf-step-name">已披露回购</div>
              <div className="cap-wf-step-sub">
                {stats.buybackPct != null
                  ? `占 FCF ${stats.buybackPct}%`
                  : `现金流完整年度回购披露 ${stats.flowBuybackCoverage}/${stats.flowCoverage} 年`}
              </div>
            </div>

            <div className="cap-wf-connector">−</div>

            {/* Step 5: Cash dividends */}
            <div
              className="cap-wf-step-card cap-wf-step-card--dividend"
              title="现金流量表披露的现金分红金额"
            >
              <div className="cap-wf-step-badge">5. 现金分红</div>
              <div className="cap-wf-step-val cap-wf-step-val--teal">
                {stats.completeFlowDividends == null
                  ? "—"
                  : `-${currencySym}${formatUsdInYi(stats.completeFlowDividends)}`}
              </div>
              <div className="cap-wf-step-name">已披露现金分红</div>
              <div className="cap-wf-step-sub">
                {stats.dividendPct != null
                  ? `占 FCF ${stats.dividendPct}%`
                  : `现金流完整年度分红披露 ${stats.flowDividendCoverage}/${stats.flowCoverage} 年`}
              </div>
            </div>

            <div className="cap-wf-connector">=</div>

            {/* Step 6: FCF after disclosed distributions */}
            <div
              className="cap-wf-step-card cap-wf-step-card--retained"
              title="仅为 FCF 与已披露股东回报对比差额，不代表期末现金余额"
            >
              <div className="cap-wf-step-badge">6. 扣除股东分配后</div>
              <div className="cap-wf-step-val cap-wf-step-val--purple">
                {stats.fcfAfterDistributions == null
                  ? "—"
                  : `${currencySym}${formatUsdInYi(stats.fcfAfterDistributions)}`}
              </div>
              <div className="cap-wf-step-name">
                {stats.distributionScope === "both"
                  ? "FCF 减回购与分红"
                  : stats.distributionScope === "dividend_only"
                    ? "FCF 减已披露分红"
                    : stats.distributionScope === "buyback_only"
                      ? "FCF 减已披露回购"
                      : "FCF 与股东回报对比"}
              </div>
              <div className="cap-wf-step-sub">
                {stats.fcfAfterDistributions != null && stats.fcfAfterDistributions < 0
                  ? "当期 FCF 未覆盖已披露股东回报"
                  : "仅为 FCF 与已披露回报对比"}
              </div>
            </div>
          </div>
        </div>
      ) : showIndustrialCashFlow ? (
        <div className="val-chart-block">
          <div className="val-chart-header">
            <div>
              <h4 className="val-block-title">经营现金流资本去向</h4>
              <span className="val-block-desc">
                暂无同时披露 OCF 与 CapEx 的年度，无法计算 FCF 汇总。
              </span>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── 5. Diluted Share Count & Buyback Intensity Dual-Axis Chart ── */}
      {sharesArr.length > 0 ? (
        <div className="val-chart-block">
          <div className="val-chart-header">
            <div>
              <div className="cap-chart-title-row">
                <h4 className="val-block-title">
                  {isInsurance
                    ? "股数与回购金额"
                    : "历年总股本走廊与回购力度双轴趋势"}
                </h4>
              </div>
              <span className="val-block-desc">{shareDesc}</span>
            </div>

            <div className="cap-chart-legend">
              <span className="cap-chart-legend-item">
                <span className="cap-chart-legend-line" />
                股数
              </span>
              <span className="cap-chart-legend-item">
                <span className="cap-chart-legend-bar" />
                回购金额
              </span>
            </div>

            <div className="cap-chart-interaction">
              {activeHover && (
                <div className="cap-chart-hud">
                  <strong>FY{activeHover.year}</strong>： 股本{" "}
                  <strong>
                    {activeHover.shares == null
                      ? "数据缺失"
                      : `${formatUsdInYi(activeHover.shares)}股`}
                  </strong>
                  <span>
                    {" "}
                    · 回购{" "}
                    {activeHover.buyback == null
                      ? "无数据"
                      : `${currencySym}${formatUsdInYi(activeHover.buyback)}`}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div
            className="cap-mobile-period-picker"
            role="group"
            aria-label="选择图表财年"
          >
            {chartPoints.map((point, index) => (
              <button
                key={point.year}
                type="button"
                aria-label={`查看 FY${point.year} 数据`}
                aria-pressed={hoverYearIdx === index}
                className={hoverYearIdx === index ? "is-active" : ""}
                onClick={() => setHoverYearIdx(index)}
              >
                FY{point.year}
              </button>
            ))}
          </div>

          <div className="cap-chart-container">
            <svg viewBox={`0 0 ${chartW} ${chartH}`} className="cap-chart-svg">
              <defs>
                <linearGradient id="capBuybackGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.85" />
                  <stop offset="100%" stopColor="#0284c7" stopOpacity="0.25" />
                </linearGradient>
              </defs>

              {/* 3-Level Horizontal Grid Lines with Y-Axis Values */}
              {yTicks.map((tick, idx) => {
                const y = padT + tick.ratio * innerH;
                return (
                  <g key={`ytick-${idx}`}>
                    <line
                      x1={padL}
                      y1={y}
                      x2={chartW - padR}
                      y2={y}
                      stroke="#e2e8f0"
                      strokeDasharray="4 4"
                    />
                    {/* Left Y Axis Label: Shares */}
                    <text
                      x={padL - 8}
                      y={y + 4}
                      textAnchor="end"
                      fontSize="10"
                      fill="#0284c7"
                      fontWeight="500"
                      style={{ fontFeatureSettings: "tnum" }}
                    >
                      {formatUsdInYi(tick.shares)}股
                    </text>
                    {/* Right Y Axis Label: Buybacks */}
                    <text
                      x={chartW - padR + 8}
                      y={y + 4}
                      textAnchor="start"
                      fontSize="10"
                      fill="#0284c7"
                      fontWeight="500"
                      style={{ fontFeatureSettings: "tnum" }}
                    >
                      {tick.buyback > 0
                        ? `${currencySym}${formatUsdInYi(tick.buyback)}`
                        : "0"}
                    </text>
                  </g>
                );
              })}

              {/* Buyback Bars */}
              {chartPoints.map((pt, i) => {
                if (pt.buyback == null) return null;
                const barW = Math.min(
                  32,
                  Math.max(16, innerW / (chartPoints.length * 2.8)),
                );
                const buybackRatio = pt.buyback / maxBuyback;
                const barH = buybackRatio * innerH;
                const barX = pt.x - barW / 2;
                const barY = padT + innerH - barH;
                const isHovered = hoverYearIdx === i;

                return (
                  <g key={`bar-${pt.year}`}>
                    <rect
                      x={barX}
                      y={barY}
                      width={barW}
                      height={barH}
                      rx="4"
                      fill="url(#capBuybackGrad)"
                      stroke={isHovered ? "#0284c7" : "transparent"}
                      strokeWidth="1.5"
                      style={{
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                      onMouseEnter={() => setHoverYearIdx(i)}
                      onMouseLeave={() => setHoverYearIdx(null)}
                    />
                    {pt.buyback > 0 && (
                      <text
                        x={pt.x}
                        y={barY - 5}
                        textAnchor="middle"
                        fontSize="9"
                        fill="#64748b"
                        fontFamily="inherit"
                        fontWeight="500"
                      >
                        {formatUsdInYi(pt.buyback)}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Shares Corridor Spline Line */}
              {sharesSplines.map((sharesSpline, index) => (
                <path
                  key={`share-spline-${index}`}
                  d={sharesSpline}
                  fill="none"
                  stroke="#0284c7"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}

              {/* Data points & Year Labels */}
              {chartPoints.map((pt, i) => {
                const isHovered = hoverYearIdx === i;
                return (
                  <g key={`pt-${pt.year}`}>
                    {/* Vertical Crosshair Line when hovered */}
                    {isHovered && (
                      <line
                        x1={pt.x}
                        y1={padT}
                        x2={pt.x}
                        y2={padT + innerH}
                        stroke="#94a3b8"
                        strokeDasharray="3 3"
                      />
                    )}

                    {pt.y != null && pt.shares != null && (
                      <circle
                        cx={pt.x}
                        cy={pt.y}
                        r={isHovered ? 6.5 : 4.5}
                        fill="#0284c7"
                        stroke="#ffffff"
                        strokeWidth="2.5"
                        style={{
                          cursor: "pointer",
                          transition: "r 0.15s ease",
                        }}
                        onMouseEnter={() => setHoverYearIdx(i)}
                        onMouseLeave={() => setHoverYearIdx(null)}
                      />
                    )}

                    {/* Year Label */}
                    <text
                      x={pt.x}
                      y={chartH - 12}
                      textAnchor="middle"
                      fontSize="11"
                      fill={isHovered ? "#0f172a" : "#64748b"}
                      fontWeight={isHovered ? "700" : "500"}
                    >
                      FY{pt.year}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      ) : null}

      {/* ── 6. Multi-Year Longitudinal Allocation Table ── */}
      <div className="val-chart-block">
        <div className="val-chart-header">
          <div>
            <h4 className="val-block-title">
              {isShareholderReturnModel
                ? "年度股东回报与资本指标"
                : "历年资本配置与股本变化明细"}
            </h4>
            <span className="val-block-desc">
              {isInsurance
                ? "年度回购、已实施现金分红、股数与 ROE"
                : isShareholderReturnModel
                  ? "年度回购、现金分红、股数（标明口径）与 ROE"
                  : allocationModel === "group_returns"
                    ? "合并经营现金流、资本开支、回购、现金分红与股本变化"
                    : "年度经营现金流、资本开支、回购、现金分红与股本变化"}
            </span>
          </div>
        </div>

        <div className="cap-table-wrap">
          <table className="cap-table">
            <thead>
              <tr>
                <th>财年</th>
                {showIndustrialCashFlow && (
                  <>
                    <th style={{ textAlign: "right" }}>经营现金流 (OCF)</th>
                    <th style={{ textAlign: "right" }}>资本开支 (CapEx)</th>
                    <th style={{ textAlign: "right" }}>自由现金流 (FCF)</th>
                  </>
                )}
                <th style={{ textAlign: "right" }}>股票回购</th>
                <th style={{ textAlign: "right" }}>现金分红</th>
                <th style={{ textAlign: "right" }}>股数</th>
                <th style={{ textAlign: "right" }}>ROE</th>
              </tr>
            </thead>
            <tbody>
              {stats.annuals
                .slice()
                .reverse()
                .map((a) => {
                  const annualFcf =
                    showIndustrialCashFlow &&
                    a.operatingCashFlow != null &&
                    a.capEx != null
                      ? a.operatingCashFlow - Math.abs(a.capEx)
                      : null;
                  return (
                    <tr key={a.year}>
                      <td>
                        <strong>FY{a.year}</strong>
                      </td>
                      {showIndustrialCashFlow && (
                        <>
                          <td style={{ textAlign: "right" }}>
                            {a.operatingCashFlow != null
                              ? `${currencySym}${formatUsdInYi(a.operatingCashFlow)}`
                              : "—"}
                          </td>
                          <td
                            style={{
                              textAlign: "right",
                              color: a.capEx ? "#dc2626" : undefined,
                            }}
                          >
                            {a.capEx != null
                              ? `-${currencySym}${formatUsdInYi(Math.abs(a.capEx))}`
                              : "—"}
                          </td>
                          <td
                            style={{
                              textAlign: "right",
                              color:
                                annualFcf != null && annualFcf > 0
                                  ? "#059669"
                                  : undefined,
                            }}
                          >
                            {annualFcf != null
                              ? `${currencySym}${formatUsdInYi(annualFcf)}`
                              : "—"}
                          </td>
                        </>
                      )}
                      <td
                        style={{
                          textAlign: "right",
                          color:
                            a.repurchaseAmt != null && a.repurchaseAmt !== 0
                              ? "#4f46e5"
                              : undefined,
                        }}
                      >
                        {a.repurchaseAmt == null
                          ? "—"
                          : `${currencySym}${formatUsdInYi(Math.abs(a.repurchaseAmt))}`}
                      </td>
                      <td
                        style={{
                          textAlign: "right",
                          color:
                            a.dividendsPaid != null && a.dividendsPaid !== 0
                              ? "#0f766e"
                              : undefined,
                        }}
                      >
                        {a.dividendsPaid == null
                          ? "—"
                          : `${currencySym}${formatUsdInYi(Math.abs(a.dividendsPaid))}`}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {a.shares != null ? (
                          <>
                            {formatUsdInYi(a.shares)}股
                            {a.sharesSource === "weighted_average" && (
                              <span
                                title="稀释加权平均股数（非期末时点流通股）"
                                style={{
                                  marginLeft: 4,
                                  fontSize: "0.75rem",
                                  color: "#6b7280",
                                  background: "#f3f4f6",
                                  padding: "1px 4px",
                                  borderRadius: 3,
                                }}
                              >
                                加权
                              </span>
                            )}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {a.roe != null ? (
                          <span
                            className={`val-card-subtag ${
                              a.roe >= 20
                                ? "val-tag--sub-green"
                                : a.roe >= 10
                                  ? "val-tag--sub-slate"
                                  : "val-tag--sub-red"
                            }`}
                          >
                            {a.roe}%
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
