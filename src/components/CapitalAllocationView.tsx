"use client";

import { useMemo, useState } from "react";
import type { ValueLineData } from "@/lib/value-line-data";
import { currencySymbol, formatUsdInYi } from "@/lib/currency";
import { computeCapitalAllocationStats } from "@/lib/capital-allocation-metrics";

type CapitalAllocationViewProps = {
  data: ValueLineData;
};

/**
 * Catmull-Rom to Cubic Bezier Spline for smooth share count curves
 */
function buildSmoothSpline(pts: Array<{ x: number; y: number }>): string {
  if (!pts.length) return "";
  if (pts.length === 1) return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
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
  const currencySym = data.reportingCurrency
    ? currencySymbol(data.reportingCurrency)
    : "";
  const [hoverYearIdx, setHoverYearIdx] = useState<number | null>(null);

  const stats = useMemo(() => {
    return computeCapitalAllocationStats(data.annuals || []);
  }, [data.annuals]);

  if (!stats) {
    return (
      <div className="company-placeholder-grid">
        <article className="company-placeholder-card">
          <h3>资本配置历史数据不足</h3>
          <p>该标的暂无连续多期现金流与股本明细，待更多年度财报入库后自动生成资本配置全景总账。</p>
        </article>
      </div>
    );
  }

  const periodCountLabel = `${stats.periodCount} 个已披露财年`;
  const flowCoverageLabel = `${stats.flowCoverage}/${stats.periodCount} 年 OCF 与 CapEx 数据完整`;
  let shareTag = "股数变化数据不足";
  let shareTagClass = "val-tag--neutral";

  if (stats.shareDeltaPct != null) {
    if (stats.shareDeltaPct <= -1.0) {
      shareTag = `股数净减少 ${Math.abs(stats.shareDeltaPct)}%`;
      shareTagClass = "val-tag--deep-green";
    } else if (stats.shareDeltaPct >= 1.0) {
      shareTag = `股数净增加 +${stats.shareDeltaPct}%`;
      shareTagClass = "val-tag--amber";
    } else {
      shareTag = `股本稳定 (${stats.shareDeltaPct > 0 ? "+" : ""}${stats.shareDeltaPct}%)`;
      shareTagClass = "val-tag--neutral";
    }
  }
  const shareDeltaText =
    stats.shareDeltaPct == null
      ? "—"
      : `${stats.shareDeltaPct > 0 ? "+" : ""}${stats.shareDeltaPct}%`;
  const shareDesc =
    "比较区间首尾披露股数变化；净变化不能单独说明回购注销或股权稀释的原因。";
  const formatAmount = (value: number | null) =>
    value == null
      ? "—"
      : `${currencySym ? `${currencySym} ` : ""}${formatUsdInYi(value)}`;

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

  const validAnnuals = stats.annuals.filter((a) => a.shares != null && a.shares > 0);
  const sharesArr = validAnnuals.map((a) => a.shares!);
  const rawMinShares = sharesArr.length ? Math.min(...sharesArr) : 1;
  const rawMaxShares = sharesArr.length ? Math.max(...sharesArr) : 1;
  const sharesDiff = rawMaxShares - rawMinShares;
  // If share count is very stable (< 8% fluctuation), give a gentle 15% top/bottom margin
  // so the line doesn't appear drastically wild/distorted
  const marginShares = Math.max(sharesDiff * 0.3, rawMaxShares * 0.08);
  const minShares = Math.max(0, rawMinShares - marginShares);
  const maxShares = rawMaxShares + marginShares;

  const rawMaxBuyback = Math.max(
    0,
    ...stats.annuals.map((a) => (a.repurchaseAmt == null ? 0 : Math.abs(a.repurchaseAmt))),
  );
  // Leave 25% head space for buyback bars so they don't overpower the shares line
  const maxBuyback = rawMaxBuyback > 0 ? rawMaxBuyback * 1.35 : 100;

  const chartPoints = validAnnuals.map((a, i) => {
    const x = padL + (validAnnuals.length > 1 ? (i / (validAnnuals.length - 1)) * innerW : innerW / 2);
    const sharesRatio = (a.shares! - minShares) / Math.max(1, maxShares - minShares);
    const y = padT + (1 - sharesRatio) * innerH;
    return {
      x,
      y,
      year: a.year,
      shares: a.shares!,
      buyback: a.repurchaseAmt == null ? null : Math.abs(a.repurchaseAmt),
    };
  });

  const sharesSpline = buildSmoothSpline(chartPoints);

  const activeHover =
    hoverYearIdx !== null && chartPoints[hoverYearIdx] ? chartPoints[hoverYearIdx] : null;

  // 3-Level Y Axis Ticks
  const yTicks = [
    { ratio: 0, shares: maxShares, buyback: maxBuyback },
    { ratio: 0.5, shares: (minShares + maxShares) / 2, buyback: maxBuyback * 0.5 },
    { ratio: 1, shares: minShares, buyback: 0 },
  ];

  return (
    <div className="cap-alloc-deep-dive">
      <div className="val-section-head">
        <div>
          <div className="val-title-row">
            <h3 className="val-title">资本配置行为总账</h3>
            <span className={`val-status-badge ${shareTagClass}`}>{shareTag}</span>
          </div>
          <p className="val-subtitle">
            FY{stats.earliestYear}–FY{stats.latestYear} · {periodCountLabel} · {flowCoverageLabel}
            {data.reportingCurrency ? ` · ${data.reportingCurrency}` : " · 币种待确认"}
          </p>
        </div>
      </div>

      <div className="val-multiples-grid cap-alloc-summary-grid">
        <div className="val-multiple-card">
          <span className="val-card-label">总股数净变化</span>
          <div className="val-card-val-row">
            <span
              className="val-card-val"
              style={{
                color:
                  stats.shareDeltaPct != null && stats.shareDeltaPct < 0 ? "#047857" : "#0f172a",
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
          <span className="val-card-label">已披露回购金额合计</span>
          <div className="val-card-val-row">
            <span className="val-card-val" style={{ color: stats.cumBuybacks ? "#4f46e5" : "#64748b" }}>
              {formatAmount(stats.cumBuybacks)}
            </span>
            <span className="val-card-subtag val-tag--sub-slate">
              {stats.cumBuybacks && stats.cumBuybacks > 0
                ? `${stats.annuals.filter((a) => a.repurchaseAmt != null && a.repurchaseAmt > 0).length} 年有实施`
                : "区间未回购"}
            </span>
          </div>
          <span className="val-card-hint">回购金额不等同于实际注销股数</span>
        </div>

        <div className="val-multiple-card">
          <span className="val-card-label">已披露现金分红合计</span>
          <div className="val-card-val-row">
            <span
              className="val-card-val"
              style={{ color: stats.cumDividends ? "#0f766e" : "#64748b" }}
            >
              {formatAmount(stats.cumDividends)}
            </span>
            <span className="val-card-subtag val-tag--sub-slate">
              {stats.cumDividends && stats.cumDividends > 0
                ? `${stats.annuals.filter((a) => a.dividendsPaid != null && a.dividendsPaid > 0).length} 年有实施`
                : "区间未分红"}
            </span>
          </div>
          <span className="val-card-hint">现金流量表披露的现金分红金额</span>
        </div>

        <div className="val-multiple-card">
          <span className="val-card-label">资本开支 / 经营现金流</span>
          <div className="val-card-val-row">
            <span className="val-card-val">
              {stats.capexPct != null ? `${stats.capexPct}%` : "—"}
            </span>
            {stats.capexPct != null ? (
              <span className="val-card-subtag val-tag--sub-slate">{reinvestIntensity}</span>
            ) : null}
          </div>
          <span className="val-card-hint">
              {stats.cumCapEx != null
              ? `完整期累计 CapEx ${formatAmount(stats.cumCapEx)} · ${flowCoverageLabel}`
              : "经营现金流或资本开支数据不足"}
          </span>
        </div>
      </div>

      {/* Cash flow totals use only years with both OCF and CapEx reported. */}
      {stats.flowCoverage > 0 && stats.cumOcf != null && stats.cumCapEx != null && stats.cumFcf != null ? (
      <div className="val-chart-block">
        <div className="val-chart-header">
          <div>
            <h4 className="val-block-title">经营现金流 (OCF) 资本去向</h4>
            <span className="val-block-desc">
              仅汇总 OCF 与 CapEx 均有披露的财年（{flowCoverageLabel}）；不含并购、偿债和现金变动
            </span>
          </div>
        </div>

        {/* Waterfall Step Columns with Clean Connectors */}
        <div className="cap-wf-steps-grid">
          {/* Step 1: Cumulative OCF Base */}
          <div className="cap-wf-step-card cap-wf-step-card--base" title="仅汇总数据完整财年的经营现金流">
            <div className="cap-wf-step-badge">1. 资金源头</div>
            <div className="cap-wf-step-val">{formatAmount(stats.cumOcf)}</div>
            <div className="cap-wf-step-name">累计经营现金流</div>
            <div className="cap-wf-step-sub">{flowCoverageLabel}</div>
          </div>

          <div className="cap-wf-connector">−</div>

          {/* Step 2: CapEx Reinvestment */}
          <div className="cap-wf-step-card cap-wf-step-card--capex" title="累计资本开支，仅计 OCF 与 CapEx 均有披露的财年">
            <div className="cap-wf-step-badge">2. 再投资支出</div>
            <div className="cap-wf-step-val cap-wf-step-val--red">
              -{formatAmount(stats.cumCapEx)}
            </div>
            <div className="cap-wf-step-name">资本支出 (CapEx)</div>
            <div className="cap-wf-step-sub">
              {stats.capexPct != null ? `占 OCF ${stats.capexPct}% · ${reinvestIntensity}` : "OCF 为负或数据不足"}
            </div>
          </div>

          <div className="cap-wf-connector">=</div>

          {/* Step 3: Free Cash Flow */}
          <div className="cap-wf-step-card cap-wf-step-card--fcf" title="FCF 按 OCF 减资本开支计算">
            <div className="cap-wf-step-badge">3. 自由现金流</div>
            <div className="cap-wf-step-val cap-wf-step-val--green">
              {formatAmount(stats.cumFcf)}
            </div>
            <div className="cap-wf-step-name">自由现金流 (FCF)</div>
            <div className="cap-wf-step-sub">
              {stats.fcfPct != null ? `OCF 转化率 ${stats.fcfPct}%` : "OCF 为负或数据不足"}
            </div>
          </div>

          <div className="cap-wf-connector">−</div>

          {/* Step 4: Share Buybacks */}
          <div className="cap-wf-step-card cap-wf-step-card--buyback" title="仅在回购金额披露完整时纳入 FCF 扣减">
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

          <div className="cap-wf-connector">=</div>

          {/* Step 5: Cash dividends */}
          <div className="cap-wf-step-card cap-wf-step-card--dividend" title="现金流量表披露的现金分红金额">
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
          <div className="cap-wf-step-card cap-wf-step-card--retained" title="仅为 FCF 扣除已披露回购与分红后的差额，不代表期末现金余额">
            <div className="cap-wf-step-badge">6. 扣除股东分配后</div>
            <div className="cap-wf-step-val cap-wf-step-val--purple">
              {stats.fcfAfterDistributions == null
                ? "—"
                : `${currencySym}${formatUsdInYi(stats.fcfAfterDistributions)}`}
            </div>
            <div className="cap-wf-step-name">FCF 减回购与分红</div>
            <div className="cap-wf-step-sub">仅在数据完整时计算</div>
          </div>
        </div>
      </div>
      ) : (
        <div className="val-chart-block">
          <div className="val-chart-header">
            <div>
              <h4 className="val-block-title">经营现金流资本去向</h4>
              <span className="val-block-desc">暂无同时披露 OCF 与 CapEx 的年度，无法计算 FCF 汇总。</span>
            </div>
          </div>
        </div>
      )}

      {/* ── 5. Diluted Share Count & Buyback Intensity Dual-Axis Chart ── */}
      <div className="val-chart-block">
        <div className="val-chart-header">
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", marginBottom: "4px" }}>
              <h4 className="val-block-title">历年总股本走廊与回购力度双轴趋势</h4>
              <span className={`val-status-badge ${shareTagClass}`}>{shareTag}</span>
            </div>
            <span className="val-block-desc">
              {shareDesc} 折线：披露股数 · 柱状：该年度已披露回购金额
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "14px", fontSize: "0.75rem" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", color: "#0284c7", fontWeight: 650 }}>
                <span style={{ width: "12px", height: "3px", background: "#0284c7", borderRadius: "2px" }} />
                总股本走廊 (左轴)
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", color: "#0284c7", fontWeight: 650 }}>
                <span style={{ width: "10px", height: "10px", background: "#38bdf8", borderRadius: "2px", opacity: 0.85 }} />
                股票回购金额 (右轴)
              </span>
            </div>

            {activeHover && (
              <div className="cap-chart-hud">
                <strong>FY{activeHover.year}</strong>：
                股本 <strong>{formatUsdInYi(activeHover.shares)}股</strong>
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

        <div className="cap-chart-container">
          <svg
            viewBox={`0 0 ${chartW} ${chartH}`}
            className="cap-chart-svg"
          >
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
                    {tick.buyback > 0 ? `${currencySym}${formatUsdInYi(tick.buyback)}` : "0"}
                  </text>
                </g>
              );
            })}

            {/* Buyback Bars */}
            {chartPoints.map((pt, i) => {
              if (pt.buyback == null) return null;
              const barW = Math.min(32, Math.max(16, innerW / (chartPoints.length * 2.8)));
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
                    style={{ cursor: "pointer", transition: "all 0.15s ease" }}
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
            {sharesSpline && (
              <path
                d={sharesSpline}
                fill="none"
                stroke="#0284c7"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

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

                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r={isHovered ? 6.5 : 4.5}
                    fill="#0284c7"
                    stroke="#ffffff"
                    strokeWidth="2.5"
                    style={{ cursor: "pointer", transition: "r 0.15s ease" }}
                    onMouseEnter={() => setHoverYearIdx(i)}
                    onMouseLeave={() => setHoverYearIdx(null)}
                  />

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

            {/* Top Axis Column Legends */}
            <text x={padL} y={padT - 14} textAnchor="start" fontSize="10" fill="#0284c7" fontWeight="650">
              总股本走廊
            </text>
            <text x={chartW - padR} y={padT - 14} textAnchor="end" fontSize="10" fill="#0284c7" fontWeight="650">
              股票回购额
            </text>
          </svg>
        </div>
      </div>

      {/* ── 6. Multi-Year Longitudinal Allocation Table ── */}
      <div className="val-chart-block">
        <div className="val-chart-header">
          <div>
            <h4 className="val-block-title">历年资本配置与股本变化明细</h4>
            <span className="val-block-desc">
              年度经营现金流、资本开支、回购、现金分红与股本变化
            </span>
          </div>
        </div>

        <div className="cap-table-wrap">
          <table className="cap-table">
            <thead>
              <tr>
                <th>财年</th>
                <th style={{ textAlign: "right" }}>经营现金流 (OCF)</th>
                <th style={{ textAlign: "right" }}>资本开支 (CapEx)</th>
                <th style={{ textAlign: "right" }}>自由现金流 (FCF)</th>
                <th style={{ textAlign: "right" }}>股票回购</th>
                <th style={{ textAlign: "right" }}>现金分红</th>
                <th style={{ textAlign: "right" }}>股数（披露值）</th>
                <th style={{ textAlign: "right" }}>ROE</th>
              </tr>
            </thead>
            <tbody>
              {stats.annuals.slice().reverse().map((a) => {
                const annualFcf =
                  a.operatingCashFlow != null && a.capEx != null
                    ? a.operatingCashFlow - Math.abs(a.capEx)
                    : null;
                return (
                <tr key={a.year}>
                  <td>
                    <strong>FY{a.year}</strong>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {a.operatingCashFlow != null
                      ? `${currencySym}${formatUsdInYi(a.operatingCashFlow)}`
                      : "—"}
                  </td>
                  <td style={{ textAlign: "right", color: a.capEx ? "#dc2626" : undefined }}>
                    {a.capEx != null ? `-${currencySym}${formatUsdInYi(Math.abs(a.capEx))}` : "—"}
                  </td>
                  <td
                    style={{
                      textAlign: "right",
                      color: annualFcf != null && annualFcf > 0 ? "#059669" : undefined,
                    }}
                  >
                    {annualFcf != null
                      ? `${currencySym}${formatUsdInYi(annualFcf)}`
                      : "—"}
                  </td>
                  <td
                    style={{
                      textAlign: "right",
                      color: a.repurchaseAmt != null && a.repurchaseAmt !== 0 ? "#4f46e5" : undefined,
                    }}
                  >
                    {a.repurchaseAmt == null
                      ? "—"
                      : `${currencySym}${formatUsdInYi(Math.abs(a.repurchaseAmt))}`}
                  </td>
                  <td
                    style={{
                      textAlign: "right",
                      color: a.dividendsPaid != null && a.dividendsPaid !== 0 ? "#0f766e" : undefined,
                    }}
                  >
                    {a.dividendsPaid == null
                      ? "—"
                      : `${currencySym}${formatUsdInYi(Math.abs(a.dividendsPaid))}`}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {a.shares != null ? `${formatUsdInYi(a.shares)}股` : "—"}
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
