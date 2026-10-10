"use client";

import { useMemo, useState } from "react";
import type { ValueLineData } from "@/lib/value-line-data";

function getCurrencySymbol(market: "us" | "hk" | "cn"): { symbol: string; code: string } {
  switch (market) {
    case "cn":
      return { symbol: "¥", code: "CNY" };
    case "hk":
      return { symbol: "HK$", code: "HKD" };
    case "us":
    default:
      return { symbol: "$", code: "USD" };
  }
}

/**
 * Catmull-Rom to Cubic Bezier Spline for smooth financial curves
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

type ValuationAnalysisViewProps = {
  data: ValueLineData;
};

export function ValuationAnalysisView({ data }: ValuationAnalysisViewProps) {
  const { symbol: currencySymbol } = getCurrencySymbol(data.market);

  // Active pricing & fundamentals
  const latestPrice = data.latestPrice ?? (data.pricePoints.length ? data.pricePoints[data.pricePoints.length - 1].close : null);
  const benchmarkPe = data.benchmarkPe ?? 18.0;
  const currentPe = data.peRatio ?? (latestPrice && data.annuals.length && data.annuals[data.annuals.length - 1].eps && (data.annuals[data.annuals.length - 1].eps ?? 0) > 0 ? Number((latestPrice / (data.annuals[data.annuals.length - 1].eps ?? 1)).toFixed(1)) : null);
  const latestAnnual = data.annuals.length ? data.annuals[data.annuals.length - 1] : null;
  const latestEps = latestAnnual?.eps ?? (currentPe && latestPrice ? Number((latestPrice / currentPe).toFixed(2)) : null);

  // 1. Compute Historical PE Percentile
  const historicalPeMetrics = useMemo(() => {
    if (!data.pricePoints.length || !data.annuals.length) {
      return { peMin: null, peMedian: benchmarkPe, peMax: null, currentPercentile: null, sampleCount: 0 };
    }

    const epsByYear = new Map<number, number>();
    data.annuals.forEach((a) => {
      if (a.eps != null && a.eps > 0) epsByYear.set(a.year, a.eps);
    });

    const minYear = Math.min(...data.annuals.map((a) => a.year));
    const maxYear = Math.max(...data.annuals.map((a) => a.year));

    const pes: number[] = [];
    data.pricePoints.forEach((p) => {
      const yr = parseInt(p.date.slice(0, 4), 10);
      const targetYr = Math.max(minYear, Math.min(maxYear, yr));
      const eps = epsByYear.get(targetYr) ?? epsByYear.get(maxYear);
      if (eps != null && eps > 0 && p.close > 0) {
        const pe = p.close / eps;
        if (pe > 2 && pe < 300) {
          pes.push(pe);
        }
      }
    });

    if (!pes.length) {
      return { peMin: null, peMedian: benchmarkPe, peMax: null, currentPercentile: null, sampleCount: 0 };
    }

    pes.sort((a, b) => a - b);
    const peMin = Number(pes[Math.floor(pes.length * 0.05)].toFixed(1));
    const peMedian = Number(pes[Math.floor(pes.length * 0.5)].toFixed(1));
    const peMax = Number(pes[Math.floor(pes.length * 0.95)].toFixed(1));

    let currentPercentile: number | null = null;
    if (currentPe != null && currentPe > 0) {
      const below = pes.filter((p) => p <= currentPe).length;
      currentPercentile = Number(((below / pes.length) * 100).toFixed(0));
    }

    return { peMin, peMedian: peMedian || benchmarkPe, peMax, currentPercentile, sampleCount: pes.length };
  }, [data.pricePoints, data.annuals, benchmarkPe, currentPe]);

  // FCF Yield & Additional Multiples
  const fcfYield = useMemo(() => {
    if (!latestAnnual?.freeCashFlow || !data.marketCap || data.marketCap <= 0) return null;
    const ratio = (latestAnnual.freeCashFlow / data.marketCap) * 100;
    return Number(ratio.toFixed(1));
  }, [latestAnnual, data.marketCap]);

  // Margin of safety status
  const valuationDiffPct = data.valuationDiffPct ?? (currentPe && historicalPeMetrics.peMedian ? Number((((currentPe - historicalPeMetrics.peMedian) / historicalPeMetrics.peMedian) * 100).toFixed(1)) : null);

  let marginOfSafetyTag = "合理中枢";
  let marginOfSafetyClass = "val-tag--neutral";
  let marginOfSafetyDesc = "当前估值贴近历史合理中枢水平，胜率适中。";

  if (valuationDiffPct != null) {
    if (valuationDiffPct <= -20) {
      marginOfSafetyTag = `深度安全边际（折价 ${Math.abs(valuationDiffPct).toFixed(0)}%）`;
      marginOfSafetyClass = "val-tag--deep-green";
      marginOfSafetyDesc = "当前市盈率显著低于历史中枢，处于极具吸引力的巴菲特式击球区。";
    } else if (valuationDiffPct <= -5) {
      marginOfSafetyTag = `合理偏低（折价 ${Math.abs(valuationDiffPct).toFixed(0)}%）`;
      marginOfSafetyClass = "val-tag--green";
      marginOfSafetyDesc = "具备适度估值安全垫，提供良好入场赔率。";
    } else if (valuationDiffPct <= 15) {
      marginOfSafetyTag = `估值中枢（合理区间）`;
      marginOfSafetyClass = "val-tag--amber";
      marginOfSafetyDesc = "价格与企业内在价值中枢高度一致，回报主要来自企业自身盈利增长。";
    } else if (valuationDiffPct <= 30) {
      marginOfSafetyTag = `估值偏高（溢价 ${valuationDiffPct.toFixed(0)}%）`;
      marginOfSafetyClass = "val-tag--orange";
      marginOfSafetyDesc = "估值高于历史中位数，需企业高速增长消化估值溢价。";
    } else {
      marginOfSafetyTag = `高估值承压（显著溢价 ${valuationDiffPct.toFixed(0)}%）`;
      marginOfSafetyClass = "val-tag--red";
      marginOfSafetyDesc = "历史高分位估值，存在戴维斯双杀及均值回归风险。";
    }
  }

  // 2. PE-Band SVG Chart data
  const peBandData = useMemo(() => {
    const width = 760;
    const height = 240;
    const padding = { top: 20, right: 30, bottom: 30, left: 45 };

    const pts = data.pricePoints;
    if (!pts || pts.length < 2) return null;

    const basePe = historicalPeMetrics.peMedian ?? 18;
    const mults = {
      p0_7: Number((basePe * 0.7).toFixed(1)),
      p1_0: Number((basePe * 1.0).toFixed(1)),
      p1_3: Number((basePe * 1.3).toFixed(1)),
      p1_6: Number((basePe * 1.6).toFixed(1)),
    };

    const epsByYear = new Map<number, number>();
    data.annuals.forEach((a) => {
      if (a.eps != null && a.eps > 0) epsByYear.set(a.year, a.eps);
    });
    const minYr = Math.min(...data.annuals.map((a) => a.year));
    const maxYr = Math.max(...data.annuals.map((a) => a.year));

    const bandPoints = pts.map((p) => {
      const yr = parseInt(p.date.slice(0, 4), 10);
      const targetYr = Math.max(minYr, Math.min(maxYr, yr));
      const eps = epsByYear.get(targetYr) ?? epsByYear.get(maxYr) ?? (latestPrice ? latestPrice / basePe : 1);
      return {
        date: p.date,
        price: p.close,
        eps,
        pe: eps > 0 ? Number((p.close / eps).toFixed(1)) : null,
        b0_7: Number((eps * mults.p0_7).toFixed(2)),
        b1_0: Number((eps * mults.p1_0).toFixed(2)),
        b1_3: Number((eps * mults.p1_3).toFixed(2)),
        b1_6: Number((eps * mults.p1_6).toFixed(2)),
      };
    });

    let rawMin = Infinity;
    let rawMax = -Infinity;
    bandPoints.forEach((b) => {
      rawMin = Math.min(rawMin, b.price, b.b0_7);
      rawMax = Math.max(rawMax, b.price, b.b1_6);
    });

    if (!Number.isFinite(rawMin) || !Number.isFinite(rawMax) || rawMin >= rawMax) {
      rawMin = 1;
      rawMax = 100;
    }

    const yMin = Math.max(0, rawMin * 0.9);
    const yMax = rawMax * 1.1;

    const plotW = width - padding.left - padding.right;
    const plotH = height - padding.top - padding.bottom;

    const getX = (idx: number) => padding.left + (idx / (bandPoints.length - 1)) * plotW;
    const getY = (val: number) => padding.top + plotH - ((val - yMin) / (yMax - yMin)) * plotH;

    const priceCoords = bandPoints.map((b, i) => ({ x: getX(i), y: getY(b.price) }));
    const b0_7Coords = bandPoints.map((b, i) => ({ x: getX(i), y: getY(b.b0_7) }));
    const b1_0Coords = bandPoints.map((b, i) => ({ x: getX(i), y: getY(b.b1_0) }));
    const b1_3Coords = bandPoints.map((b, i) => ({ x: getX(i), y: getY(b.b1_3) }));
    const b1_6Coords = bandPoints.map((b, i) => ({ x: getX(i), y: getY(b.b1_6) }));

    const pricePathD = buildSmoothSpline(priceCoords);
    const b0_7PathD = buildSmoothSpline(b0_7Coords);
    const b1_0PathD = buildSmoothSpline(b1_0Coords);
    const b1_3PathD = buildSmoothSpline(b1_3Coords);
    const b1_6PathD = buildSmoothSpline(b1_6Coords);

    // Channel fill between 0.7x and 1.6x
    let corridorFillD = "";
    if (b0_7Coords.length > 1) {
      corridorFillD = `M ${b0_7Coords[0].x.toFixed(1)} ${b0_7Coords[0].y.toFixed(1)}`;
      for (let i = 1; i < b0_7Coords.length; i++) {
        corridorFillD += ` L ${b0_7Coords[i].x.toFixed(1)} ${b0_7Coords[i].y.toFixed(1)}`;
      }
      for (let i = b1_6Coords.length - 1; i >= 0; i--) {
        corridorFillD += ` L ${b1_6Coords[i].x.toFixed(1)} ${b1_6Coords[i].y.toFixed(1)}`;
      }
      corridorFillD += " Z";
    }

    const yTicks = [
      { y: getY(yMin), label: `${currencySymbol}${yMin.toFixed(0)}` },
      { y: getY(yMin + (yMax - yMin) * 0.5), label: `${currencySymbol}${(yMin + (yMax - yMin) * 0.5).toFixed(0)}` },
      { y: getY(yMax), label: `${currencySymbol}${yMax.toFixed(0)}` },
    ];

    const yearTicks: Array<{ x: number; label: string }> = [];
    const seenYears = new Set<string>();
    bandPoints.forEach((b, idx) => {
      const yr = b.date.slice(0, 4);
      if (!seenYears.has(yr)) {
        seenYears.add(yr);
        yearTicks.push({ x: getX(idx), label: yr });
      }
    });

    return {
      width,
      height,
      padding,
      mults,
      bandPoints,
      priceCoords,
      pricePathD,
      b0_7PathD,
      b1_0PathD,
      b1_3PathD,
      b1_6PathD,
      corridorFillD,
      yTicks,
      yearTicks,
      yMin,
      yMax,
    };
  }, [data.pricePoints, data.annuals, historicalPeMetrics.peMedian, latestPrice, currencySymbol]);

  // Interactive Hover State for PE-Band
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  // 3. Interactive 5-Year TSR Simulator State
  const defaultGrowth = useMemo(() => {
    if (data.annuals.length >= 4) {
      const first = data.annuals[0].eps;
      const last = data.annuals[data.annuals.length - 1].eps;
      if (first && last && first > 0 && last > 0) {
        const span = data.annuals.length - 1;
        const cagr = ((last / first) ** (1 / span) - 1) * 100;
        return Number(Math.max(-5, Math.min(25, cagr)).toFixed(1));
      }
    }
    return 8.0;
  }, [data.annuals]);

  const [activeScenario, setActiveScenario] = useState<"conservative" | "base" | "optimistic" | "custom">("base");
  const [growthRate, setGrowthRate] = useState<number>(defaultGrowth);
  const [exitPe, setExitPe] = useState<number>(Number(benchmarkPe.toFixed(1)));
  const [shareholderYield, setShareholderYield] = useState<number>(2.5);

  const handleScenarioPreset = (preset: "conservative" | "base" | "optimistic") => {
    setActiveScenario(preset);
    if (preset === "conservative") {
      setGrowthRate(Number(Math.max(1, defaultGrowth * 0.4).toFixed(1)));
      setExitPe(Number((benchmarkPe * 0.8).toFixed(1)));
      setShareholderYield(2.0);
    } else if (preset === "base") {
      setGrowthRate(defaultGrowth);
      setExitPe(Number(benchmarkPe.toFixed(1)));
      setShareholderYield(2.5);
    } else {
      setGrowthRate(Number(Math.min(30, defaultGrowth * 1.5 + 4).toFixed(1)));
      setExitPe(Number((benchmarkPe * 1.3).toFixed(1)));
      setShareholderYield(3.0);
    }
  };

  const handleSliderChange = (type: "growth" | "exitPe" | "yield", val: number) => {
    setActiveScenario("custom");
    if (type === "growth") setGrowthRate(val);
    if (type === "exitPe") setExitPe(val);
    if (type === "yield") setShareholderYield(val);
  };

  // Math calculation of 5Y Return
  const tsrCalculations = useMemo(() => {
    if (!latestEps || latestEps <= 0 || !latestPrice || latestPrice <= 0) {
      return null;
    }

    const targetEps = latestEps * (1 + growthRate / 100) ** 5;
    const targetPrice = targetEps * exitPe;
    const priceChangePct = ((targetPrice - latestPrice) / latestPrice) * 100;

    // Compound Annual Growth Rate (CAGR) with dividend reinvestment / shareholder yield
    const priceCagr = (targetPrice / latestPrice) ** 0.2 - 1;
    const totalCagrPct = (priceCagr + shareholderYield / 100) * 100;

    let ratingTag = "合理收益";
    let ratingClass = "tsr-pill--amber";
    if (totalCagrPct >= 15) {
      ratingTag = "卓越回报 (IRR ≥ 15%)";
      ratingClass = "tsr-pill--green";
    } else if (totalCagrPct >= 8) {
      ratingTag = "稳健回报 (8%~15%)";
      ratingClass = "tsr-pill--light-green";
    } else if (totalCagrPct >= 0) {
      ratingTag = "跑输通胀 (0%~8%)";
      ratingClass = "tsr-pill--slate";
    } else {
      ratingTag = "本金亏损风险 (< 0%)";
      ratingClass = "tsr-pill--red";
    }

    return {
      targetEps: Number(targetEps.toFixed(2)),
      targetPrice: Number(targetPrice.toFixed(2)),
      priceChangePct: Number(priceChangePct.toFixed(1)),
      totalCagrPct: Number(totalCagrPct.toFixed(1)),
      ratingTag,
      ratingClass,
    };
  }, [latestEps, latestPrice, growthRate, exitPe, shareholderYield]);

  const activePoint = peBandData && hoverIdx != null ? peBandData.bandPoints[hoverIdx] : peBandData ? peBandData.bandPoints[peBandData.bandPoints.length - 1] : null;

  return (
    <div className="val-deep-dive">
      {/* ── 1. Header & Margin of Safety Matrix ── */}
      <div className="val-section-head">
        <div>
          <div className="val-title-row">
            <h3 className="val-title">估值分析与安全边际精算</h3>
            <span className={`val-status-badge ${marginOfSafetyClass}`}>{marginOfSafetyTag}</span>
          </div>
          <p className="val-subtitle">{marginOfSafetyDesc}</p>
        </div>
        <span className="company-gen-meta">
          实时精算 · 数据基准 {data.latestPriceDate || "最新收盘"}
        </span>
      </div>

      {/* 6-Card Multiples Matrix */}
      <div className="val-multiples-grid">
        <div className="val-multiple-card">
          <span className="val-card-label">当前市盈率 P/E (TTM)</span>
          <div className="val-card-val-row">
            <span className="val-card-val">{currentPe ? `${currentPe}x` : "—"}</span>
            {historicalPeMetrics.currentPercentile != null ? (
              <span className="val-card-subtag">历史 {historicalPeMetrics.currentPercentile}% 分位</span>
            ) : null}
          </div>
          <span className="val-card-hint">
            5年区间: {historicalPeMetrics.peMin ? `${historicalPeMetrics.peMin}x` : "—"} ~ {historicalPeMetrics.peMax ? `${historicalPeMetrics.peMax}x` : "—"}
          </span>
        </div>

        <div className="val-multiple-card">
          <span className="val-card-label">历史合理中枢 (Benchmark P/E)</span>
          <div className="val-card-val-row">
            <span className="val-card-val">{historicalPeMetrics.peMedian ? `${historicalPeMetrics.peMedian}x` : "—"}</span>
            {valuationDiffPct != null ? (
              <span className={`val-card-subtag ${valuationDiffPct <= 0 ? "val-tag--sub-green" : "val-tag--sub-red"}`}>
                {valuationDiffPct <= 0 ? `低估 ${Math.abs(valuationDiffPct)}%` : `溢价 ${valuationDiffPct}%`}
              </span>
            ) : null}
          </div>
          <span className="val-card-hint">基于历史长周期中位数与 ROE 锚定</span>
        </div>

        <div className="val-multiple-card">
          <span className="val-card-label">自由现金流收益率 (FCF Yield)</span>
          <div className="val-card-val-row">
            <span className="val-card-val">{fcfYield != null ? `${fcfYield}%` : "—"}</span>
            {fcfYield != null ? (
              <span className={`val-card-subtag ${fcfYield >= 4.5 ? "val-tag--sub-green" : "val-tag--sub-slate"}`}>
                {fcfYield >= 4.0 ? "胜过美债" : "适度水平"}
              </span>
            ) : null}
          </div>
          <span className="val-card-hint">FCF / 市值 · 真实股东自由现金流回报</span>
        </div>

        <div className="val-multiple-card">
          <span className="val-card-label">市净率 P/B (净资产倍数)</span>
          <div className="val-card-val-row">
            <span className="val-card-val">{data.pbRatio ? `${data.pbRatio}x` : "—"}</span>
          </div>
          <span className="val-card-hint">净资产底线与破产保护安全垫</span>
        </div>

        <div className="val-multiple-card">
          <span className="val-card-label">现金流转化率 (OCF / 净利润)</span>
          <div className="val-card-val-row">
            <span className="val-card-val">{data.cashConversionRatio ? `${data.cashConversionRatio.toFixed(2)}x` : "—"}</span>
            {data.cashConversionRatio != null ? (
              <span className={`val-card-subtag ${data.cashConversionRatio >= 1.0 ? "val-tag--sub-green" : "val-tag--sub-orange"}`}>
                {data.cashConversionRatio >= 1.0 ? "盈利含金量高" : "部分应收/资本占用"}
              </span>
            ) : null}
          </div>
          <span className="val-card-hint">衡量账面净利润向真实真金白银的转化度</span>
        </div>

        <div className="val-multiple-card">
          <span className="val-card-label">5年平均 ROE (净资产收益率)</span>
          <div className="val-card-val-row">
            <span className="val-card-val">{data.roeAvg5Y ? `${data.roeAvg5Y.toFixed(1)}%` : "—"}</span>
            {data.roeStability ? (
              <span className="val-card-subtag">
                {data.roeStability === "stellar" ? "极其稳固" : data.roeStability === "solid" ? "稳健优质" : "具备周期性"}
              </span>
            ) : null}
          </div>
          <span className="val-card-hint">巴菲特第一衡量指标：长期复利天花板</span>
        </div>
      </div>

      {/* ── 2. PE-Band Historical Corridor SVG Chart ── */}
      {peBandData ? (
        <div className="val-chart-block">
          <div className="val-chart-header">
            <div>
              <h4 className="val-block-title">历史估值通道走廊 (P/E Band Corridor)</h4>
              <span className="val-block-desc">
                股价穿行于极端悲观(0.7x)、中枢(1.0x)、乐观(1.3x)与极度狂热(1.6x)多重估值彩带中的历史周期穿越
              </span>
            </div>

            {/* Current Point Legend */}
            <div className="val-band-legend">
              <span className="legend-item"><span className="legend-dot dot-b0_7" />0.7x 极度悲观 ({peBandData.mults.p0_7}x)</span>
              <span className="legend-item"><span className="legend-dot dot-b1_0" />1.0x 历史中枢 ({peBandData.mults.p1_0}x)</span>
              <span className="legend-item"><span className="legend-dot dot-b1_3" />1.3x 历史乐观 ({peBandData.mults.p1_3}x)</span>
              <span className="legend-item"><span className="legend-dot dot-b1_6" />1.6x 极端狂热 ({peBandData.mults.p1_6}x)</span>
              <span className="legend-item legend-item--active"><span className="legend-dot dot-price" />实际收盘价</span>
            </div>
          </div>

          {/* Interactive HUD Inspection Bar */}
          <div className="val-hud-row">
            <div className="val-hud-col">
              <span className="val-hud-label">日期:</span>
              <span className="val-hud-value">{activePoint?.date}</span>
            </div>
            <div className="val-hud-col">
              <span className="val-hud-label">股价:</span>
              <span className="val-hud-value val-hud-value--blue">{currencySymbol}{activePoint?.price.toFixed(2)}</span>
            </div>
            <div className="val-hud-col">
              <span className="val-hud-label">对应 P/E:</span>
              <span className="val-hud-value">{activePoint?.pe ? `${activePoint.pe}x` : "—"}</span>
            </div>
            <div className="val-hud-col">
              <span className="val-hud-label">基准中枢线:</span>
              <span className="val-hud-value val-hud-value--amber">{currencySymbol}{activePoint?.b1_0.toFixed(2)}</span>
            </div>
            <div className="val-hud-col">
              <span className="val-hud-label">通道状态:</span>
              <span className="val-hud-tag">
                {activePoint && activePoint.pe
                  ? activePoint.pe < peBandData.mults.p0_7
                    ? "跌破 0.7x 底部极端超跌"
                    : activePoint.pe < peBandData.mults.p1_0
                    ? "处于 0.7x ~ 1.0x 安全边际击球区"
                    : activePoint.pe < peBandData.mults.p1_3
                    ? "处于 1.0x ~ 1.3x 估值中枢上方"
                    : "处于 1.3x 以上高估值风险区"
                  : "正常"}
              </span>
            </div>
          </div>

          <div className="val-svg-wrap">
            <svg
              viewBox={`0 0 ${peBandData.width} ${peBandData.height}`}
              className="val-pe-svg"
              onMouseLeave={() => setHoverIdx(null)}
            >
              <defs>
                <linearGradient id="val-corridor-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ef4444" stopOpacity="0.06" />
                  <stop offset="50%" stopColor="#f59e0b" stopOpacity="0.04" />
                  <stop offset="100%" stopColor="#10b981" stopOpacity="0.06" />
                </linearGradient>
              </defs>

              {/* Y Axis Grid Lines */}
              {peBandData.yTicks.map((tick) => (
                <g key={tick.label}>
                  <line
                    x1={peBandData.padding.left}
                    y1={tick.y}
                    x2={peBandData.width - peBandData.padding.right}
                    y2={tick.y}
                    stroke="rgba(148, 163, 184, 0.2)"
                    strokeDasharray="3 3"
                  />
                  <text
                    x={peBandData.padding.left - 6}
                    y={tick.y + 3}
                    textAnchor="end"
                    className="val-axis-text"
                  >
                    {tick.label}
                  </text>
                </g>
              ))}

              {/* Channel Shaded Area */}
              {peBandData.corridorFillD ? (
                <path d={peBandData.corridorFillD} fill="url(#val-corridor-grad)" />
              ) : null}

              {/* Band Lines */}
              <path d={peBandData.b1_6PathD} fill="none" stroke="#ef4444" strokeWidth="1" strokeDasharray="3 3" opacity="0.65" />
              <path d={peBandData.b1_3PathD} fill="none" stroke="#3b82f6" strokeWidth="1" strokeDasharray="3 3" opacity="0.65" />
              <path d={peBandData.b1_0PathD} fill="none" stroke="#f59e0b" strokeWidth="1.2" strokeDasharray="4 2" opacity="0.9" />
              <path d={peBandData.b0_7PathD} fill="none" stroke="#10b981" strokeWidth="1" strokeDasharray="3 3" opacity="0.75" />

              {/* Real Price Curve */}
              <path d={peBandData.pricePathD} fill="none" stroke="#0071e3" strokeWidth="2.2" strokeLinecap="round" />

              {/* X Axis Year Marks */}
              {peBandData.yearTicks.map((yr) => (
                <text
                  key={yr.label}
                  x={yr.x}
                  y={peBandData.height - 8}
                  textAnchor="middle"
                  className="val-axis-text"
                >
                  {yr.label}
                </text>
              ))}

              {/* Hover Crosshair & Pointer */}
              {hoverIdx != null && peBandData.priceCoords[hoverIdx] ? (
                <g>
                  <line
                    x1={peBandData.priceCoords[hoverIdx].x}
                    y1={peBandData.padding.top}
                    x2={peBandData.priceCoords[hoverIdx].x}
                    y2={peBandData.height - peBandData.padding.bottom}
                    stroke="#0071e3"
                    strokeWidth="1"
                    strokeDasharray="2 2"
                  />
                  <circle
                    cx={peBandData.priceCoords[hoverIdx].x}
                    cy={peBandData.priceCoords[hoverIdx].y}
                    r="4"
                    fill="#0071e3"
                    stroke="#ffffff"
                    strokeWidth="2"
                  />
                </g>
              ) : null}

              {/* Invisible Hover Rects for Interaction */}
              {peBandData.priceCoords.map((coord, idx) => {
                const w = peBandData.width / peBandData.priceCoords.length;
                return (
                  <rect
                    key={idx}
                    x={coord.x - w / 2}
                    y={peBandData.padding.top}
                    width={w}
                    height={peBandData.height - peBandData.padding.top - peBandData.padding.bottom}
                    fill="transparent"
                    onMouseEnter={() => setHoverIdx(idx)}
                  />
                );
              })}
            </svg>
          </div>
        </div>
      ) : null}

      {/* ── 3. Interactive 5-Year TSR Simulator ── */}
      {tsrCalculations && latestPrice ? (
        <div className="val-sim-block">
          <div className="val-sim-head">
            <div>
              <h4 className="val-block-title">5年股东总回报预期模拟器 (5-Year TSR Simulator)</h4>
              <p className="val-block-desc">
                基于最新股价与真实盈利基准，交互推演不同成长速度与退出估值下的<strong>未来目标价</strong>与<strong>预期年化复合收益率 (IRR)</strong>
              </p>
            </div>

            {/* Scenario Preset Buttons */}
            <div className="val-preset-group">
              <button
                type="button"
                className={`preset-btn ${activeScenario === "conservative" ? "preset-btn--active" : ""}`}
                onClick={() => handleScenarioPreset("conservative")}
              >
                保守压力测试
              </button>
              <button
                type="button"
                className={`preset-btn ${activeScenario === "base" ? "preset-btn--active" : ""}`}
                onClick={() => handleScenarioPreset("base")}
              >
                基准均值回归
              </button>
              <button
                type="button"
                className={`preset-btn ${activeScenario === "optimistic" ? "preset-btn--active" : ""}`}
                onClick={() => handleScenarioPreset("optimistic")}
              >
                戴维斯双击
              </button>
            </div>
          </div>

          <div className="val-sim-grid">
            {/* Left Column: Sliders */}
            <div className="val-sliders-pane">
              {/* Slider 1: EPS Growth */}
              <div className="val-slider-item">
                <div className="slider-label-row">
                  <span className="slider-label">未来 5 年 EPS 年化复合增速 (g)</span>
                  <span className="slider-value-badge">{growthRate > 0 ? `+${growthRate}%` : `${growthRate}%`}</span>
                </div>
                <input
                  type="range"
                  min="-5"
                  max="30"
                  step="0.5"
                  value={growthRate}
                  onChange={(e) => handleSliderChange("growth", parseFloat(e.target.value))}
                  className="val-range-input"
                />
                <div className="slider-scale-row">
                  <span>-5% (衰退)</span>
                  <span>+8% (稳健)</span>
                  <span>+20% (高增长)</span>
                  <span>+30%</span>
                </div>
              </div>

              {/* Slider 2: Exit PE */}
              <div className="val-slider-item">
                <div className="slider-label-row">
                  <span className="slider-label">5 年后退出市盈率 (PE Exit)</span>
                  <span className="slider-value-badge">{exitPe.toFixed(1)}x</span>
                </div>
                <input
                  type="range"
                  min="8"
                  max="45"
                  step="0.5"
                  value={exitPe}
                  onChange={(e) => handleSliderChange("exitPe", parseFloat(e.target.value))}
                  className="val-range-input"
                />
                <div className="slider-scale-row">
                  <span>8x (极低)</span>
                  <span>{benchmarkPe ? `${benchmarkPe.toFixed(0)}x (中枢)` : "18x"}</span>
                  <span>30x (溢价)</span>
                  <span>45x</span>
                </div>
              </div>

              {/* Slider 3: Dividend & Repurchase Yield */}
              <div className="val-slider-item">
                <div className="slider-label-row">
                  <span className="slider-label">年度现金分红 + 回购注销收益率</span>
                  <span className="slider-value-badge">{shareholderYield.toFixed(1)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="8"
                  step="0.5"
                  value={shareholderYield}
                  onChange={(e) => handleSliderChange("yield", parseFloat(e.target.value))}
                  className="val-range-input"
                />
                <div className="slider-scale-row">
                  <span>0% (无分红)</span>
                  <span>2.5% (成熟均值)</span>
                  <span>5.0% (高股息)</span>
                  <span>8.0%</span>
                </div>
              </div>
            </div>

            {/* Right Column: Live Result Dashboard */}
            <div className="val-result-card">
              <div className="val-result-head">
                <span className="val-result-title">预期 5 年复合年化回报率 (IRR / CAGR)</span>
                <span className={`val-rating-pill ${tsrCalculations.ratingClass}`}>
                  {tsrCalculations.ratingTag}
                </span>
              </div>

              <div className="val-irr-display">
                <span className={`val-irr-number ${tsrCalculations.totalCagrPct >= 0 ? "val-irr--up" : "val-irr--dn"}`}>
                  {tsrCalculations.totalCagrPct >= 0 ? `+${tsrCalculations.totalCagrPct}%` : `${tsrCalculations.totalCagrPct}%`}
                </span>
                <span className="val-irr-unit">/ 年</span>
              </div>

              <div className="val-result-metrics">
                <div className="val-result-metric-row">
                  <span className="metric-label">当前基准股价:</span>
                  <span className="metric-val">{currencySymbol}{latestPrice.toFixed(2)}</span>
                </div>
                <div className="val-result-metric-row">
                  <span className="metric-label">当前基期 EPS:</span>
                  <span className="metric-val">{latestEps ? `${currencySymbol}${latestEps.toFixed(2)}` : "—"}</span>
                </div>
                <div className="val-result-metric-row">
                  <span className="metric-label">5年后预测 EPS:</span>
                  <span className="metric-val font-semibold">{currencySymbol}{tsrCalculations.targetEps}</span>
                </div>
                <div className="val-result-metric-row">
                  <span className="metric-label">5年后目标股价:</span>
                  <span className="metric-val font-semibold text-blue-600">{currencySymbol}{tsrCalculations.targetPrice}</span>
                </div>
                <div className="val-result-metric-row border-t border-slate-100 pt-2">
                  <span className="metric-label">累计股价空间:</span>
                  <span className={`metric-val ${tsrCalculations.priceChangePct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                    {tsrCalculations.priceChangePct >= 0 ? `+${tsrCalculations.priceChangePct}%` : `${tsrCalculations.priceChangePct}%`}
                  </span>
                </div>
              </div>

              <p className="val-formula-note">
                计算逻辑：P(5y) = EPS(基期) × (1 + g)^5 × PE(退出)；年化回报叠加年均 {shareholderYield}% 现金分红再投资。
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

