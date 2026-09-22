"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ValueLineData } from "@/lib/value-line-data";

export function formatCompactNumber(val: number | null | undefined, prefix = "$"): string {
  if (val == null || !Number.isFinite(val)) return "—";
  const abs = Math.abs(val);
  const sign = val < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}${prefix}${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}${prefix}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${prefix}${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}${prefix}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${prefix}${abs.toFixed(2)}`;
}

export function formatShortFirmName(raw: string | undefined | null): string {
  if (!raw) return "";
  return raw
    .replace(/,\s*(INC|LLC|L\.P\.|LP|CORP|CO\.|PLC|LTD)\.?$/i, "")
    .replace(/\s+(INC|LLC|L\.P\.|LP|CORP|PLC|LTD)\.?$/i, "")
    .trim();
}

/**
 * Catmull-Rom to Cubic Bezier Spline for silky smooth financial sparkline curves.
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

export function ValueLineSparkline({
  points,
  valuePoints = [],
  width = 620,
  height = 156,
}: {
  points: Array<{ date: string; close: number }>;
  valuePoints?: Array<{ date: string; value: number }>;
  annuals?: ValueLineData["annuals"];
  width?: number;
  height?: number;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const {
    pathD,
    areaD,
    valPathD,
    minPrice,
    maxPrice,
    coords,
    valueCoords,
    yTicks,
    yearTicks,
  } = useMemo(() => {
    if (!points.length) {
      return {
        pathD: "",
        areaD: "",
        valPathD: "",
        minPrice: 0,
        maxPrice: 0,
        coords: [],
        valueCoords: [],
        yTicks: [],
        yearTicks: [],
      };
    }

    const prices = points.map((p) => p.close).filter((c) => Number.isFinite(c) && c > 0);
    const vals = valuePoints.map((v) => v.value).filter((v) => Number.isFinite(v) && v > 0);
    const combined = [...prices, ...vals];

    const rawMin = Math.min(...(combined.length ? combined : prices));
    const rawMax = Math.max(...(combined.length ? combined : prices));

    const min = Math.max(0, rawMin * 0.9);
    const max = rawMax * 1.1;
    const range = max - min || 1;

    const paddingLeft = 16;
    const paddingRight = 44; // Room for Y-axis reference labels
    const paddingTop = 14;
    const paddingBottom = 22; // Room for X-axis year ticks
    const chartW = width - paddingLeft - paddingRight;
    const chartH = height - paddingTop - paddingBottom;

    const len = points.length;

    // Map price coords
    const mappedCoords = points.map((p, idx) => {
      const x = paddingLeft + (idx / (len - 1 || 1)) * chartW;
      const y = paddingTop + chartH - ((p.close - min) / range) * chartH;
      return { x, y, date: p.date, close: p.close };
    });

    const d = buildSmoothSpline(mappedCoords);

    const last = mappedCoords[mappedCoords.length - 1];
    const first = mappedCoords[0];
    const baselineY = paddingTop + chartH;
    const area = `${d} L ${last.x.toFixed(1)} ${baselineY.toFixed(1)} L ${first.x.toFixed(1)} ${baselineY.toFixed(1)} Z`;

    // Map value line coords
    const mappedValCoords = valuePoints.map((v, idx) => {
      const x = paddingLeft + (idx / (valuePoints.length - 1 || 1)) * chartW;
      const y = paddingTop + chartH - ((v.value - min) / range) * chartH;
      return { x, y, date: v.date, value: v.value };
    });

    const valD = buildSmoothSpline(mappedValCoords);

    // Calculate 3 horizontal reference lines
    const yTicks = [0.25, 0.5, 0.75].map((pct) => {
      const val = min + range * pct;
      const y = paddingTop + chartH - pct * chartH;
      return { y, label: `$${val >= 100 ? val.toFixed(0) : val.toFixed(1)}` };
    });

    // Calculate X-axis year markers
    const seenYears = new Set<string>();
    const yearTicks: Array<{ x: number; label: string }> = [];
    mappedCoords.forEach((c) => {
      const yr = c.date.slice(0, 4);
      if (!seenYears.has(yr)) {
        seenYears.add(yr);
        yearTicks.push({ x: c.x, label: yr });
      }
    });

    return {
      pathD: d,
      areaD: area,
      valPathD: valD,
      minPrice: rawMin,
      maxPrice: rawMax,
      coords: mappedCoords,
      valueCoords: mappedValCoords,
      yTicks,
      yearTicks,
    };
  }, [points, valuePoints, width, height]);

  if (!points.length) {
    return (
      <div className="vl-sparkline--empty">
        <span>暂无行情走势数据</span>
      </div>
    );
  }

  const activePricePoint = hoverIdx != null ? coords[hoverIdx] : coords[coords.length - 1];
  const activeValuePoint =
    hoverIdx != null ? valueCoords[hoverIdx] : valueCoords[valueCoords.length - 1];

  let valuationDiffTag: string | null = null;
  let valuationDiffClass = "vl-tag--neutral";
  if (activePricePoint && activeValuePoint && activeValuePoint.value > 0) {
    const diff = ((activePricePoint.close - activeValuePoint.value) / activeValuePoint.value) * 100;
    if (diff <= -12) {
      valuationDiffTag = `低估 ${Math.abs(diff).toFixed(0)}%`;
      valuationDiffClass = "vl-tag--green";
    } else if (diff >= 15) {
      valuationDiffTag = `溢价 ${diff.toFixed(0)}%`;
      valuationDiffClass = "vl-tag--red";
    } else {
      valuationDiffTag = "合理估值";
      valuationDiffClass = "vl-tag--amber";
    }
  }

  return (
    <div className="vl-sparkline-wrap">
      {/* Legend & Current Position Bar */}
      <div className="vl-sparkline-legend">
        <div className="vl-sparkline-price-tag">
          <div className="vl-legend-chip vl-legend-chip--price">
            <span className="vl-legend-dot vl-legend-dot--blue" />
            <span className="vl-legend-name">真实股价:</span>
            <span className="vl-sparkline-cur-price">${activePricePoint?.close.toFixed(2)}</span>
          </div>

          {activeValuePoint ? (
            <div className="vl-legend-chip vl-legend-chip--val">
              <span className="vl-legend-dot vl-legend-dot--amber" />
              <span className="vl-legend-name">价值参考线:</span>
              <span className="vl-sparkline-val-num">${activeValuePoint.value.toFixed(2)}</span>
            </div>
          ) : null}

          {valuationDiffTag ? (
            <span className={`vl-valuation-pill ${valuationDiffClass}`}>{valuationDiffTag}</span>
          ) : null}

          <span className="vl-sparkline-cur-date">({activePricePoint?.date})</span>
        </div>

        <div className="vl-sparkline-range">
          <span>5年低 ${minPrice.toFixed(1)}</span>
          <span className="vl-dot-divider">·</span>
          <span>5年高 ${maxPrice.toFixed(1)}</span>
        </div>
      </div>

      {/* SVG Dual-line Canvas with Precision Grid */}
      <div className="vl-canvas-container">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="vl-sparkline-svg"
          onMouseLeave={() => setHoverIdx(null)}
        >
          <defs>
            <linearGradient id="vl-price-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0071e3" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#0071e3" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* 1. Subtle Horizontal Grid Lines & Y-Axis Reference */}
          {yTicks.map((tick) => (
            <g key={tick.y}>
              <line
                x1={16}
                x2={width - 44}
                y1={tick.y}
                y2={tick.y}
                stroke="rgba(0, 0, 0, 0.05)"
                strokeDasharray="3 3"
              />
              <text
                x={width - 40}
                y={tick.y + 3}
                fill="rgba(0, 0, 0, 0.36)"
                fontSize="9"
                fontFamily="var(--font-mono)"
              >
                {tick.label}
              </text>
            </g>
          ))}

          {/* 2. X-Axis Year Ticks */}
          {yearTicks.map((tick) => (
            <text
              key={tick.label}
              x={tick.x}
              y={height - 5}
              fill="rgba(0, 0, 0, 0.38)"
              fontSize="9.5"
              fontFamily="var(--font-mono)"
              textAnchor="middle"
            >
              {tick.label}
            </text>
          ))}

          {/* 3. Shaded Area under Price */}
          <path d={areaD} fill="url(#vl-price-grad)" />

          {/* 4. Value Line (Amber Dashed Corridor) */}
          {valPathD ? (
            <path
              d={valPathD}
              fill="none"
              stroke="#f59e0b"
              strokeWidth="2.2"
              strokeDasharray="5, 4"
              strokeLinecap="round"
              className="vl-line-value"
            />
          ) : null}

          {/* 5. Price Line (Apple Blue Solid) */}
          <path
            d={pathD}
            fill="none"
            stroke="#0071e3"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* 6. Hover interaction crosshair & points */}
          {coords.map((c, idx) => (
            <g key={c.date}>
              <rect
                x={c.x - 8}
                y={0}
                width={16}
                height={height - 20}
                fill="transparent"
                onMouseEnter={() => setHoverIdx(idx)}
                style={{ cursor: "crosshair" }}
              />
              {hoverIdx === idx ? (
                <>
                  <line
                    x1={c.x}
                    x2={c.x}
                    y1={10}
                    y2={height - 22}
                    stroke="rgba(0, 0, 0, 0.22)"
                    strokeDasharray="2, 2"
                  />
                  <circle cx={c.x} cy={c.y} r={4.5} fill="#0071e3" stroke="#fff" strokeWidth={2} />
                  {valueCoords[idx] ? (
                    <circle
                      cx={valueCoords[idx].x}
                      cy={valueCoords[idx].y}
                      r={4}
                      fill="#f59e0b"
                      stroke="#fff"
                      strokeWidth={2}
                    />
                  ) : null}
                </>
              ) : null}
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

interface ValueLineCardProps {
  data: ValueLineData;
}

export function ValueLineCard({ data }: ValueLineCardProps) {

  const roeBadgeClass =
    data.roeStability === "stellar"
      ? "vl-badge--stellar"
      : data.roeStability === "solid"
        ? "vl-badge--solid"
        : "vl-badge--neutral";

  const roeBadgeLabel =
    data.roeStability === "stellar"
      ? "★ 卓越护城河"
      : data.roeStability === "solid"
        ? "稳健盈利"
        : "周期性波动";

  const valuationStatusBadge =
    data.valuationStatus === "undervalued" ? (
      <span className="vl-status-chip vl-status-chip--undervalued">
        <span className="vl-pulse-dot vl-pulse-dot--green" />
        价值击球区 (折价 ~{Math.abs(data.valuationDiffPct ?? 0)}%)
      </span>
    ) : data.valuationStatus === "overvalued" ? (
      <span className="vl-status-chip vl-status-chip--overvalued">
        <span className="vl-pulse-dot vl-pulse-dot--red" />
        溢价高估区 (溢价 ~{data.valuationDiffPct ?? 0}%)
      </span>
    ) : (
      <span className="vl-status-chip vl-status-chip--fair">
        <span className="vl-pulse-dot vl-pulse-dot--amber" />
        合理估值中枢
      </span>
    );

  return (
    <article className="value-line-card">
      {/* ── 1. Header Area: Ticker, Name, Editorial Essence & Pricing ── */}
      <header className="vl-card-head">
        <div className="vl-card-identity">
          <div className="vl-card-badges">
            <span className="vl-ticker-badge">{data.ticker}</span>
            {data.exchange ? <span className="vl-exchange-badge">{data.exchange}</span> : null}
            {data.sector ? <span className="vl-sector-badge">{data.sector}</span> : null}
            {valuationStatusBadge}
          </div>

          <h2 className="vl-card-title">
            <Link href={data.href} className="vl-title-link">
              <span className="vl-title-zh">{data.nameZh ?? data.canonicalName}</span>
              {data.nameZh && data.canonicalName !== data.nameZh ? (
                <span className="vl-title-en">{data.canonicalName}</span>
              ) : null}
            </Link>
          </h2>

        </div>

        {/* Pricing & Key Ratios */}
        <div className="vl-card-pricing">
          <div className="vl-price-primary">
            <span className="vl-price-currency">$</span>
            <span className="vl-price-val">
              {data.latestPrice ? data.latestPrice.toFixed(2) : "—"}
            </span>
            <span className="vl-price-sub">USD</span>
          </div>
          <div className="vl-price-metrics">
            <span className="vl-price-metric-item">
              <span className="vl-metric-k">市值</span>
              <span className="vl-metric-v">{formatCompactNumber(data.marketCap)}</span>
            </span>
            <span className="vl-dot-divider">·</span>
            <span className="vl-price-metric-item">
              <span className="vl-metric-k">PE</span>
              <span className="vl-metric-v">{data.peRatio ? `${data.peRatio}x` : "—"}</span>
            </span>
            <span className="vl-dot-divider">·</span>
            <span className="vl-price-metric-item">
              <span className="vl-metric-k">PB</span>
              <span className="vl-metric-v">{data.pbRatio ? `${data.pbRatio}x` : "—"}</span>
            </span>
          </div>
        </div>
      </header>

      {/* ── 2. Company Overview: Merged Identity, Products & Revenue Model (Replaces Business Essence) ── */}
      {data.businessSummary || data.businessSegments ? (
        <section className="vl-company-overview-pane" aria-label="公司概览">
          <div className="vl-overview-head">
            <div className="vl-overview-title-wrap">
              <span className="vl-overview-badge">公司概览</span>
              <span className="vl-overview-sub">业务本质 · 主打产品 · 营收结构</span>
            </div>
          </div>
          <div className="vl-overview-body">
            {data.businessSummary ? (
              <p className="vl-overview-para">{data.businessSummary}</p>
            ) : null}
            {data.businessSegments ? (
              <p className="vl-overview-para">{data.businessSegments}</p>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* ── 2.2. Tribe Superinvestor Holdings Cards (Mini Cards with Investor, Weight, Value & Handled Fund Name) ── */}
      {data.topHolders.length > 0 ? (
        <section className="vl-master-holdings-section" aria-label="大师持仓">
          <div className="vl-master-section-head">
            <div className="vl-master-title-group">
              <span className="vl-master-section-title">大师持仓</span>
            </div>
            <span className="vl-master-section-hint">部落重仓与仓位明细</span>
          </div>

          <div className="vl-master-cards-grid">
            {data.topHolders.map((h, idx) => {
              const shortFirm = formatShortFirmName(h.firmName ?? h.name);
              const displayName = h.investorName || h.name;
              const hasDistinctFirm =
                Boolean(shortFirm) &&
                shortFirm.toLowerCase() !== displayName.toLowerCase();

              return (
                <div
                  key={`${h.tribeId ?? h.name}-${h.quarterLabel ?? ""}-${idx}`}
                  className="vl-master-holder-card"
                >
                  <div className="vl-master-card-header">
                    <div className="vl-master-card-person">
                      {h.tribeId ? (
                        <Link
                          href={`/master/${h.tribeId}`}
                          className="vl-master-person-link"
                        >
                          <span className="vl-master-person-name">{displayName}</span>
                        </Link>
                      ) : (
                        <span className="vl-master-person-name">{displayName}</span>
                      )}
                    </div>
                    {h.quarterLabel ? (
                      <span className="vl-master-quarter-badge">{h.quarterLabel}</span>
                    ) : null}
                  </div>

                  <div className="vl-master-card-metrics">
                    <div className="vl-master-metric-cell">
                      <span className="vl-master-metric-label">仓位</span>
                      <span className="vl-master-metric-val vl-master-metric-weight">
                        {h.weightPct != null ? `${h.weightPct}%` : "—"}
                      </span>
                    </div>
                    <div className="vl-master-metric-sep" />
                    <div className="vl-master-metric-cell">
                      <span className="vl-master-metric-label">金额</span>
                      <span className="vl-master-metric-val vl-master-metric-value">
                        {h.valueLabel ?? "—"}
                      </span>
                    </div>
                  </div>

                  {hasDistinctFirm ? (
                    <div className="vl-master-firm-tag" title={h.name}>
                      <span className="vl-master-firm-text">{shortFirm}</span>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* ── 3. True Value Line Composite Chart (Price vs Earnings Value Line) ── */}
      <section className="vl-card-chart-block">
        <ValueLineSparkline points={data.pricePoints} valuePoints={data.valueLinePoints} />
      </section>

      {/* ── 4. The Buffett Quadrant: 巴菲特价值体检精密四宫格 ── */}
      <section className="vl-card-triad vl-card-quadrant">
        {/* Metric 1: ROE */}
        <div className="vl-triad-box">
          <div className="vl-triad-head">
            <span className="vl-triad-title">5年 ROE 均值</span>
            <span className={`vl-triad-badge ${roeBadgeClass}`}>{roeBadgeLabel}</span>
          </div>
          <div className="vl-triad-body">
            <span className="vl-triad-main-num">
              {data.roeAvg5Y != null ? `${data.roeAvg5Y}%` : "—"}
            </span>
            <span className="vl-triad-sub-text">
              {data.roeMin5Y != null ? `5年最低 ${data.roeMin5Y}%` : "年化资本回报"}
            </span>
          </div>
        </div>

        {/* Metric 2: Cash Conversion */}
        <div className="vl-triad-box">
          <div className="vl-triad-head">
            <span className="vl-triad-title">真金白银造血力</span>
            <span className="vl-triad-badge vl-badge--cash">
              {data.cashConversionRatio && data.cashConversionRatio >= 1 ? "纯正造血" : "稳健现金"}
            </span>
          </div>
          <div className="vl-triad-body">
            <span className="vl-triad-main-num">
              {data.cashConversionRatio != null ? `${data.cashConversionRatio}x` : "—"}
            </span>
            <span className="vl-triad-sub-text">经营现金流 / 净利润</span>
          </div>
        </div>

        {/* Metric 3: Capital Allocation (Share count / Buyback) */}
        <div className="vl-triad-box">
          <div className="vl-triad-head">
            <span className="vl-triad-title">资本分配与股本</span>
            <span
              className={`vl-triad-badge ${
                data.shareCountChangePct5Y != null && data.shareCountChangePct5Y <= -3
                  ? "vl-badge--cash"
                  : data.shareCountChangePct5Y != null && data.shareCountChangePct5Y >= 5
                    ? "vl-badge--alert"
                    : "vl-badge--neutral"
              }`}
            >
              {data.shareCountChangePct5Y != null && data.shareCountChangePct5Y <= -3
                ? "注销回购"
                : data.shareCountChangePct5Y != null && data.shareCountChangePct5Y >= 5
                  ? "稀释预警"
                  : "股本平稳"}
            </span>
          </div>
          <div className="vl-triad-body">
            <span className="vl-triad-main-num">
              {data.shareCountChangePct5Y != null
                ? `${data.shareCountChangePct5Y > 0 ? "+" : ""}${data.shareCountChangePct5Y}%`
                : "—"}
            </span>
            <span className="vl-triad-sub-text">
              {data.buybackLabel ?? "5年总股本变化"}
            </span>
          </div>
        </div>

        {/* Metric 4: Balance Sheet & Safety */}
        <div className="vl-triad-box">
          <div className="vl-triad-head">
            <span className="vl-triad-title">资产负债与安全性</span>
            <span className={`vl-triad-badge ${data.isNetCash ? "vl-badge--cash" : "vl-badge--neutral"}`}>
              {data.isNetCash ? "净现金充沛" : "适度杠杆"}
            </span>
          </div>
          <div className="vl-triad-body">
            <span className="vl-triad-main-num">
              {data.debtToAssetsRatio != null ? `${data.debtToAssetsRatio}%` : "—"}
            </span>
            <span className="vl-triad-sub-text">{data.safetyLabel}</span>
          </div>
        </div>
      </section>

      {/* ── 5. AI Briefing: 30-Second Executive Insight (Dual Column) ── */}
      <section className="vl-ai-briefing">
        <div className="vl-briefing-col vl-briefing-col--moat">
          <div className="vl-briefing-head">
            <span className="vl-briefing-badge vl-briefing-badge--moat">
              核心护城河 · {data.moatStrength}
            </span>
          </div>
          <p className="vl-briefing-content">{data.aiMoat}</p>
        </div>

        <div className="vl-briefing-divider" />

        <div className="vl-briefing-col vl-briefing-col--risk">
          <div className="vl-briefing-head">
            <span className="vl-briefing-badge vl-briefing-badge--risk">
              关键风险
            </span>
          </div>
          <p className="vl-briefing-content">{data.aiRisk}</p>
        </div>
      </section>

      {/* ── 6. Growth CAGR & Collapsible Financial Matrix ── */}
      <section className="vl-growth-bar">
        <div className="vl-growth-cagr-group">
          <div className="vl-cagr-item">
            <span className="vl-cagr-label">5年营收复合增速 (CAGR)</span>
            <strong className="vl-cagr-val">
              {data.revenueCagr5Y != null ? `${data.revenueCagr5Y > 0 ? "+" : ""}${data.revenueCagr5Y}%` : "—"}
            </strong>
          </div>
          <span className="vl-dot-divider">·</span>
          <div className="vl-cagr-item">
            <span className="vl-cagr-label">5年净利复合增速 (CAGR)</span>
            <strong className="vl-cagr-val">
              {data.netIncomeCagr5Y != null ? `${data.netIncomeCagr5Y > 0 ? "+" : ""}${data.netIncomeCagr5Y}%` : "—"}
            </strong>
          </div>
        </div>
      </section>

      {data.annuals.length > 0 ? (
        <section className="vl-card-table-wrap">
          <table className="vl-matrix-table">
            <thead>
              <tr>
                <th>财务科目 (FY)</th>
                {data.annuals.map((a) => (
                  <th key={a.year}>{a.year}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="vl-td-row-name">营业收入 (Revenue)</td>
                {data.annuals.map((a) => (
                  <td key={`rev-${a.year}`}>{formatCompactNumber(a.revenue)}</td>
                ))}
              </tr>
              <tr>
                <td className="vl-td-row-name">净利润 (Net Income)</td>
                {data.annuals.map((a) => (
                  <td key={`net-${a.year}`} className={a.netIncome && a.netIncome < 0 ? "vl-num--neg" : ""}>
                    {formatCompactNumber(a.netIncome)}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="vl-td-row-name">经营现金流 (OCF)</td>
                {data.annuals.map((a) => (
                  <td key={`ocf-${a.year}`}>{formatCompactNumber(a.operatingCashFlow)}</td>
                ))}
              </tr>
              <tr>
                <td className="vl-td-row-name">净资产收益率 (ROE)</td>
                {data.annuals.map((a) => (
                  <td
                    key={`roe-${a.year}`}
                    className={
                      a.roe && a.roe >= 20 ? "vl-num--high" : a.roe && a.roe < 0 ? "vl-num--neg" : ""
                    }
                  >
                    {a.roe != null ? `${a.roe}%` : "—"}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="vl-td-row-name">每股收益 (EPS)</td>
                {data.annuals.map((a) => (
                  <td key={`eps-${a.year}`}>${a.eps ? a.eps.toFixed(2) : "—"}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </section>
      ) : null}
    </article>
  );
}
