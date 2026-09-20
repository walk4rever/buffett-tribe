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

export type PricePoint = {
  time: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
  adjustedClose?: number | null;
  periodLabel?: string;
};

type PriceApiResponse = {
  ticker: string;
  range: string;
  source: string;
  data: PricePoint[];
};

type OHLCVInfo = {
  time: string;
  displayLabel: string;
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
  time: string;
  color?: string;
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
  { label: "周K", value: "week" },
  { label: "月K", value: "month" },
  { label: "季K", value: "quarter" },
] as const;

type DimensionType = (typeof DIMENSION_OPTIONS)[number]["value"];

const RANGE_OPTIONS = [
  { label: "1年", value: "1y" },
  { label: "3年", value: "3y" },
  { label: "全部", value: "all" },
] as const;

type RangeType = (typeof RANGE_OPTIONS)[number]["value"];

type ColorMode = "cn" | "us";
type AdjustMode = "qfq" | "none";

const COLOR_THEMES = {
  cn: {
    up: "#ef4444",
    down: "#22c55e",
    label: "红涨绿跌",
  },
  us: {
    up: "#22c55e",
    down: "#ef4444",
    label: "绿涨红跌",
  },
};

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

/**
 * 历史价格降采样处理：两年前为周频，近两年为日频。
 * 当用户查看“日K”时，自动剔除历史周频数据，仅保留连续日K数据段，
 * 避免时间轴拉扯畸变、成交量断崖以及 MA 均线错乱。
 */
function filterDailyData(data: PricePoint[]): PricePoint[] {
  if (data.length <= 1) return data;
  const result: PricePoint[] = [];
  for (let i = data.length - 1; i >= 0; i--) {
    result.unshift(data[i]);
    if (i > 0) {
      const t1 = new Date(data[i].time).getTime();
      const t0 = new Date(data[i - 1].time).getTime();
      const diffDays = Math.round((t1 - t0) / (24 * 3600 * 1000));
      // 若相邻点间隔超过 5 天，且往前也是大间隔，说明已进入两年前周降采样数据区
      if (diffDays >= 6 && i >= 2) {
        const tPrev = new Date(data[i - 2].time).getTime();
        const diffPrev = Math.round((t0 - tPrev) / (24 * 3600 * 1000));
        if (diffPrev >= 6) {
          break;
        }
      }
    }
  }
  return result;
}

function getIsoWeekKey(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const dayNr = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNr + 3);
  const firstThursday = d.getTime();
  d.setUTCMonth(0, 1);
  if (d.getUTCDay() !== 4) {
    d.setUTCMonth(0, 1 + ((4 - d.getUTCDay()) + 7) % 7);
  }
  const week = 1 + Math.ceil((firstThursday - d.getTime()) / 604800000);
  return `${d.getUTCFullYear()} W${String(week).padStart(2, "0")}`;
}

function aggregateWeekly(data: PricePoint[]): PricePoint[] {
  const groups = new Map<string, PricePoint[]>();
  for (const d of data) {
    const key = getIsoWeekKey(d.time);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(d);
  }

  const result: PricePoint[] = [];
  for (const [weekKey, items] of groups) {
    items.sort((a, b) => a.time.localeCompare(b.time));
    const first = items[0];
    const last = items[items.length - 1];
    result.push({
      time: last.time,
      open: first.open,
      high: Math.max(...items.map((d) => d.high ?? d.close)),
      low: Math.min(...items.map((d) => d.low ?? d.close)),
      close: last.close,
      volume: items.reduce((sum, d) => sum + (d.volume ?? 0), 0),
      periodLabel: weekKey,
    });
  }
  return result.sort((a, b) => a.time.localeCompare(b.time));
}

function aggregateMonthly(data: PricePoint[]): PricePoint[] {
  const groups = new Map<string, PricePoint[]>();
  for (const d of data) {
    const month = d.time.slice(0, 7);
    if (!groups.has(month)) groups.set(month, []);
    groups.get(month)!.push(d);
  }

  const result: PricePoint[] = [];
  for (const [month, items] of groups) {
    items.sort((a, b) => a.time.localeCompare(b.time));
    const first = items[0];
    const last = items[items.length - 1];
    result.push({
      time: last.time,
      open: first.open,
      high: Math.max(...items.map((d) => d.high ?? d.close)),
      low: Math.min(...items.map((d) => d.low ?? d.close)),
      close: last.close,
      volume: items.reduce((sum, d) => sum + (d.volume ?? 0), 0),
      periodLabel: month,
    });
  }
  return result.sort((a, b) => a.time.localeCompare(b.time));
}

function aggregateQuarterly(data: PricePoint[]): PricePoint[] {
  const groups = new Map<string, PricePoint[]>();
  for (const d of data) {
    const [year, month] = d.time.split("-").map(Number);
    const quarter = Math.ceil(month / 3);
    const key = `${year} Q${quarter}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(d);
  }

  const result: PricePoint[] = [];
  for (const [key, items] of groups) {
    items.sort((a, b) => a.time.localeCompare(b.time));
    const first = items[0];
    const last = items[items.length - 1];
    result.push({
      time: last.time,
      open: first.open,
      high: Math.max(...items.map((d) => d.high ?? d.close)),
      low: Math.min(...items.map((d) => d.low ?? d.close)),
      close: last.close,
      volume: items.reduce((sum, d) => sum + (d.volume ?? 0), 0),
      periodLabel: key,
    });
  }
  return result.sort((a, b) => a.time.localeCompare(b.time));
}

function applyAdjustment(data: PricePoint[], mode: AdjustMode): PricePoint[] {
  if (mode === "none") return data;
  return data.map((d) => {
    if (d.adjustedClose != null && d.close > 0) {
      const factor = d.adjustedClose / d.close;
      return {
        ...d,
        open: d.open != null ? Number((d.open * factor).toFixed(2)) : null,
        high: d.high != null ? Number((d.high * factor).toFixed(2)) : null,
        low: d.low != null ? Number((d.low * factor).toFixed(2)) : null,
        close: Number((d.close * factor).toFixed(2)),
        volume: d.volume != null && factor > 0 ? Math.round(d.volume / factor) : d.volume,
      };
    }
    return d;
  });
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
  const [dimension, setDimension] = useState<DimensionType>("day");
  const [range, setRange] = useState<RangeType>("1y");
  const [adjustMode, setAdjustMode] = useState<AdjustMode>("qfq");
  const [colorMode, setColorMode] = useState<ColorMode>("cn");
  const [rawData, setRawData] = useState<PricePoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoverInfo, setHoverInfo] = useState<OHLCVInfo | null>(null);

  // 初始化颜色习惯（根据用户偏好）
  useEffect(() => {
    try {
      const saved = localStorage.getItem("bt_price_chart_color_mode") as ColorMode | null;
      if (saved === "cn" || saved === "us") {
        setColorMode(saved);
      }
    } catch {
      // ignore
    }
  }, []);

  const handleColorToggle = () => {
    const nextMode: ColorMode = colorMode === "cn" ? "us" : "cn";
    setColorMode(nextMode);
    try {
      localStorage.setItem("bt_price_chart_color_mode", nextMode);
    } catch {
      // ignore
    }
  };

  const normalizedTickers = useMemo(
    () => Array.from(new Set(tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean))),
    [tickers]
  );

  // 数据聚合、复权与 O(1) 查找映射
  const { chartData, dataMap, latestInfo } = useMemo(() => {
    if (!rawData.length) {
      return { chartData: [], dataMap: new Map<string, { current: PricePoint; prev: PricePoint | null }>(), latestInfo: null };
    }
    const adjusted = applyAdjustment(rawData, adjustMode);
    let list: PricePoint[] = [];
    if (dimension === "day") {
      list = filterDailyData(adjusted);
    } else if (dimension === "week") {
      list = aggregateWeekly(adjusted);
    } else if (dimension === "month") {
      list = aggregateMonthly(adjusted);
    } else if (dimension === "quarter") {
      list = aggregateQuarterly(adjusted);
    } else {
      list = adjusted;
    }

    const map = new Map<string, { current: PricePoint; prev: PricePoint | null }>();
    for (let i = 0; i < list.length; i++) {
      map.set(list[i].time, {
        current: list[i],
        prev: i > 0 ? list[i - 1] : null,
      });
    }

    const last = list[list.length - 1];
    const prev = list.length > 1 ? list[list.length - 2] : null;
    const latest: OHLCVInfo | null = last
      ? {
          time: last.time,
          displayLabel: last.periodLabel || last.time,
          open: last.open ?? last.close,
          high: last.high ?? last.close,
          low: last.low ?? last.close,
          close: last.close,
          volume: last.volume,
          changePct: prev ? ((last.close - prev.close) / prev.close) * 100 : null,
        }
      : null;

    return { chartData: list, dataMap: map, latestInfo: latest };
  }, [rawData, dimension, adjustMode]);

  const displayInfo = hoverInfo || latestInfo;

  const candleData = useMemo<CandleSeriesData[]>(
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
        .map((v, i) => (v != null ? { time: chartData[i].time, value: Number(v.toFixed(2)) } : null))
        .filter(Boolean) as Array<{ time: string; value: number }>,
    [chartData, closes]
  );
  const ma10Data = useMemo(
    () =>
      sma(closes, 10)
        .map((v, i) => (v != null ? { time: chartData[i].time, value: Number(v.toFixed(2)) } : null))
        .filter(Boolean) as Array<{ time: string; value: number }>,
    [chartData, closes]
  );
  const ma20Data = useMemo(
    () =>
      sma(closes, 20)
        .map((v, i) => (v != null ? { time: chartData[i].time, value: Number(v.toFixed(2)) } : null))
        .filter(Boolean) as Array<{ time: string; value: number }>,
    [chartData, closes]
  );
  const ma60Data = useMemo(
    () =>
      sma(closes, 60)
        .map((v, i) => (v != null ? { time: chartData[i].time, value: Number(v.toFixed(2)) } : null))
        .filter(Boolean) as Array<{ time: string; value: number }>,
    [chartData, closes]
  );

  const themeColors = COLOR_THEMES[colorMode];

  const volData = useMemo(
    () =>
      chartData
        .filter((d) => d.volume != null)
        .map((d) => ({
          time: d.time,
          value: d.volume!,
          color: d.close >= (d.open ?? d.close) ? themeColors.up : themeColors.down,
        })),
    [chartData, themeColors]
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [selectedTicker]);

  // Keep latest dataMap accessible in crosshair callback without reattaching event listeners
  const dataMapRef = useRef(dataMap);
  useEffect(() => {
    dataMapRef.current = dataMap;
  }, [dataMap]);

  // 创建并初始化 Lightweight Chart 实例
  useEffect(() => {
    if (!chartContainerRef.current) return;

    if (!chartRef.current) {
      const chart = createChart(chartContainerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor: "#64748b",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
          attributionLogo: false,
        },
        grid: {
          vertLines: { color: "rgba(226, 232, 240, 0.6)", visible: true },
          horzLines: { color: "rgba(226, 232, 240, 0.6)", visible: true },
        },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: { color: "#94a3b8", width: 1, style: 2, visible: true },
          horzLine: { color: "#94a3b8", width: 1, style: 2, visible: false },
        },
        leftPriceScale: {
          visible: false,
        },
        rightPriceScale: {
          visible: true,
          borderVisible: false,
          scaleMargins: { top: 0.12, bottom: 0.05 },
        },
        defaultVisiblePriceScaleId: "right",
        timeScale: {
          borderVisible: false,
          timeVisible: false,
          tickMarkMaxCharacterLength: 8,
        },
        handleScroll: {
          mouseWheel: false, // 禁用鼠标滚轮水平滚动图表，让页面正常垂直滚动
          pressedMouseMove: true, // 允许按住鼠标左键拖拽平移时间轴
          horzTouchDrag: true, // 移动端单指左右平移
          vertTouchDrag: false, // 移动端允许垂直滑动正常滚动页面
        },
        handleScale: {
          axisPressedMouseMove: true, // 允许按住轴线拖拽缩放
          mouseWheel: false, // 禁用鼠标滚轮横向缩放，彻底避免劫持页面上下滚动
          pinch: true, // 允许移动端双指捏合缩放
        },
        autoSize: true,
      });
      chartRef.current = chart;

      // K 线蜡烛图（统一右轴）
      const initialTheme = COLOR_THEMES.cn;
      const candle = chart.addSeries(CandlestickSeries, {
        upColor: initialTheme.up,
        downColor: initialTheme.down,
        borderUpColor: initialTheme.up,
        borderDownColor: initialTheme.down,
        wickUpColor: initialTheme.up,
        wickDownColor: initialTheme.down,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      candleRef.current = candle;

      // MA 均线（统一右轴）
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
        color: "#64748b",
        lineWidth: 1,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      });

      // 成交量副图 Pane（统一右轴对齐）
      const volumePane = (chart as ChartWithPane).addPane();
      const volume = volumePane.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" },
        priceLineVisible: false,
        lastValueVisible: false,
      });
      volumePane.setStretchFactor(0.32);
      volumePane.priceScale("right").applyOptions({
        scaleMargins: { top: 0.15, bottom: 0 },
        borderVisible: false,
      });
      volumeRef.current = volume;

      // 悬停交互：利用 Map 做 O(1) 准确查找当前周期和前一周期
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

        const matched = dataMapRef.current.get(c.time);
        const prevClose = matched?.prev?.close ?? null;
        const displayLabel = matched?.current?.periodLabel || c.time;

        setHoverInfo({
          time: c.time,
          displayLabel,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: v?.value ?? matched?.current?.volume ?? null,
          changePct: prevClose != null ? ((c.close - prevClose) / prevClose) * 100 : null,
        });
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

  // 动态更新红绿涨跌配色方案
  useEffect(() => {
    if (!candleRef.current || !volumeRef.current) return;
    const theme = COLOR_THEMES[colorMode];
    candleRef.current.applyOptions({
      upColor: theme.up,
      downColor: theme.down,
      borderUpColor: theme.up,
      borderDownColor: theme.down,
      wickUpColor: theme.up,
      wickDownColor: theme.down,
    });
    volumeRef.current.setData(volData);
  }, [colorMode, volData]);

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

  // 更新图表数据并定位合适的初始视口（非极端全挤压）
  useEffect(() => {
    if (!rawData.length || !chartRef.current) return;

    candleRef.current?.setData(candleData);
    ma5Ref.current?.setData(ma5Data);
    ma10Ref.current?.setData(ma10Data);
    ma20Ref.current?.setData(ma20Data);
    ma60Ref.current?.setData(ma60Data);
    volumeRef.current?.setData(volData);

    const totalBars = candleData.length;
    if (totalBars > 0) {
      if (range === "all") {
        chartRef.current.timeScale().fitContent();
      } else {
        // 默认呈现最近 100~120 根 K 线的视口，饱满清晰，支持自由向左拖拽
        const count =
          range === "1y"
            ? dimension === "day"
              ? 250
              : dimension === "week"
                ? 52
                : dimension === "month"
                  ? 12
                  : 4
            : dimension === "day"
              ? 750
              : dimension === "week"
                ? 156
                : dimension === "month"
                  ? 36
                  : 12;
        const barsToShow = Math.min(totalBars, count);
        chartRef.current.timeScale().setVisibleLogicalRange({
          from: Math.max(0, totalBars - barsToShow),
          to: totalBars,
        });
      }
    }
  }, [
    rawData.length,
    candleData,
    ma5Data,
    ma10Data,
    ma20Data,
    ma60Data,
    volData,
    dimension,
    adjustMode,
    range,
  ]);

  const handleRangeSelect = (newRange: RangeType) => {
    setRange(newRange);
    if (!chartRef.current || !candleData.length) return;
    const totalBars = candleData.length;
    if (newRange === "all") {
      chartRef.current.timeScale().fitContent();
    } else {
      const count =
        newRange === "1y"
          ? dimension === "day"
            ? 250
            : dimension === "week"
              ? 52
              : dimension === "month"
                ? 12
                : 4
          : dimension === "day"
            ? 750
            : dimension === "week"
              ? 156
              : dimension === "month"
                ? 36
                : 12;
      const barsToShow = Math.min(totalBars, count);
      chartRef.current.timeScale().setVisibleLogicalRange({
        from: Math.max(0, totalBars - barsToShow),
        to: totalBars,
      });
    }
  };

  const isUp = (displayInfo?.close ?? 0) >= (displayInfo?.open ?? displayInfo?.close ?? 0);
  const upClass = isUp ? "up" : "down";

  return (
    <div className={`stock-price-chart color-mode-${colorMode}`}>
      <div className="stock-price-header">
        <div className="stock-price-left-group">
          <div className="stock-price-legend" aria-label="均线图例">
            <span className="legend-item ma5">MA5</span>
            <span className="legend-item ma10">MA10</span>
            <span className="legend-item ma20">MA20</span>
            <span className="legend-item ma60">MA60</span>
          </div>

          {normalizedTickers.length > 1 && (
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
        </div>

        <div className="stock-price-controls">
          {/* K 线周期切换 */}
          <div className="stock-price-btn-group" aria-label="K线周期切换">
            {DIMENSION_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`stock-price-range-btn ${dimension === opt.value ? "active" : ""}`}
                onClick={() => setDimension(opt.value)}
                disabled={loading}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* 时间范围快速切换 */}
          <div className="stock-price-btn-group" aria-label="时间跨度切换">
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`stock-price-range-btn ${range === opt.value ? "active" : ""}`}
                onClick={() => handleRangeSelect(opt.value)}
                disabled={loading}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* 复权与红绿偏好选项 */}
          <div className="stock-price-settings-group">
            <button
              type="button"
              className={`stock-price-setting-btn ${adjustMode === "qfq" ? "active" : ""}`}
              onClick={() => setAdjustMode(adjustMode === "qfq" ? "none" : "qfq")}
              title="切换前复权 / 不复权（前复权消除分红和拆股跳空断崖）"
            >
              {adjustMode === "qfq" ? "前复权" : "不复权"}
            </button>
            <button
              type="button"
              className="stock-price-setting-btn"
              onClick={handleColorToggle}
              title="切换红绿涨跌配色模式"
            >
              {COLOR_THEMES[colorMode].label}
            </button>
          </div>
        </div>
      </div>

      {displayInfo && (
        <div className="stock-price-info">
          <span className="info-time">{displayInfo.displayLabel || displayInfo.time}</span>
          <span className="info-ohlc">
            <span className="info-label">开</span>
            <span className={upClass}>{displayInfo.open.toFixed(2)}</span>
            <span className="info-label">高</span>
            <span className={upClass}>{displayInfo.high.toFixed(2)}</span>
            <span className="info-label">低</span>
            <span className={upClass}>{displayInfo.low.toFixed(2)}</span>
            <span className="info-label">收</span>
            <span className={upClass}>{displayInfo.close.toFixed(2)}</span>
          </span>
          {displayInfo.changePct != null && (
            <span className={`info-change ${displayInfo.changePct >= 0 ? "change-up" : "change-down"}`}>
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
