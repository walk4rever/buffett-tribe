"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AreaSeries,
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Logical,
  type Time,
} from "lightweight-charts";
import { formatUsdInYi } from "@/lib/currency";
import type { ValueLineHolder } from "@/lib/value-line-data";
import type { MasterHolderTrendPoint } from "@/lib/master-holding-trends";

type Metric = "shares" | "weight" | "value";

const METRIC_OPTIONS: Array<{ label: string; value: Metric }> = [
  { label: "持股数", value: "shares" },
  { label: "占比 %", value: "weight" },
  { label: "市值", value: "value" },
];

const METRIC_COLOR = "#3478c8";
const EMPTY_TREND: MasterHolderTrendPoint[] = [];

function quarterTime({ year, quarter }: MasterHolderTrendPoint) {
  const month = String(quarter * 3 - 1).padStart(2, "0");
  return `${year}-${month}-15`;
}

function timeKey(time: Time): string {
  if (typeof time === "string") return time;
  if (typeof time === "number") return new Date(time * 1000).toISOString().slice(0, 10);
  return `${time.year}-${String(time.month).padStart(2, "0")}-${String(time.day).padStart(2, "0")}`;
}

function metricValue(point: MasterHolderTrendPoint, metric: Metric): number | null {
  if (metric === "shares") return point.sharesNumber;
  if (metric === "weight") return point.weightPct;
  return point.valueUsd;
}

function formatMetricValue(value: number | null | undefined, metric: Metric): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (metric === "shares") return Math.round(value).toLocaleString("en-US");
  if (metric === "weight") return `${value.toFixed(2)}%`;
  return formatUsdInYi(value);
}

function priceFormat(metric: Metric) {
  return {
    type: "custom" as const,
    minMove: metric === "weight" ? 0.01 : 1,
    formatter: (value: number) => formatMetricValue(value, metric),
  };
}

export function MasterHolderTrendChart({ holder }: { holder: ValueLineHolder }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const [metric, setMetric] = useState<Metric>("shares");
  const [hoverTime, setHoverTime] = useState<string | null>(null);
  const points = holder.trend ?? EMPTY_TREND;

  const pointByTime = useMemo(
    () => new Map(points.map((point) => [quarterTime(point), point])),
    [points],
  );
  const yearCenters = useMemo(() => {
    const indexesByYear = new Map<number, number[]>();
    points.forEach((point, index) => {
      const indexes = indexesByYear.get(point.year) ?? [];
      indexes.push(index);
      indexesByYear.set(point.year, indexes);
    });
    return Array.from(indexesByYear.entries()).map(([year, indexes]) => ({
      year,
      logical: Math.round((indexes[0] + indexes[indexes.length - 1]) / 2),
    }));
  }, [points]);
  const [yearLabelPositions, setYearLabelPositions] = useState<Array<{ year: number; x: number }>>([]);

  const hasMetricValues = points.some((point) => metricValue(point, metric) != null);
  const chartData = useMemo(
    () =>
      hasMetricValues
        ? points.map((point) => {
            const time = quarterTime(point);
            const value = metricValue(point, metric);
            return value == null ? { time } : { time, value };
          })
        : [],
    [hasMetricValues, metric, points],
  );

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#64748b",
        fontSize: 12,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(226, 232, 240, 0.65)" },
        horzLines: { color: "rgba(226, 232, 240, 0.65)" },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.12, bottom: 0.08 },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: false,
        tickMarkFormatter: () => "",
      },
      crosshair: {
        vertLine: { color: "#94a3b8", width: 1, style: 2, labelVisible: false },
        horzLine: { labelVisible: false },
      },
      handleScroll: false,
      handleScale: false,
      autoSize: true,
    });
    chartRef.current = chart;
    seriesRef.current = chart.addSeries(AreaSeries, {
      lineColor: METRIC_COLOR,
      topColor: `${METRIC_COLOR}33`,
      bottomColor: `${METRIC_COLOR}03`,
      lineWidth: 2,
      lastValueVisible: false,
      priceLineVisible: false,
      pointMarkersVisible: true,
      pointMarkersRadius: 3,
      priceFormat: priceFormat(metric),
    });
    chart.subscribeCrosshairMove((param) => {
      setHoverTime(param.time ? timeKey(param.time) : null);
    });

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
    // Chart instance is created once; point lookup is refreshed through a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    seriesRef.current?.applyOptions({ priceFormat: priceFormat(metric) });
    seriesRef.current?.setData(chartData);
    if (chartData.length) chartRef.current?.timeScale().fitContent();
    setHoverTime(null);
  }, [chartData, metric]);

  useEffect(() => {
    const chart = chartRef.current;
    const container = containerRef.current;
    if (!chart || !container) return;

    let animationFrame = 0;
    const updateYearLabels = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        const positions = yearCenters
          .map(({ year, logical }) => {
            const x = chart.timeScale().logicalToCoordinate(logical as Logical);
            return x == null ? null : { year, x: Number(x) };
          })
          .filter((position): position is { year: number; x: number } => position != null);
        const spacedPositions: Array<{ year: number; x: number }> = [];
        for (const position of positions) {
          if (
            !spacedPositions.length ||
            position.x - spacedPositions[spacedPositions.length - 1].x >= 44
          ) {
            spacedPositions.push(position);
          }
        }
        const latest = positions[positions.length - 1];
        if (latest && spacedPositions[spacedPositions.length - 1]?.year !== latest.year) {
          while (
            spacedPositions.length &&
            latest.x - spacedPositions[spacedPositions.length - 1].x < 44
          ) {
            spacedPositions.pop();
          }
          spacedPositions.push(latest);
        }
        setYearLabelPositions(spacedPositions);
      });
    };

    const observer = new ResizeObserver(updateYearLabels);
    observer.observe(container);
    chart.timeScale().subscribeSizeChange(updateYearLabels);
    updateYearLabels();

    return () => {
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
      chart.timeScale().unsubscribeSizeChange(updateYearLabels);
    };
  }, [yearCenters]);

  const displayPoint =
    (hoverTime ? pointByTime.get(hoverTime) : null) ?? points[points.length - 1] ?? null;
  const displayValue = displayPoint
    ? formatMetricValue(metricValue(displayPoint, metric), metric)
    : "—";

  if (!points.length) {
    return <div className="vl-master-trend-empty">暂无季度趋势</div>;
  }

  return (
    <div className="vl-master-trend-panel" aria-label={`${holder.investorName}持仓趋势`}>
      <div className="vl-master-trend-header">
        <div className="holdings-chart-hover" aria-live="polite">
          {displayPoint ? (
            <>
              <span className="holdings-chart-hover-quarter">
                {displayPoint.year} Q{displayPoint.quarter}
              </span>
              <span className="holdings-chart-hover-value">{displayValue}</span>
            </>
          ) : (
            <span>持仓变化</span>
          )}
        </div>
        <div className="holdings-metric-toggle vl-master-trend-controls" aria-label="趋势指标">
          {METRIC_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`holdings-view-toggle-btn${metric === option.value ? " holdings-view-toggle-btn--active" : ""}`}
              aria-pressed={metric === option.value}
              onClick={() => setMetric(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="vl-master-trend-chart-wrap">
        <div
          ref={containerRef}
          className="vl-master-trend-chart"
          role="img"
          aria-label={`${holder.investorName}持股数、仓位和市值季度趋势`}
        />
        <div className="vl-master-trend-year-axis" aria-hidden="true">
          {yearLabelPositions.map(({ year, x }) => (
            <span
              key={year}
              className="vl-master-trend-year-label"
              style={{ left: x }}
            >
              {year}
            </span>
          ))}
        </div>
        {!hasMetricValues ? (
          <div className="vl-master-trend-chart-empty">该指标暂无数据</div>
        ) : null}
      </div>
    </div>
  );
}
