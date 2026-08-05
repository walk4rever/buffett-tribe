"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AreaSeries, ColorType, createChart, type IChartApi, type ISeriesApi, type Logical } from "lightweight-charts";
import { CompanyDisplayName } from "@/components/CompanyDisplayName";
import type { SecurityHistoryItem } from "@/lib/master-data";

type Metric = "pct" | "shares" | "value";

const METRIC_OPTIONS: Array<{ label: string; value: Metric }> = [
  { label: "占比 %", value: "pct" },
  { label: "持股数", value: "shares" },
  { label: "市值", value: "value" },
];

function metricValue(point: SecurityHistoryItem["history"][number], metric: Metric): number | null {
  if (metric === "pct") return point.percentOfPortfolio;
  if (metric === "shares") return point.sharesNumber;
  return point.valueUsdNumber;
}

function activityLabel(point: SecurityHistoryItem["history"][number]) {
  if (point.isExitPoint) return <span className="holdings-activity-soldout">Sold Out</span>;
  if (point.activity === "New") return <span className="holdings-activity-new">New</span>;
  if (point.activity === "Added") return <span className="holdings-activity-delta holdings-activity-delta--up">↑ Added</span>;
  if (point.activity === "Reduced") return <span className="holdings-activity-delta holdings-activity-delta--down">↓ Reduced</span>;
  return <span className="holdings-activity-delta">—</span>;
}

function HoldingHistoryChart({
  item,
  color,
  metric,
  allQuarterTimes,
}: {
  item: SecurityHistoryItem;
  color: string;
  metric: Metric;
  allQuarterTimes: string[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const [hoverPoint, setHoverPoint] = useState<SecurityHistoryItem["history"][number] | null>(null);

  const byTime = useMemo(() => new Map(item.history.map((p) => [p.time, p])), [item]);
  // Crosshair subscription below is set up once on mount, so it needs a ref to see
  // the current company's data on each hover event rather than a stale closure.
  const byTimeRef = useRef(byTime);
  useEffect(() => {
    byTimeRef.current = byTime;
  }, [byTime]);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#4b5563",
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "#f0f0f0", visible: true },
        horzLines: { color: "#f0f0f0", visible: true },
      },
      rightPriceScale: { borderVisible: false },
      // Native tick text suppressed — a tick always pins to one specific bar (chronologically
      // Q1, since our data is time-ordered), so it can't sit centered under a whole year's 4
      // points. A separate label row below (positioned via logicalToCoordinate) does that instead.
      timeScale: { borderVisible: false, tickMarkFormatter: () => "" },
      // Own hover readout above the chart already shows quarter + value, so the
      // default crosshair time/price labels would just be redundant.
      crosshair: { vertLine: { labelVisible: false }, horzLine: { labelVisible: false } },
      handleScroll: false,
      handleScale: false,
      autoSize: true,
    });
    chartRef.current = chart;
    seriesRef.current = chart.addSeries(AreaSeries, {
      lineColor: color,
      topColor: `${color}33`,
      bottomColor: `${color}03`,
      lastValueVisible: false,
      priceLineVisible: false,
      pointMarkersVisible: true,
      pointMarkersRadius: 3,
    });

    chart.subscribeCrosshairMove((param) => {
      if (!param.time) {
        setHoverPoint(null);
        return;
      }
      setHoverPoint(byTimeRef.current.get(String(param.time)) ?? null);
    });

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Color depends on the tribe member and doesn't change per-render; re-apply if it ever does.
  useEffect(() => {
    seriesRef.current?.applyOptions({ lineColor: color, topColor: `${color}33`, bottomColor: `${color}03` });
  }, [color]);

  // One entry per fund quarter (ascending, strictly required by lightweight-charts),
  // real {time,value} where this security has a point, whitespace-only {time}
  // elsewhere — so fitContent() spans the fund's full history instead of clamping to
  // just this security's own held-quarters range (setVisibleRange can't extrapolate
  // past a series' actual data, whitespace points are the supported way to pad it).
  const data = useMemo(
    () =>
      allQuarterTimes.map((time) => {
        const point = byTime.get(time);
        const value = point ? metricValue(point, metric) : null;
        return value != null ? { time, value } : { time };
      }),
    [byTime, metric, allQuarterTimes],
  );

  useEffect(() => {
    seriesRef.current?.setData(data);
    // fitContent() only fits to bars that have an actual value, so it ignores trailing
    // whitespace — logical range works on index position instead and covers the padding.
    chartRef.current?.timeScale().setVisibleLogicalRange({ from: -0.5, to: data.length - 0.5 });
  }, [data]);

  useEffect(() => {
    setHoverPoint(null);
  }, [item, metric]);

  // Each year's label sits at the midpoint of that year's own quarters (index average),
  // not on any single bar — a native tick can only pin to one bar (chronologically Q1),
  // which reads as left-aligned to the year rather than centered under its 4 points.
  const yearCenters = useMemo(() => {
    const indicesByYear = new Map<string, number[]>();
    allQuarterTimes.forEach((time, idx) => {
      const year = time.slice(0, 4);
      if (!indicesByYear.has(year)) indicesByYear.set(year, []);
      indicesByYear.get(year)!.push(idx);
    });
    return Array.from(indicesByYear.entries()).map(([year, indices]) => ({
      year,
      // logicalToCoordinate only resolves reliably for integer (real-bar) logical
      // positions, not the fractional midpoint between two bars, so round to nearest.
      logical: Math.round((indices[0] + indices[indices.length - 1]) / 2),
    }));
  }, [allQuarterTimes]);

  const [yearLabelPositions, setYearLabelPositions] = useState<Array<{ year: string; x: number }>>([]);

  const recomputeYearLabelPositions = () => {
    const chart = chartRef.current;
    if (!chart) return;
    const positions = yearCenters
      .map(({ year, logical }) => {
        const x = chart.timeScale().logicalToCoordinate(logical as Logical);
        return x != null ? { year, x: Number(x) } : null;
      })
      .filter((p): p is { year: string; x: number } => p != null);
    setYearLabelPositions(positions);
  };

  useEffect(() => {
    const raf = requestAnimationFrame(() => recomputeYearLabelPositions());
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, yearCenters]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => recomputeYearLabelPositions());
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yearCenters]);

  const displayPoint = hoverPoint ?? item.history[item.history.length - 1];
  const displayValue =
    metric === "pct"
      ? displayPoint?.percentOfPortfolio != null
        ? `${displayPoint.percentOfPortfolio.toFixed(2)}%`
        : "—"
      : metric === "shares"
        ? (displayPoint?.sharesDisplay ?? "—")
        : (displayPoint?.valueUsdDisplay ?? "—");

  return (
    <div>
      <div className="holdings-chart-hover">
        {displayPoint ? (
          <>
            <span className="holdings-chart-hover-quarter">{displayPoint.year} Q{displayPoint.quarter}</span>
            <span className="holdings-chart-hover-value">{displayValue}</span>
          </>
        ) : null}
      </div>
      <div ref={containerRef} style={{ height: 280, width: "100%", position: "relative" }} />
      <div className="holdings-chart-year-axis">
        {yearLabelPositions.map(({ year, x }) => (
          <span key={year} className="holdings-chart-year-label" style={{ left: x }}>
            {year}
          </span>
        ))}
      </div>
    </div>
  );
}

export function HoldingsHistoryExplorer({
  items,
  accentColor,
  allQuarterTimes,
}: {
  items: SecurityHistoryItem[];
  accentColor: string;
  allQuarterTimes: string[];
}) {
  const [selectedId, setSelectedId] = useState<string | undefined>(items[0]?.securityId);
  const [metric, setMetric] = useState<Metric>("pct");
  const selected = items.find((i) => i.securityId === selectedId) ?? items[0];

  if (!items.length) {
    return <p className="holdings-note">暂无持仓历史数据</p>;
  }

  return (
    <div className="holdings-company-layout">
      <aside className="holdings-company-list">
        {items.map((item) => {
          const active = item.securityId === selected?.securityId;
          return (
            <button
              key={item.securityId}
              type="button"
              className={`holdings-company-list-item${active ? " holdings-company-list-item--active" : ""}${
                item.isCurrentlyHeld ? "" : " holdings-company-list-item--exited"
              }`}
              style={active ? { borderColor: accentColor } : undefined}
              onClick={() => setSelectedId(item.securityId)}
            >
              <span className="holdings-company">
                <CompanyDisplayName zhName={item.zhName} enName={item.enName} ticker={item.ticker} compact />
              </span>
              <span className="holdings-company-list-meta">
                {item.isCurrentlyHeld
                  ? item.latestPercentOfPortfolio != null
                    ? `现仓 ${item.latestPercentOfPortfolio.toFixed(2)}%`
                    : "现仓"
                  : `已清仓 · 最后见于 ${item.lastHeldYear} Q${item.lastHeldQuarter}`}
              </span>
            </button>
          );
        })}
      </aside>

      {selected ? (
        <section className="holdings-company-detail">
          <div className="holdings-company-chart-hd">
            <span className="holdings-company">
              {selected.companyUrl ? (
                <Link href={selected.companyUrl}>
                  <CompanyDisplayName zhName={selected.zhName} enName={selected.enName} ticker={selected.ticker} compact />
                </Link>
              ) : (
                <CompanyDisplayName zhName={selected.zhName} enName={selected.enName} ticker={selected.ticker} compact />
              )}
            </span>
            <div className="holdings-metric-toggle">
              {METRIC_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`holdings-view-toggle-btn${metric === opt.value ? " holdings-view-toggle-btn--active" : ""}`}
                  style={metric === opt.value ? { borderColor: accentColor, color: accentColor } : undefined}
                  onClick={() => setMetric(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="holdings-company-chart">
            <HoldingHistoryChart
              item={selected}
              color={accentColor}
              metric={metric}
              allQuarterTimes={allQuarterTimes}
            />
          </div>

          <div className="holdings-table-wrap">
            <table className="holdings-table holdings-history-table">
              <thead>
                <tr>
                  <th className="holdings-th">季度<br/><span className="holdings-th-en">Quarter</span></th>
                  <th className="holdings-th holdings-th--num">仓位<br/><span className="holdings-th-en">% of Portfolio</span></th>
                  <th className="holdings-th">近期动作<br/><span className="holdings-th-en">Recent Activity</span></th>
                  <th className="holdings-th holdings-th--num">持股<br/><span className="holdings-th-en">Shares</span></th>
                  <th className="holdings-th holdings-th--num">申报价<br/><span className="holdings-th-en">Reported Price*</span></th>
                  <th className="holdings-th holdings-th--num">市值（亿）<br/><span className="holdings-th-en">Value</span></th>
                </tr>
              </thead>
              <tbody>
                {[...selected.history].reverse().map((point) => (
                  <tr
                    key={`${point.year}-${point.quarter}`}
                    className={`holdings-row${point.isExitPoint ? " holdings-row--soldout" : ""}`}
                  >
                    <td className="holdings-td">{point.year} Q{point.quarter}</td>
                    <td className="holdings-td holdings-td--num">
                      {point.percentOfPortfolio != null ? `${point.percentOfPortfolio.toFixed(2)}%` : "—"}
                    </td>
                    <td className="holdings-td holdings-td--act">{activityLabel(point)}</td>
                    <td className="holdings-td holdings-td--num">{point.sharesDisplay}</td>
                    <td className="holdings-td holdings-td--num">{point.reportedPriceDisplay}</td>
                    <td className="holdings-td holdings-td--num">{point.valueUsdDisplay}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
