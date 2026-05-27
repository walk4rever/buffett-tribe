"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  ColorType,
  CrosshairMode,
  type SeriesOptionsMap,
} from "lightweight-charts";

type PricePoint = {
  time: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
};

type PriceApiResponse = {
  ticker: string;
  range: string;
  source: string;
  data: PricePoint[];
};

type OHLCVInfo = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  changePct: number | null;
};

type CandleSeriesData = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

type VolumeSeriesData = {
  value: number;
};

type ChartPane = {
  addSeries: (seriesType: typeof HistogramSeries, options: Record<string, unknown>) => ISeriesApi<"Histogram">;
  setStretchFactor: (factor: number) => void;
  priceScale: (side: "right") => {
    applyOptions: (options: { scaleMargins?: { top?: number; bottom?: number }; borderVisible?: boolean }) => void;
  };
};

type ChartWithPane = IChartApi & {
  addPane: () => ChartPane;
};

const DIMENSION_OPTIONS = [
  { label: "日K", value: "day" },
  { label: "月K", value: "month" },
  { label: "季K", value: "quarter" },
];

function sma(values: (number | null)[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  let sum = 0;
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v != null) {
      sum += v;
      count++;
    }
    if (i >= period) {
      const old = values[i - period];
      if (old != null) {
        sum -= old;
        count--;
      }
    }
    result.push(i >= period - 1 && count > 0 ? sum / count : null);
  }
  return result;
}

function aggregateMonthly(data: PricePoint[]): PricePoint[] {
  const groups = new Map<string, PricePoint[]>();
  for (const d of data) {
    const month = d.time.slice(0, 7);
    if (!groups.has(month)) groups.set(month, []);
    groups.get(month)!.push(d);
  }

  const result: PricePoint[] = [];
  for (const [, items] of groups) {
    items.sort((a, b) => a.time.localeCompare(b.time));
    result.push({
      time: items[items.length - 1].time,
      open: items[0].open,
      high: Math.max(...items.map((d) => d.high ?? d.close)),
      low: Math.min(...items.map((d) => d.low ?? d.close)),
      close: items[items.length - 1].close,
      volume: items.reduce((sum, d) => sum + (d.volume ?? 0), 0),
    });
  }
  return result;
}

function aggregateQuarterly(data: PricePoint[]): PricePoint[] {
  const groups = new Map<string, PricePoint[]>();
  for (const d of data) {
    const [year, month] = d.time.split("-").map(Number);
    const quarter = Math.ceil(month / 3);
    const key = `${year}-Q${quarter}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(d);
  }

  const result: PricePoint[] = [];
  for (const [, items] of groups) {
    items.sort((a, b) => a.time.localeCompare(b.time));
    result.push({
      time: items[items.length - 1].time,
      open: items[0].open,
      high: Math.max(...items.map((d) => d.high ?? d.close)),
      low: Math.min(...items.map((d) => d.low ?? d.close)),
      close: items[items.length - 1].close,
      volume: items.reduce((sum, d) => sum + (d.volume ?? 0), 0),
    });
  }
  return result;
}

function formatVolume(v: number): string {
  if (v >= 1e8) return (v / 1e8).toFixed(1) + "亿";
  if (v >= 1e4) return (v / 1e4).toFixed(1) + "万";
  return String(Math.round(v));
}

function getSeriesPoint<TPoint, TSeries extends keyof SeriesOptionsMap>(
  seriesData: unknown,
  series: ISeriesApi<TSeries>,
) {
  if (!(seriesData instanceof Map)) return undefined;
  return seriesData.get(series) as TPoint | undefined;
}

export function StockPriceChart({ tickers }: { tickers: string[] }) {
  return <StockPriceChartInner tickers={tickers} />;
}

export function StockPriceChartInner({ tickers }: { tickers: string[] }) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const ma5Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ma10Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ma20Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ma60Ref = useRef<ISeriesApi<"Line"> | null>(null);

  const [selectedTicker, setSelectedTicker] = useState(tickers[0] ?? "");
  const [dimension, setDimension] = useState("day");
  const [rawData, setRawData] = useState<PricePoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latestInfo, setLatestInfo] = useState<OHLCVInfo | null>(null);
  const [hoverInfo, setHoverInfo] = useState<OHLCVInfo | null>(null);

  const normalizedTickers = useMemo(
    () => Array.from(new Set(tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean))),
    [tickers]
  );

  const displayInfo = hoverInfo || latestInfo;
  const chartData = useMemo(() => {
    if (!rawData.length) return [];
    if (dimension === "month") return aggregateMonthly(rawData);
    if (dimension === "quarter") return aggregateQuarterly(rawData);
    return rawData;
  }, [rawData, dimension]);

  const candleData = useMemo(
    () =>
      chartData
        .filter((d) => d.open != null && d.high != null && d.low != null)
        .map((d) => ({
          time: d.time,
          open: d.open!,
          high: d.high!,
          low: d.low!,
          close: d.close,
        })),
    [chartData]
  );

  const closes = useMemo(() => chartData.map((d) => d.close), [chartData]);
  const ma5Data = useMemo(
    () =>
      sma(closes, 5)
        .map((v, i) => (v != null ? { time: chartData[i].time, value: v } : null))
        .filter(Boolean) as Array<{ time: string; value: number }>,
    [chartData, closes]
  );
  const ma10Data = useMemo(
    () =>
      sma(closes, 10)
        .map((v, i) => (v != null ? { time: chartData[i].time, value: v } : null))
        .filter(Boolean) as Array<{ time: string; value: number }>,
    [chartData, closes]
  );
  const ma20Data = useMemo(
    () =>
      sma(closes, 20)
        .map((v, i) => (v != null ? { time: chartData[i].time, value: v } : null))
        .filter(Boolean) as Array<{ time: string; value: number }>,
    [chartData, closes]
  );
  const ma60Data = useMemo(
    () =>
      sma(closes, 60)
        .map((v, i) => (v != null ? { time: chartData[i].time, value: v } : null))
        .filter(Boolean) as Array<{ time: string; value: number }>,
    [chartData, closes]
  );
  const volData = useMemo(
    () =>
      chartData
        .filter((d) => d.volume != null)
        .map((d) => ({
          time: d.time,
          value: d.volume!,
          color: d.close >= (d.open ?? d.close) ? "#ef4444" : "#22c55e",
        })),
    [chartData]
  );

  const fetchData = useCallback(async () => {
    if (!selectedTicker) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/price/${encodeURIComponent(selectedTicker)}?range=max`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const result: PriceApiResponse = await res.json();
      setRawData(result.data);

      const last = result.data[result.data.length - 1];
      const prev = result.data[result.data.length - 2];
      if (last) {
        setLatestInfo({
          time: last.time,
          open: last.open ?? last.close,
          high: last.high ?? last.close,
          low: last.low ?? last.close,
          close: last.close,
          volume: last.volume,
          changePct: prev ? ((last.close - prev.close) / prev.close) * 100 : null,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [selectedTicker]);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    if (!chartRef.current) {
      const chart = createChart(chartContainerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor: "#4b5563",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
          attributionLogo: false,
        },
        grid: {
          vertLines: { color: "#f0f0f0", visible: true },
          horzLines: { color: "#f0f0f0", visible: true },
        },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: { color: "#9ca3af", width: 1, style: 2, visible: true },
          horzLine: { color: "#9ca3af", width: 1, style: 2, visible: false },
        },
        leftPriceScale: {
          visible: true,
          borderVisible: false,
          scaleMargins: { top: 0.15, bottom: 0.05 },
        },
        rightPriceScale: {
          visible: true,
          borderVisible: false,
          scaleMargins: { top: 0.15, bottom: 0.05 },
        },
        defaultVisiblePriceScaleId: "left",
        timeScale: {
          borderVisible: false,
          timeVisible: false,
          tickMarkMaxCharacterLength: 8,
        },
        handleScroll: true,
        handleScale: true,
        autoSize: true,
      });
      chartRef.current = chart;

      // Candlestick series — price on left
      const candle = chart.addSeries(CandlestickSeries, {
        upColor: "#ef4444",
        downColor: "#22c55e",
        borderUpColor: "#ef4444",
        borderDownColor: "#22c55e",
        wickUpColor: "#ef4444",
        wickDownColor: "#22c55e",
        lastValueVisible: false,
        priceLineVisible: false,
      });
      candleRef.current = candle;

      // MA lines — price on left
      ma5Ref.current = chart.addSeries(LineSeries, {
        color: "#f59e0b",
        lineWidth: 1,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      });
      ma10Ref.current = chart.addSeries(LineSeries, {
        color: "#8b5cf6",
        lineWidth: 1,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      });
      ma20Ref.current = chart.addSeries(LineSeries, {
        color: "#06b6d4",
        lineWidth: 1,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      });
      ma60Ref.current = chart.addSeries(LineSeries, {
        color: "#6b7280",
        lineWidth: 1,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      });

      // Volume pane — separate from main price chart
      const volumePane = (chart as ChartWithPane).addPane();
      const volume = volumePane.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" },
        priceLineVisible: false,
        lastValueVisible: false,
      });
      volumePane.setStretchFactor(0.35);
      volumePane.priceScale("right").applyOptions({
        scaleMargins: { top: 0.1, bottom: 0 },
        borderVisible: false,
      });
      volumeRef.current = volume;

      // Crosshair hover → OHLCV tooltip
      chart.subscribeCrosshairMove((param) => {
        if (!param.time || !candleRef.current) {
          setHoverInfo(null);
          return;
        }
        const c = getSeriesPoint<CandleSeriesData, "Candlestick">(param.seriesData, candleRef.current);
        if (!c) {
          setHoverInfo(null);
          return;
        }
        const v = volumeRef.current
          ? getSeriesPoint<VolumeSeriesData, "Histogram">(param.seriesData, volumeRef.current)
          : undefined;

        // find prev close for change%
        const all = rawDataRef.current;
        const idx = all.findIndex((d) => d.time === c.time);
        const prevClose = idx > 0 ? all[idx - 1]?.close ?? null : null;

        setHoverInfo({
          time: c.time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: v?.value ?? null,
          changePct: prevClose != null ? ((c.close - prevClose) / prevClose) * 100 : null,
        });
      });

      // Hide crosshair labels
      chart.applyOptions({
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: { visible: true, labelVisible: false },
          horzLine: { visible: false, labelVisible: false },
        },
      });
    }

    return () => {
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
        candleRef.current = null;
        volumeRef.current = null;
        ma5Ref.current = null;
        ma10Ref.current = null;
        ma20Ref.current = null;
        ma60Ref.current = null;
      }
    };
  }, []);

  // Keep rawData accessible in crosshair callback
  const rawDataRef = useRef(rawData);
  useEffect(() => {
    rawDataRef.current = rawData;
  }, [rawData]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!normalizedTickers.length) {
      setSelectedTicker("");
      return;
    }
    setSelectedTicker((current) => {
      if (normalizedTickers.includes(current)) return current;
      return normalizedTickers[0];
    });
  }, [normalizedTickers]);

  useEffect(() => {
    if (!rawData.length) return;

    candleRef.current?.setData(candleData);
    ma5Ref.current?.setData(ma5Data);
    ma10Ref.current?.setData(ma10Data);
    ma20Ref.current?.setData(ma20Data);
    ma60Ref.current?.setData(ma60Data);
    volumeRef.current?.setData(volData);

    chartRef.current?.timeScale().fitContent();
  }, [rawData.length, candleData, ma5Data, ma10Data, ma20Data, ma60Data, volData, dimension]);

  return (
    <div className="stock-price-chart">
      <div className="stock-price-header">
        <div className="stock-price-legend">
          <span className="legend-item ma5">MA5</span>
          <span className="legend-item ma10">MA10</span>
          <span className="legend-item ma20">MA20</span>
          <span className="legend-item ma60">MA60</span>
        </div>
        {normalizedTickers.length > 0 && (
          <div className="stock-price-ticker-tabs" role="tablist" aria-label="价格历史 ticker 切换">
            {normalizedTickers.map((item) => (
              <button
                key={item}
                type="button"
                className={`stock-price-ticker-tab ${selectedTicker === item ? "active" : ""}`}
                onClick={() => setSelectedTicker(item)}
                disabled={loading}
                aria-pressed={selectedTicker === item}
              >
                {item}
              </button>
            ))}
          </div>
        )}
        <div className="stock-price-ranges">
          {DIMENSION_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`stock-price-range-btn ${dimension === opt.value ? "active" : ""}`}
              onClick={() => setDimension(opt.value)}
              disabled={loading}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {displayInfo && (
        <div className="stock-price-info">
          <span className="info-time">{displayInfo.time}</span>
          <span className="info-ohlc">
            <span className="info-label">开</span>
            <span className={displayInfo.close >= displayInfo.open ? "up" : "down"}>
              {displayInfo.open.toFixed(2)}
            </span>
            <span className="info-label">高</span>
            <span className={displayInfo.close >= displayInfo.open ? "up" : "down"}>
              {displayInfo.high.toFixed(2)}
            </span>
            <span className="info-label">低</span>
            <span className={displayInfo.close >= displayInfo.open ? "up" : "down"}>
              {displayInfo.low.toFixed(2)}
            </span>
            <span className="info-label">收</span>
            <span className={displayInfo.close >= displayInfo.open ? "up" : "down"}>
              {displayInfo.close.toFixed(2)}
            </span>
          </span>
          {displayInfo.changePct != null && (
            <span className={`info-change ${displayInfo.changePct >= 0 ? "up" : "down"}`}>
              {displayInfo.changePct >= 0 ? "+" : ""}
              {displayInfo.changePct.toFixed(2)}%
            </span>
          )}
          {displayInfo.volume != null && (
            <span className="info-vol">
              <span className="info-label">量</span>
              {formatVolume(displayInfo.volume)}
            </span>
          )}
        </div>
      )}

      {error && <p className="stock-price-error">{error}</p>}

      <div className="stock-price-body">
        <div
          ref={chartContainerRef}
          className="stock-price-canvas"
          style={{ height: 320, width: "100%", position: "relative" }}
        />
      </div>
    </div>
  );
}
