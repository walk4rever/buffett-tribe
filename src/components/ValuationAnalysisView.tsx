"use client";

import { useMemo, useState } from "react";
import type { ValueLineData } from "@/lib/value-line-data";
import { currencySymbol as getCurrencySymbol } from "@/lib/currency";
import { computeScenarios } from "@/lib/valuation-metrics";
import {
  computeAnnualEpsGrowthPct,
  computeHistoricalPeMetrics,
  computeHistoricalPbMetrics,
  type HistoricalPbPoint,
  type HistoricalPePoint,
} from "@/lib/valuation-analysis-metrics";
import {
  getDefaultFinancialModel,
  isPePrimaryValuationAnchor,
  resolveFinancialModel,
} from "@/lib/financial-model";

/**
 * Catmull-Rom to Cubic Bezier Spline for smooth financial curves
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

type ValuationAnalysisViewProps = {
  data: ValueLineData;
};

export function ValuationAnalysisView({ data }: ValuationAnalysisViewProps) {
  const financialModel =
    data.financialModel ??
    resolveFinancialModel(data.sectorModelType) ??
    getDefaultFinancialModel();
  const usesPeValuation = isPePrimaryValuationAnchor(
    financialModel.valuationAnchor,
  );
  const priceCurrencySymbol = data.tradingCurrency
    ? getCurrencySymbol(data.tradingCurrency)
    : "";

  // Active pricing & fundamentals
  const latestPrice =
    data.latestPrice ??
    (data.pricePoints.length
      ? data.pricePoints[data.pricePoints.length - 1].close
      : null);
  const latestAnnual = data.valuationAnnuals.length
    ? data.valuationAnnuals[data.valuationAnnuals.length - 1]
    : null;
  const latestEps = latestAnnual?.eps ?? null;
  const currentPe =
    data.peRatio ??
    (latestPrice != null && latestEps != null && latestEps > 0
      ? Number((latestPrice / latestEps).toFixed(1))
      : null);

  // 1. Compute Historical PE Percentile
  const historicalPeSeries = useMemo(
    () => data.historicalPePoints,
    [data.historicalPePoints],
  );
  const historicalPeMetrics = useMemo(() => {
    return computeHistoricalPeMetrics(historicalPeSeries, currentPe);
  }, [historicalPeSeries, currentPe]);
  const hasHistoricalBenchmark =
    historicalPeMetrics.sampleCount >= 2 &&
    historicalPeMetrics.peMedian != null;
  const benchmarkPe = usesPeValuation ? data.benchmarkPe : null;

  // 1b. Compute Historical PB Percentile
  const historicalPbSeries = useMemo(
    () => data.historicalPbPoints ?? [],
    [data.historicalPbPoints],
  );
  const currentPb = data.pbRatio;
  const historicalPbMetrics = useMemo(() => {
    return computeHistoricalPbMetrics(historicalPbSeries, currentPb);
  }, [historicalPbSeries, currentPb]);
  const hasHistoricalPbBenchmark =
    historicalPbMetrics.sampleCount >= 2 &&
    historicalPbMetrics.pbMedian != null;
  const benchmarkPb = data.benchmarkPb ?? historicalPbMetrics.pbMedian ?? currentPb;

  const hasIndustrialCashFlow = financialModel.showIndustrialCashFlow;
  const modelAvailabilityNote =
    financialModel.template === "bank"
      ? "银行业核心聚焦信贷资产质量、净息差走势与 ROE-PB 估值通道，不套用传统通用 P/E 通道。"
      : financialModel.template === "insurance"
        ? financialModel.subModel === "life_health"
          ? "人身险核心聚焦新业务价值（NBV）增长、内含价值（EV）变动与长期浮存金投资回报，不套用传统通用 P/E 通道。"
          : financialModel.subModel === "property_casualty"
            ? "财产险核心聚焦承保质量、综合成本率与短期赔付风控，不套用传统通用 P/E 通道。"
            : "保险业核心聚焦内含价值变动、承保质量与长期浮存金投资回报，不套用传统通用 P/E 通道。"
        : `${financialModel.valuationAnchorLabel}为核心考量基准，以专业资产定价与行业周期中枢为核心估值锚。`;
  // FCF Yield & Additional Multiples
  const fcfYield = useMemo(() => {
    if (
      latestAnnual?.freeCashFlow == null ||
      !data.marketCap ||
      data.marketCap <= 0
    )
      return null;
    const ratio = (latestAnnual.freeCashFlow / data.marketCap) * 100;
    return Number(ratio.toFixed(1));
  }, [latestAnnual, data.marketCap]);

  // Margin of safety status (Unified PE or PB)
  const valuationDiffPct = usesPeValuation
    ? currentPe != null && benchmarkPe != null && benchmarkPe > 0
      ? Number((((currentPe - benchmarkPe) / benchmarkPe) * 100).toFixed(1))
      : null
    : currentPb != null && benchmarkPb != null && benchmarkPb > 0
      ? Number((((currentPb - benchmarkPb) / benchmarkPb) * 100).toFixed(1))
      : null;

  const metricTypeLabel = usesPeValuation ? "P/E" : "P/B";
  const benchmarkMultipleLabel = usesPeValuation
    ? benchmarkPe != null ? `${benchmarkPe}x` : ""
    : benchmarkPb != null ? `${benchmarkPb}x` : "";

  let marginOfSafetyTag = "估值数据不足";
  let marginOfSafetyClass = "val-tag--neutral";
  let marginOfSafetyDesc = usesPeValuation
    ? "缺少可比的当前及历史 P/E 数据，暂不判断估值水平。"
    : "缺少可比的当前及历史 P/B 数据，暂不判断估值水平。";

  if (valuationDiffPct != null) {
    if (valuationDiffPct <= -20) {
      marginOfSafetyTag = `显著低于参考 ${metricTypeLabel} ${Math.abs(valuationDiffPct).toFixed(0)}%`;
      marginOfSafetyClass = "val-tag--deep-green";
      marginOfSafetyDesc = usesPeValuation
        ? "当前市盈率显著低于参考倍数；这不代表已确认安全边际。"
        : `当前市净率显著低于参考倍数 (${benchmarkMultipleLabel})；估值处于低位区间。`;
    } else if (valuationDiffPct <= -5) {
      marginOfSafetyTag = `低于参考 ${metricTypeLabel} ${Math.abs(valuationDiffPct).toFixed(0)}%`;
      marginOfSafetyClass = "val-tag--green";
      marginOfSafetyDesc = usesPeValuation
        ? "当前市盈率低于参考倍数；参考倍数不等于企业内在价值。"
        : `当前市净率低于参考倍数 (${benchmarkMultipleLabel})。`;
    } else if (valuationDiffPct <= 15) {
      marginOfSafetyTag = `接近参考 ${metricTypeLabel}`;
      marginOfSafetyClass = "val-tag--amber";
      marginOfSafetyDesc = usesPeValuation
        ? "当前市盈率接近参考倍数，实际回报仍取决于未来经营表现。"
        : `当前市净率接近参考倍数 (${benchmarkMultipleLabel})，处于合理估值区间。`;
    } else if (valuationDiffPct <= 30) {
      marginOfSafetyTag = `高于参考 ${metricTypeLabel} ${valuationDiffPct.toFixed(0)}%`;
      marginOfSafetyClass = "val-tag--orange";
      marginOfSafetyDesc = `当前 ${metricTypeLabel} 高于参考倍数 (${benchmarkMultipleLabel})。`;
    } else {
      marginOfSafetyTag = `显著高于参考 ${metricTypeLabel} ${valuationDiffPct.toFixed(0)}%`;
      marginOfSafetyClass = "val-tag--red";
      marginOfSafetyDesc = `当前 ${metricTypeLabel} 显著高于参考倍数 (${benchmarkMultipleLabel})，存在估值回落风险。`;
    }
  }

  // 2. PE-Band or PB-Band SVG Chart data
  const corridorBandData = useMemo(() => {
    const isPe = usesPeValuation;
    const series = isPe ? historicalPeSeries : historicalPbSeries;
    const baseMult = isPe ? benchmarkPe : benchmarkPb;

    if (baseMult == null || series.length < 2) return null;

    const width = 760;
    const height = 240;
    const padding = { top: 20, right: 30, bottom: 30, left: 45 };

    const mults = {
      p0_7: Number((baseMult * 0.7).toFixed(isPe ? 1 : 2)),
      p1_0: Number((baseMult * 1.0).toFixed(isPe ? 1 : 2)),
      p1_3: Number((baseMult * 1.3).toFixed(isPe ? 1 : 2)),
      p1_6: Number((baseMult * 1.6).toFixed(isPe ? 1 : 2)),
    };

    const bandPoints = series.map((p) => {
      const metricVal = isPe
        ? (p as HistoricalPePoint).eps
        : (p as HistoricalPbPoint).bps;
      return {
        date: p.date,
        price: p.close,
        metricVal,
        multiple:
          metricVal > 0
            ? Number((p.close / metricVal).toFixed(isPe ? 1 : 2))
            : null,
        b0_7: Number((metricVal * mults.p0_7).toFixed(2)),
        b1_0: Number((metricVal * mults.p1_0).toFixed(2)),
        b1_3: Number((metricVal * mults.p1_3).toFixed(2)),
        b1_6: Number((metricVal * mults.p1_6).toFixed(2)),
      };
    });

    let rawMin = Infinity;
    let rawMax = -Infinity;
    bandPoints.forEach((b) => {
      rawMin = Math.min(rawMin, b.price, b.b0_7);
      rawMax = Math.max(rawMax, b.price, b.b1_6);
    });

    if (
      !Number.isFinite(rawMin) ||
      !Number.isFinite(rawMax) ||
      rawMin >= rawMax
    ) {
      rawMin = 1;
      rawMax = 100;
    }

    const yMin = Math.max(0, rawMin * 0.9);
    const yMax = rawMax * 1.1;

    const plotW = width - padding.left - padding.right;
    const plotH = height - padding.top - padding.bottom;

    const getX = (idx: number) =>
      padding.left + (idx / (bandPoints.length - 1)) * plotW;
    const getY = (val: number) =>
      padding.top + plotH - ((val - yMin) / (yMax - yMin)) * plotH;

    const priceCoords = bandPoints.map((b, i) => ({
      x: getX(i),
      y: getY(b.price),
    }));
    const b0_7Coords = bandPoints.map((b, i) => ({
      x: getX(i),
      y: getY(b.b0_7),
    }));
    const b1_0Coords = bandPoints.map((b, i) => ({
      x: getX(i),
      y: getY(b.b1_0),
    }));
    const b1_3Coords = bandPoints.map((b, i) => ({
      x: getX(i),
      y: getY(b.b1_3),
    }));
    const b1_6Coords = bandPoints.map((b, i) => ({
      x: getX(i),
      y: getY(b.b1_6),
    }));

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
      { y: getY(yMin), label: `${priceCurrencySymbol}${yMin.toFixed(0)}` },
      {
        y: getY(yMin + (yMax - yMin) * 0.5),
        label: `${priceCurrencySymbol}${(yMin + (yMax - yMin) * 0.5).toFixed(0)}`,
      },
      { y: getY(yMax), label: `${priceCurrencySymbol}${yMax.toFixed(0)}` },
    ];

    const yearTicks: Array<{ x: number; label: string }> = [];
    const yearSelectionPoints = new Map<
      string,
      { label: string; index: number }
    >();
    bandPoints.forEach((b, idx) => {
      const yr = b.date.slice(0, 4);
      if (!yearSelectionPoints.has(yr)) {
        yearTicks.push({ x: getX(idx), label: yr });
      }
      yearSelectionPoints.set(yr, { label: yr, index: idx });
    });

    return {
      isPe,
      unitLabel: isPe ? "P/E" : "P/B",
      metricLabel: isPe ? "EPS" : "BPS",
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
      yearSelectionPoints: Array.from(yearSelectionPoints.values()),
      yMin,
      yMax,
    };
  }, [
    usesPeValuation,
    historicalPeSeries,
    historicalPbSeries,
    benchmarkPe,
    benchmarkPb,
    priceCurrencySymbol,
  ]);

  // Interactive Hover State for Corridor Band
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  // 3b. Interactive 5-Year PB-ROE TSR Simulator State
  const defaultSimRoe = data.roeAvg5Y ?? 10;
  const defaultSimExitPb = benchmarkPb ?? data.pbRatio ?? 1.0;
  const [pbScenario, setPbScenario] = useState<
    "conservative" | "base" | "optimistic" | "custom"
  >("base");
  const [simRoe, setSimRoe] = useState<number>(defaultSimRoe);
  const [simExitPb, setSimExitPb] = useState<number>(defaultSimExitPb);

  const handlePbPreset = (preset: "conservative" | "base" | "optimistic") => {
    setPbScenario(preset);
    if (preset === "conservative") {
      setSimRoe(Number(Math.max(2, defaultSimRoe * 0.75).toFixed(1)));
      setSimExitPb(Number(Math.max(0.3, defaultSimExitPb * 0.8).toFixed(2)));
    } else if (preset === "base") {
      setSimRoe(defaultSimRoe);
      setSimExitPb(defaultSimExitPb);
    } else {
      setSimRoe(Number((defaultSimRoe * 1.25).toFixed(1)));
      setSimExitPb(Number((defaultSimExitPb * 1.25).toFixed(2)));
    }
  };

  const pbTsrCalculations = useMemo(() => {
    if (!latestPrice || latestPrice <= 0) return null;
    const lastAnnual = data.valuationAnnuals.at(-1);
    const bpsFromAnnual =
      lastAnnual?.shareholdersEquity &&
      lastAnnual.shares &&
      lastAnnual.shares > 0
        ? lastAnnual.shareholdersEquity / lastAnnual.shares
        : null;
    const currentBps =
      bpsFromAnnual ??
      (currentPb && currentPb > 0 ? latestPrice / currentPb : null);
    if (!currentBps || currentBps <= 0) return null;

    const validAnnuals = data.valuationAnnuals.filter(
      (a) => a.netIncome != null && a.netIncome > 0 && a.dividendsPaid != null,
    );
    const totNi = validAnnuals.reduce((s, a) => s + a.netIncome!, 0);
    const totDiv = validAnnuals.reduce(
      (s, a) => s + Math.abs(a.dividendsPaid!),
      0,
    );
    const payoutRatio =
      totNi > 0 && totDiv > 0 ? Math.min(0.7, totDiv / totNi) : 0.3;

    const roeDecimal = simRoe / 100;
    const retainedRoe = roeDecimal * (1 - payoutRatio);
    const targetBps = currentBps * Math.pow(1 + retainedRoe, 5);
    const targetPrice = targetBps * simExitPb;
    const priceChangePct = ((targetPrice - latestPrice) / latestPrice) * 100;
    const annualizedPriceReturn =
      Math.pow(targetPrice / latestPrice, 1 / 5) - 1;

    const avgPb = (Math.max(0.2, currentPb ?? simExitPb) + simExitPb) / 2;
    const annualizedDivYield =
      avgPb > 0 ? (roeDecimal * payoutRatio) / avgPb : 0;
    const impliedAnnualReturnPct = Number(
      ((annualizedPriceReturn + annualizedDivYield) * 100).toFixed(1),
    );
    const priceReturnPct = Number((annualizedPriceReturn * 100).toFixed(1));
    const divYieldPct = Number((annualizedDivYield * 100).toFixed(1));

    let ratingTag = "合理收益";
    let ratingClass = "tsr-pill--amber";
    if (impliedAnnualReturnPct >= 15) {
      ratingTag = "预期综合年化 ≥ 15%";
      ratingClass = "tsr-pill--green";
    } else if (impliedAnnualReturnPct >= 8) {
      ratingTag = "预期综合年化 8%~15%";
      ratingClass = "tsr-pill--light-green";
    } else if (impliedAnnualReturnPct < 0) {
      ratingTag = "预期年化为负";
      ratingClass = "tsr-pill--red";
    }

    return {
      currentBps,
      targetBps: Number(targetBps.toFixed(2)),
      targetPrice: Number(targetPrice.toFixed(2)),
      priceChangePct: Number(priceChangePct.toFixed(1)),
      impliedAnnualReturnPct,
      priceReturnPct,
      divYieldPct,
      ratingTag,
      ratingClass,
      payoutRatioPct: Number((payoutRatio * 100).toFixed(0)),
    };
  }, [latestPrice, currentPb, data.valuationAnnuals, simRoe, simExitPb]);

  // 3. Interactive 5-Year TSR Simulator State
  const defaultGrowth = useMemo(
    () => computeAnnualEpsGrowthPct(data.valuationAnnuals),
    [data.valuationAnnuals],
  );
  const growthMin = Math.min(-90, Math.floor((defaultGrowth ?? 0) / 10) * 10);
  const growthMax = Math.max(100, Math.ceil((defaultGrowth ?? 0) / 10) * 10);

  const [activeScenario, setActiveScenario] = useState<
    "conservative" | "base" | "optimistic" | "custom"
  >("base");
  const [growthRate, setGrowthRate] = useState<number>(defaultGrowth ?? 0);
  const [exitPe, setExitPe] = useState<number>(
    Number((benchmarkPe ?? 0).toFixed(1)),
  );

  const handleScenarioPreset = (
    preset: "conservative" | "base" | "optimistic",
  ) => {
    if (defaultGrowth == null || benchmarkPe == null) return;
    setActiveScenario(preset);
    if (preset === "conservative") {
      const conservativeGrowth = Math.max(
        growthMin,
        Math.min(defaultGrowth * 0.4, defaultGrowth - 5),
      );
      setGrowthRate(Number(conservativeGrowth.toFixed(1)));
      setExitPe(Number((benchmarkPe * 0.8).toFixed(1)));
    } else if (preset === "base") {
      setGrowthRate(defaultGrowth);
      setExitPe(Number(benchmarkPe.toFixed(1)));
    } else {
      const optimisticGrowth = Math.min(
        growthMax,
        Math.max(defaultGrowth * 1.5, defaultGrowth + 5),
      );
      setGrowthRate(Number(optimisticGrowth.toFixed(1)));
      setExitPe(Number((benchmarkPe * 1.3).toFixed(1)));
    }
  };

  const handleSliderChange = (type: "growth" | "exitPe", val: number) => {
    setActiveScenario("custom");
    if (type === "growth") setGrowthRate(val);
    if (type === "exitPe") setExitPe(val);
  };

  // Annualized price return excludes dividends and other shareholder distributions.
  const tsrCalculations = useMemo(() => {
    const [scenario] = computeScenarios({
      latestEps,
      latestPrice,
      horizonYears: 5,
      scenarios: [
        { name: "情景", growthPct: growthRate, exitPe, rationale: "" },
      ],
    });
    if (
      scenario.impliedPrice == null ||
      scenario.impliedAnnualReturnPct == null
    )
      return null;
    const targetEps = latestEps! * (1 + growthRate / 100) ** 5;
    const targetPrice = scenario.impliedPrice;
    const priceChangePct = ((targetPrice - latestPrice!) / latestPrice!) * 100;
    const annualizedPriceReturnPct = scenario.impliedAnnualReturnPct;

    let ratingTag = "合理收益";
    let ratingClass = "tsr-pill--amber";
    if (annualizedPriceReturnPct >= 15) {
      ratingTag = "年化价格回报 ≥ 15%";
      ratingClass = "tsr-pill--green";
    } else if (annualizedPriceReturnPct >= 8) {
      ratingTag = "年化价格回报 8%~15%";
      ratingClass = "tsr-pill--light-green";
    } else if (annualizedPriceReturnPct >= 0) {
      ratingTag = "年化价格回报 0%~8%";
      ratingClass = "tsr-pill--slate";
    } else {
      ratingTag = "年化价格回报为负";
      ratingClass = "tsr-pill--red";
    }

    return {
      targetEps: Number(targetEps.toFixed(2)),
      targetPrice: Number(targetPrice.toFixed(2)),
      priceChangePct: Number(priceChangePct.toFixed(1)),
      annualizedPriceReturnPct,
      ratingTag,
      ratingClass,
    };
  }, [latestEps, latestPrice, growthRate, exitPe]);

  const activePointIndex = corridorBandData
    ? (hoverIdx ?? corridorBandData.bandPoints.length - 1)
    : null;
  const activePoint =
    corridorBandData && activePointIndex != null
      ? corridorBandData.bandPoints[activePointIndex]
      : null;

  return (
    <div className="val-deep-dive">
      {/* Valuation summary */}
      <div className="val-section-head">
        <div>
          <div className="val-title-row">
            <h3 className="val-title">估值分析</h3>
          </div>
          <p className="val-subtitle">
            {!data.valuationCurrencyAvailable
              ? "报告币种或汇率数据不足，跨币种估值暂不可用"
              : `财报 ${data.reportingCurrency} / 估值 ${data.tradingCurrency}${
                  data.reportingCurrency !== data.tradingCurrency
                    ? "，历史按最新汇率折算"
                    : ""
                }`}
          </p>
        </div>
        <span className="company-gen-meta">
          实时精算 · 数据基准 {data.latestPriceDate || "最新收盘"}
        </span>
      </div>

      <div className="val-valuation-summary">
        {usesPeValuation ? (
          <>
            <div className="val-valuation-main">
              <div className="val-valuation-metric">
                <span className="val-card-label">当前 P/E</span>
                <strong className="val-valuation-value">
                  {currentPe != null ? `${currentPe}x` : "—"}
                </strong>
              </div>
              <div className="val-valuation-metric val-valuation-metric--reference">
                <span className="val-card-label">
                  {hasHistoricalBenchmark ? "历史 P/E 中位数" : "系统参考 P/E"}
                </span>
                <strong className="val-valuation-reference">
                  {benchmarkPe != null ? `${benchmarkPe}x` : "—"}
                </strong>
              </div>
              <span className={`val-status-badge ${marginOfSafetyClass}`}>
                {marginOfSafetyTag}
              </span>
            </div>

            <p className="val-valuation-summary-note">
              {marginOfSafetyDesc}
              {historicalPeMetrics.currentPercentile != null
                ? ` · 历史 ${historicalPeMetrics.currentPercentile}% 分位`
                : hasHistoricalBenchmark
                  ? ` · ${historicalPeMetrics.sampleCount} 个历史样本`
                  : " · 历史样本不足，采用系统参考值"}
              {historicalPeMetrics.peMin != null &&
              historicalPeMetrics.peMax != null
                ? ` · 历史区间 ${historicalPeMetrics.peMin}x–${historicalPeMetrics.peMax}x`
                : ""}
            </p>
          </>
        ) : (
          <>
            <div className="val-valuation-main">
              <div className="val-valuation-metric">
                <span className="val-card-label">主要估值锚</span>
                <strong className="val-valuation-value">
                  {financialModel.valuationAnchorLabel}
                </strong>
              </div>
              <div className="val-valuation-metric val-valuation-metric--reference">
                <span className="val-card-label">
                  {hasHistoricalPbBenchmark ? "历史 P/B 中位数" : "参考 P/B"}
                </span>
                <strong className="val-valuation-reference">
                  {benchmarkPb != null ? `${benchmarkPb}x` : "—"}
                </strong>
              </div>
              <span className={`val-status-badge ${marginOfSafetyClass}`}>
                {marginOfSafetyTag}
              </span>
              <span className="val-status-badge val-tag--neutral">
                行业特定估值通道
              </span>
            </div>
            <p className="val-valuation-summary-note">
              {marginOfSafetyDesc}
              {historicalPbMetrics.currentPercentile != null
                ? ` · 历史 ${historicalPbMetrics.currentPercentile}% 分位`
                : hasHistoricalPbBenchmark
                  ? ` · ${historicalPbMetrics.sampleCount} 个历史样本`
                  : ""}
              {historicalPbMetrics.pbMin != null &&
              historicalPbMetrics.pbMax != null
                ? ` · 历史区间 ${historicalPbMetrics.pbMin}x–${historicalPbMetrics.pbMax}x`
                : ""}
              {` · ${modelAvailabilityNote}`}
            </p>
          </>
        )}
      </div>
      <div className="val-multiples-grid val-valuation-metrics-grid">
        <div className="val-multiple-card">
          <span className="val-card-label">市净率 P/B (净资产倍数)</span>
          <div className="val-card-val-row">
            <span className="val-card-val">
              {data.pbRatio ? `${data.pbRatio}x` : "—"}
            </span>
          </div>
          <span className="val-card-hint">市值 / 最新披露净资产</span>
        </div>

        {hasIndustrialCashFlow ? (
          <div className="val-multiple-card">
            <span className="val-card-label">自由现金流收益率 (FCF Yield)</span>
            <div className="val-card-val-row">
              <span className="val-card-val">
                {fcfYield != null ? `${fcfYield}%` : "—"}
              </span>
            </div>
            <span className="val-card-hint">
              最新年报 FCF / 当前市值
              {data.reportingCurrency ? ` · ${data.tradingCurrency}` : ""}
            </span>
          </div>
        ) : null}

        <div className="val-multiple-card">
          <span className="val-card-label">5年平均 ROE (净资产收益率)</span>
          <div className="val-card-val-row">
            <span className="val-card-val">
              {data.roeAvg5Y != null ? `${data.roeAvg5Y.toFixed(1)}%` : "—"}
            </span>
            {data.roeStability ? (
              <span className="val-card-subtag">
                {data.roeStability === "stellar"
                  ? "极其稳固"
                  : data.roeStability === "solid"
                    ? "稳健优质"
                    : "具备周期性"}
              </span>
            ) : null}
          </div>
          <span className="val-card-hint">近 5 年披露 ROE 均值</span>
        </div>

        {hasIndustrialCashFlow ? (
          <div className="val-multiple-card">
            <span className="val-card-label">现金流转化率 (OCF / 净利润)</span>
            <div className="val-card-val-row">
              <span className="val-card-val">
                {data.cashConversionRatio != null
                  ? `${data.cashConversionRatio.toFixed(2)}x`
                  : "—"}
              </span>
              {data.cashConversionRatio != null ? (
                <span
                  className={`val-card-subtag ${data.cashConversionRatio >= 1.0 ? "val-tag--sub-green" : "val-tag--sub-orange"}`}
                >
                  {data.cashConversionRatio >= 1.0
                    ? "盈利含金量高"
                    : "部分应收/资本占用"}
                </span>
              ) : null}
            </div>
            <span className="val-card-hint">近年经营现金流 / 净利润</span>
          </div>
        ) : null}
      </div>

      {/* ── 2. Corridor SVG Chart (PE or PB) ── */}
      {corridorBandData ? (
        <div className="val-chart-block">
          <div className="val-chart-header">
            <div>
              <h4 className="val-block-title">
                {corridorBandData.isPe ? "历史 P/E 参考带" : "历史 P/B 估值走廊带"}
              </h4>
              <span className="val-block-desc">
                {data.reportingCurrency &&
                data.reportingCurrency !== data.tradingCurrency
                  ? "按最新汇率折算；"
                  : ""}
                按披露日可得 {corridorBandData.metricLabel} 与
                {corridorBandData.isPe
                  ? (hasHistoricalBenchmark ? "历史中位数" : "系统参考值")
                  : (hasHistoricalPbBenchmark ? "历史中位数" : "参考倍数")}
                计算；不代表未来目标价。
              </span>
            </div>

            {/* Current Point Legend */}
            <div className="val-band-legend">
              <span className="legend-item">
                <span className="legend-dot dot-b0_7" />
                参考值 0.7x ({corridorBandData.mults.p0_7}x)
              </span>
              <span className="legend-item">
                <span className="legend-dot dot-b1_0" />
                参考值 1.0x ({corridorBandData.mults.p1_0}x)
              </span>
              <span className="legend-item">
                <span className="legend-dot dot-b1_3" />
                参考值 1.3x ({corridorBandData.mults.p1_3}x)
              </span>
              <span className="legend-item">
                <span className="legend-dot dot-b1_6" />
                参考值 1.6x ({corridorBandData.mults.p1_6}x)
              </span>
              <span className="legend-item legend-item--active">
                <span className="legend-dot dot-price" />
                实际收盘价
              </span>
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
              <span className="val-hud-value val-hud-value--blue">
                {priceCurrencySymbol}
                {activePoint?.price.toFixed(2)}
              </span>
            </div>
            <div className="val-hud-col">
              <span className="val-hud-label">
                对应年度 {corridorBandData.metricLabel} {corridorBandData.unitLabel}:
              </span>
              <span className="val-hud-value">
                {activePoint?.multiple ? `${activePoint.multiple}x` : "—"}
              </span>
            </div>
            <div className="val-hud-col">
              <span className="val-hud-label">参考 {corridorBandData.unitLabel} 股价:</span>
              <span className="val-hud-value val-hud-value--amber">
                {priceCurrencySymbol}
                {activePoint?.b1_0.toFixed(2)}
              </span>
            </div>
            <div className="val-hud-col">
              <span className="val-hud-label">通道状态:</span>
              <span className="val-hud-tag">
                {activePoint && activePoint.multiple
                  ? activePoint.multiple < corridorBandData.mults.p0_7
                    ? "低于参考区间"
                    : activePoint.multiple < corridorBandData.mults.p1_0
                      ? `低于参考 ${corridorBandData.unitLabel}`
                      : activePoint.multiple < corridorBandData.mults.p1_3
                        ? `高于参考 ${corridorBandData.unitLabel}`
                        : "高于参考区间"
                  : "数据不足"}
              </span>
            </div>
          </div>

          <div
            className="val-mobile-period-picker"
            role="group"
            aria-label="选择估值图表年份"
          >
            {corridorBandData.yearSelectionPoints.map(({ label, index }) => (
              <button
                key={label}
                type="button"
                aria-label={`查看 FY${label} 数据`}
                aria-pressed={activePointIndex === index}
                className={activePointIndex === index ? "is-active" : ""}
                onClick={() => setHoverIdx(index)}
              >
                FY{label}
              </button>
            ))}
          </div>

          <div className="val-svg-wrap">
            <svg
              viewBox={`0 0 ${corridorBandData.width} ${corridorBandData.height}`}
              className="val-pe-svg"
              onMouseLeave={() => setHoverIdx(null)}
            >
              <defs>
                <linearGradient
                  id="val-corridor-grad"
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor="#ef4444" stopOpacity="0.06" />
                  <stop offset="50%" stopColor="#f59e0b" stopOpacity="0.04" />
                  <stop offset="100%" stopColor="#10b981" stopOpacity="0.06" />
                </linearGradient>
              </defs>

              {/* Y Axis Grid Lines */}
              {corridorBandData.yTicks.map((tick) => (
                <g key={tick.label}>
                  <line
                    x1={corridorBandData.padding.left}
                    y1={tick.y}
                    x2={corridorBandData.width - corridorBandData.padding.right}
                    y2={tick.y}
                    stroke="rgba(148, 163, 184, 0.2)"
                    strokeDasharray="3 3"
                  />
                  <text
                    x={corridorBandData.padding.left - 6}
                    y={tick.y + 3}
                    textAnchor="end"
                    className="val-axis-text"
                  >
                    {tick.label}
                  </text>
                </g>
              ))}

              {/* Channel Shaded Area */}
              {corridorBandData.corridorFillD ? (
                <path
                  d={corridorBandData.corridorFillD}
                  fill="url(#val-corridor-grad)"
                />
              ) : null}

              {/* Band Lines */}
              <path
                d={corridorBandData.b1_6PathD}
                fill="none"
                stroke="#ef4444"
                strokeWidth="1"
                strokeDasharray="3 3"
                opacity="0.65"
              />
              <path
                d={corridorBandData.b1_3PathD}
                fill="none"
                stroke="#3b82f6"
                strokeWidth="1"
                strokeDasharray="3 3"
                opacity="0.65"
              />
              <path
                d={corridorBandData.b1_0PathD}
                fill="none"
                stroke="#f59e0b"
                strokeWidth="1.2"
                strokeDasharray="4 2"
                opacity="0.9"
              />
              <path
                d={corridorBandData.b0_7PathD}
                fill="none"
                stroke="#10b981"
                strokeWidth="1"
                strokeDasharray="3 3"
                opacity="0.75"
              />

              {/* Real Price Curve */}
              <path
                d={corridorBandData.pricePathD}
                fill="none"
                stroke="#0071e3"
                strokeWidth="2.2"
                strokeLinecap="round"
              />

              {/* X Axis Year Marks */}
              {corridorBandData.yearTicks.map((yr) => (
                <text
                  key={yr.label}
                  x={yr.x}
                  y={corridorBandData.height - 8}
                  textAnchor="middle"
                  className="val-axis-text"
                >
                  {yr.label}
                </text>
              ))}

              {/* Hover Crosshair & Pointer */}
              {hoverIdx != null && corridorBandData.priceCoords[hoverIdx] ? (
                <g>
                  <line
                    x1={corridorBandData.priceCoords[hoverIdx].x}
                    y1={corridorBandData.padding.top}
                    x2={corridorBandData.priceCoords[hoverIdx].x}
                    y2={corridorBandData.height - corridorBandData.padding.bottom}
                    stroke="#0071e3"
                    strokeWidth="1"
                    strokeDasharray="2 2"
                  />
                  <circle
                    cx={corridorBandData.priceCoords[hoverIdx].x}
                    cy={corridorBandData.priceCoords[hoverIdx].y}
                    r="4"
                    fill="#0071e3"
                    stroke="#ffffff"
                    strokeWidth="2"
                  />
                </g>
              ) : null}

              {/* Invisible Hover Rects for Interaction */}
              {corridorBandData.priceCoords.map((coord, idx) => {
                const w = corridorBandData.width / corridorBandData.priceCoords.length;
                return (
                  <rect
                    key={idx}
                    x={coord.x - w / 2}
                    y={corridorBandData.padding.top}
                    width={w}
                    height={
                      corridorBandData.height -
                      corridorBandData.padding.top -
                      corridorBandData.padding.bottom
                    }
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
      {tsrCalculations &&
      latestPrice != null &&
      latestEps != null &&
      defaultGrowth != null &&
      benchmarkPe != null ? (
        <details className="val-sim-block">
          <summary className="val-sim-summary">
            <div>
              <h4 className="val-block-title">5年情景测算</h4>
              <p className="val-block-desc">
                按 EPS 增长与退出 P/E 假设测算，不含分红
              </p>
            </div>
            <span className="val-sim-chevron" aria-hidden="true" />
          </summary>

          <div className="val-sim-content">
            {/* Scenario Preset Buttons */}
            <div
              className="val-preset-group"
              role="group"
              aria-label="情景假设"
            >
              <button
                type="button"
                className={`preset-btn ${activeScenario === "conservative" ? "preset-btn--active" : ""}`}
                onClick={() => handleScenarioPreset("conservative")}
              >
                偏低估值
              </button>
              <button
                type="button"
                className={`preset-btn ${activeScenario === "base" ? "preset-btn--active" : ""}`}
                onClick={() => handleScenarioPreset("base")}
              >
                参考估值
              </button>
              <button
                type="button"
                className={`preset-btn ${activeScenario === "optimistic" ? "preset-btn--active" : ""}`}
                onClick={() => handleScenarioPreset("optimistic")}
              >
                偏高估值
              </button>
            </div>

            <div className="val-sim-grid">
              {/* Left Column: Sliders */}
              <div className="val-sliders-pane">
                {/* Slider 1: EPS Growth */}
                <div className="val-slider-item">
                  <div className="slider-label-row">
                    <span className="slider-label">
                      未来 5 年 EPS 年化复合增速 (g)
                    </span>
                    <span className="slider-value-badge">
                      {growthRate > 0 ? `+${growthRate}%` : `${growthRate}%`}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={growthMin}
                    max={growthMax}
                    step="0.5"
                    value={growthRate}
                    onChange={(e) =>
                      handleSliderChange("growth", parseFloat(e.target.value))
                    }
                    className="val-range-input"
                  />
                  <div className="slider-scale-row">
                    <span>{growthMin}%</span>
                    <span>0%</span>
                    <span>{Math.round(growthMax / 2)}%</span>
                    <span>{growthMax}%</span>
                  </div>
                </div>

                {/* Slider 2: Exit PE */}
                <div className="val-slider-item">
                  <div className="slider-label-row">
                    <span className="slider-label">
                      5 年后退出市盈率 (PE Exit)
                    </span>
                    <span className="slider-value-badge">
                      {exitPe.toFixed(1)}x
                    </span>
                  </div>
                  <input
                    type="range"
                    min="4"
                    max="60"
                    step="0.5"
                    value={exitPe}
                    onChange={(e) =>
                      handleSliderChange("exitPe", parseFloat(e.target.value))
                    }
                    className="val-range-input"
                  />
                  <div className="slider-scale-row">
                    <span>4x</span>
                    <span>{benchmarkPe.toFixed(1)}x (参考)</span>
                    <span>30x</span>
                    <span>60x</span>
                  </div>
                </div>
              </div>

              {/* Right Column: Live Result Dashboard */}
              <div className="val-result-card">
                <div className="val-result-head">
                  <span className="val-result-title">
                    情景年化价格回报（不含分红）
                  </span>
                  <span
                    className={`val-rating-pill ${tsrCalculations.ratingClass}`}
                  >
                    {tsrCalculations.ratingTag}
                  </span>
                </div>

                <div className="val-irr-display">
                  <span
                    className={`val-irr-number ${tsrCalculations.annualizedPriceReturnPct >= 0 ? "val-irr--up" : "val-irr--dn"}`}
                  >
                    {tsrCalculations.annualizedPriceReturnPct >= 0
                      ? `+${tsrCalculations.annualizedPriceReturnPct}%`
                      : `${tsrCalculations.annualizedPriceReturnPct}%`}
                  </span>
                  <span className="val-irr-unit">/ 年</span>
                </div>

                <div className="val-result-metrics">
                  <div className="val-result-metric-row">
                    <span className="metric-label">当前基准股价:</span>
                    <span className="metric-val">
                      {priceCurrencySymbol}
                      {latestPrice.toFixed(2)}
                    </span>
                  </div>
                  <div className="val-result-metric-row">
                    <span className="metric-label">当前基期 EPS:</span>
                    <span className="metric-val">
                      {latestEps
                        ? `${priceCurrencySymbol}${latestEps.toFixed(2)}`
                        : "—"}
                    </span>
                  </div>
                  <div className="val-result-metric-row">
                    <span className="metric-label">5年后情景 EPS:</span>
                    <span className="metric-val font-semibold">
                      {priceCurrencySymbol}
                      {tsrCalculations.targetEps}
                    </span>
                  </div>
                  <div className="val-result-metric-row">
                    <span className="metric-label">5年后情景股价:</span>
                    <span className="metric-val font-semibold text-blue-600">
                      {priceCurrencySymbol}
                      {tsrCalculations.targetPrice}
                    </span>
                  </div>
                  <div className="val-result-metric-row border-t border-slate-100 pt-2">
                    <span className="metric-label">累计股价空间:</span>
                    <span
                      className={`metric-val ${tsrCalculations.priceChangePct >= 0 ? "text-emerald-600" : "text-rose-600"}`}
                    >
                      {tsrCalculations.priceChangePct >= 0
                        ? `+${tsrCalculations.priceChangePct}%`
                        : `${tsrCalculations.priceChangePct}%`}
                    </span>
                  </div>
                </div>

                <p className="val-formula-note">
                  P(5y) = 基期 EPS × (1 + g)^5 × 退出 P/E；年化价格回报 =
                  (目标价 / 当前价)^(1/5) − 1。
                </p>
              </div>
            </div>
          </div>
        </details>
      ) : !usesPeValuation &&
        pbTsrCalculations &&
        latestPrice != null &&
        benchmarkPb != null ? (
        <details className="val-sim-block">
          <summary className="val-sim-summary">
            <div>
              <h4 className="val-block-title">5年回报推演 (PB-ROE 框架)</h4>
              <p className="val-block-desc">
                基于未来 ROE 净资产累积与 5 年后退出 P/B 假设测算（含股息回报）
              </p>
            </div>
            <span className="val-sim-chevron" aria-hidden="true" />
          </summary>

          <div className="val-sim-content">
            {/* Scenario Preset Buttons */}
            <div
              className="val-preset-group"
              role="group"
              aria-label="情景假设"
            >
              <button
                type="button"
                className={`preset-btn ${pbScenario === "conservative" ? "preset-btn--active" : ""}`}
                onClick={() => handlePbPreset("conservative")}
              >
                偏低估值
              </button>
              <button
                type="button"
                className={`preset-btn ${pbScenario === "base" ? "preset-btn--active" : ""}`}
                onClick={() => handlePbPreset("base")}
              >
                参考估值
              </button>
              <button
                type="button"
                className={`preset-btn ${pbScenario === "optimistic" ? "preset-btn--active" : ""}`}
                onClick={() => handlePbPreset("optimistic")}
              >
                偏高估值
              </button>
            </div>

            <div className="val-sim-grid">
              {/* Left Column: Sliders */}
              <div className="val-sliders-pane">
                {/* Slider 1: Expected Avg ROE */}
                <div className="val-slider-item">
                  <div className="slider-label-row">
                    <span className="slider-label">
                      未来 5 年平均 ROE (净资产收益率)
                    </span>
                    <span className="slider-value-badge">
                      {simRoe}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="35"
                    step="0.5"
                    value={simRoe}
                    onChange={(e) => {
                      setPbScenario("custom");
                      setSimRoe(parseFloat(e.target.value));
                    }}
                    className="val-range-input"
                  />
                  <div className="slider-scale-row">
                    <span>1%</span>
                    <span>近5年均值: {data.roeAvg5Y != null ? `${data.roeAvg5Y}%` : "—"}</span>
                    <span>35%</span>
                  </div>
                </div>

                {/* Slider 2: Exit PB */}
                <div className="val-slider-item">
                  <div className="slider-label-row">
                    <span className="slider-label">
                      5 年后退出市净率 (PB Exit)
                    </span>
                    <span className="slider-value-badge">
                      {simExitPb.toFixed(2)}x
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.2"
                    max={Math.max(3.0, Number((benchmarkPb * 1.8).toFixed(1)))}
                    step="0.05"
                    value={simExitPb}
                    onChange={(e) => {
                      setPbScenario("custom");
                      setSimExitPb(parseFloat(e.target.value));
                    }}
                    className="val-range-input"
                  />
                  <div className="slider-scale-row">
                    <span>0.2x</span>
                    <span>参考中枢: {benchmarkPb.toFixed(2)}x</span>
                    <span>{Math.max(3.0, Number((benchmarkPb * 1.8).toFixed(1)))}x</span>
                  </div>
                </div>
              </div>

              {/* Right Column: Live Result Dashboard */}
              <div className="val-result-card">
                <div className="val-result-head">
                  <span className="val-result-title">
                    预期年化综合回报 (TSR，含股息)
                  </span>
                  <span
                    className={`val-rating-pill ${pbTsrCalculations.ratingClass}`}
                  >
                    {pbTsrCalculations.ratingTag}
                  </span>
                </div>

                <div className="val-irr-display">
                  <span
                    className={`val-irr-number ${pbTsrCalculations.impliedAnnualReturnPct >= 0 ? "val-irr--up" : "val-irr--dn"}`}
                  >
                    {pbTsrCalculations.impliedAnnualReturnPct >= 0
                      ? `+${pbTsrCalculations.impliedAnnualReturnPct}%`
                      : `${pbTsrCalculations.impliedAnnualReturnPct}%`}
                  </span>
                  <span className="val-irr-unit">/ 年</span>
                </div>

                <div className="val-result-metrics">
                  <div className="val-result-metric-row">
                    <span className="metric-label">当前基准股价:</span>
                    <span className="metric-val">
                      {priceCurrencySymbol}
                      {latestPrice.toFixed(2)}
                    </span>
                  </div>
                  <div className="val-result-metric-row">
                    <span className="metric-label">当前每股净资产 (BPS):</span>
                    <span className="metric-val">
                      {priceCurrencySymbol}
                      {pbTsrCalculations.currentBps.toFixed(2)}
                    </span>
                  </div>
                  <div className="val-result-metric-row">
                    <span className="metric-label">5年后情景 BPS:</span>
                    <span className="metric-val font-semibold">
                      {priceCurrencySymbol}
                      {pbTsrCalculations.targetBps.toFixed(2)}
                    </span>
                  </div>
                  <div className="val-result-metric-row">
                    <span className="metric-label">5年后情景股价:</span>
                    <span className="metric-val font-semibold text-blue-600">
                      {priceCurrencySymbol}
                      {pbTsrCalculations.targetPrice.toFixed(2)}
                    </span>
                  </div>
                  <div className="val-result-metric-row border-t border-slate-100 pt-2">
                    <span className="metric-label">年化利得 + 股息回报:</span>
                    <span
                      className={`metric-val ${pbTsrCalculations.impliedAnnualReturnPct >= 0 ? "text-emerald-600" : "text-rose-600"}`}
                    >
                      资本利得 {pbTsrCalculations.priceReturnPct >= 0 ? `+${pbTsrCalculations.priceReturnPct}%` : `${pbTsrCalculations.priceReturnPct}%`} + 股息 ~{pbTsrCalculations.divYieldPct}%
                    </span>
                  </div>
                </div>

                <p className="val-formula-note">
                  BPS(5y) = 当前 BPS × (1 + ROE × (1 − 分红率 {pbTsrCalculations.payoutRatioPct}%))^5；P(5y) = BPS(5y) × 退出 P/B；综合回报含留存净资产复合增长与分红现金流。
                </p>
              </div>
            </div>
          </div>
        </details>
      ) : null}
    </div>
  );
}
