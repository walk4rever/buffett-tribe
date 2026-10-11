"use client";

import { useMemo, useState } from "react";
import type { ValueLineData } from "@/lib/value-line-data";
import { formatUsdInYi } from "@/lib/currency";

type CapitalAllocationViewProps = {
  data: ValueLineData;
};

function getCurrencySymbol(market: "us" | "hk" | "cn"): string {
  switch (market) {
    case "cn":
      return "¥";
    case "hk":
      return "HK$";
    case "us":
    default:
      return "$";
  }
}

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
  const currencySym = getCurrencySymbol(data.market);
  const [hoverYearIdx, setHoverYearIdx] = useState<number | null>(null);

  // 1. Multi-Year Financials & Capital Allocation Statistics (Unified to Trailing 5 Years)
  const stats = useMemo(() => {
    const allAnnuals = (data.annuals || [])
      .filter((a) => a.operatingCashFlow != null || a.netIncome != null)
      .slice()
      .sort((a, b) => a.year - b.year);

    if (allAnnuals.length < 2) {
      return null;
    }

    // 统一口径：锁定最近 5 个已披露完整财年（若不足 5 年则按实际连续财年计算）
    const annuals = allAnnuals.slice(-5);
    const earliest = annuals[0];
    const latest = annuals[annuals.length - 1];
    const spanYears = annuals.length;

    let cumOcf = 0;
    let cumCapEx = 0;
    let cumFcf = 0;
    let cumBuybacks = 0;
    let cumNetIncome = 0;

    annuals.forEach((a) => {
      if (a.operatingCashFlow != null) cumOcf += a.operatingCashFlow;
      const c = a.capEx != null ? Math.abs(a.capEx) : 0;
      cumCapEx += c;
      if (a.freeCashFlow != null) {
        cumFcf += a.freeCashFlow;
      } else if (a.operatingCashFlow != null) {
        cumFcf += a.operatingCashFlow - c;
      }
      if (a.repurchaseAmt != null && a.repurchaseAmt > 0) {
        cumBuybacks += a.repurchaseAmt;
      }
      if (a.netIncome != null) {
        cumNetIncome += a.netIncome;
      }
    });

    // Share count change (Diluted shares)
    const annualsWithShares = annuals.filter((a) => a.shares != null && a.shares > 0);
    let shareDeltaPct: number | null = null;
    let sharesStart: number | null = null;
    let sharesEnd: number | null = null;

    if (annualsWithShares.length >= 2) {
      sharesStart = annualsWithShares[0].shares!;
      sharesEnd = annualsWithShares[annualsWithShares.length - 1].shares!;
      shareDeltaPct = Number((((sharesEnd - sharesStart) / sharesStart) * 100).toFixed(1));
    }

    // Book equity change
    const equityStart = earliest.shareholdersEquity;
    const equityEnd = latest.shareholdersEquity;
    const equityDelta = equityStart != null && equityEnd != null ? equityEnd - equityStart : null;

    // Market cap change estimation
    const latestMarketCap = data.marketCap;
    let earliestMarketCap: number | null = null;

    if (data.pricePoints.length && sharesStart != null) {
      const startYearStr = String(earliest.year);
      const matchedPoint =
        data.pricePoints.find((p) => p.date.startsWith(startYearStr)) || data.pricePoints[0];
      if (matchedPoint && matchedPoint.close > 0) {
        earliestMarketCap = matchedPoint.close * sharesStart;
      }
    }

    const marketCapDelta =
      latestMarketCap != null && earliestMarketCap != null
        ? latestMarketCap - earliestMarketCap
        : null;

    // Buffett's $1 Rule Test Multiple
    let dollarTestMultiple: number | null = null;
    let dollarTestMethod: "equity" | "net_income" = "equity";

    if (marketCapDelta != null) {
      if (equityDelta != null && equityDelta > 0) {
        dollarTestMultiple = Number((marketCapDelta / equityDelta).toFixed(2));
        dollarTestMethod = "equity";
      } else if (cumNetIncome > 0) {
        // High buyback companies: market value created per dollar of total net income
        dollarTestMultiple = Number((marketCapDelta / cumNetIncome).toFixed(2));
        dollarTestMethod = "net_income";
      }
    }

    // Allocation percentages of OCF
    const safeOcf = Math.max(1, cumOcf);
    const capexPct = Number(((cumCapEx / safeOcf) * 100).toFixed(1));
    const buybackPct = Number(((cumBuybacks / safeOcf) * 100).toFixed(1));
    const fcfPct = Number(((cumFcf / safeOcf) * 100).toFixed(1));
    const retainedPct = Number(Math.max(0, 100 - capexPct - buybackPct).toFixed(1));

    // ROE stats
    const roes = annuals.map((a) => a.roe).filter((r): r is number => r != null && Number.isFinite(r));
    const avgRoe = roes.length ? Number((roes.reduce((sum, r) => sum + r, 0) / roes.length).toFixed(1)) : null;

    return {
      annuals,
      spanYears,
      earliestYear: earliest.year,
      latestYear: latest.year,
      cumOcf,
      cumCapEx,
      cumFcf,
      cumBuybacks,
      cumNetIncome,
      equityStart,
      equityEnd,
      equityDelta,
      latestMarketCap,
      earliestMarketCap,
      marketCapDelta,
      dollarTestMultiple,
      dollarTestMethod,
      sharesStart,
      sharesEnd,
      shareDeltaPct,
      capexPct,
      buybackPct,
      fcfPct,
      retainedPct,
      avgRoe,
    };
  }, [data.annuals, data.marketCap, data.pricePoints]);

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

  // Evaluate Dollar Test Tag & Gauge Position
  let dollarTag = "数据统计中";
  let dollarTagClass = "val-tag--neutral";
  let dollarDesc = "留存资本与市值跨期变化统计中。";

  if (stats.dollarTestMultiple != null) {
    if (stats.dollarTestMultiple >= 2.0) {
      dollarTag = `卓越复利（${stats.dollarTestMultiple}x）`;
      dollarTagClass = "val-tag--deep-green";
      dollarDesc =
        stats.dollarTestMethod === "equity"
          ? `每留存 1 元净资产，在市场上创造了 ${stats.dollarTestMultiple} 元市值增量，显著超越巴菲特 1 美元基准。`
          : `在大额回购下，累计净利润创造了 ${stats.dollarTestMultiple} 倍的市值增量，资本复利效能卓越。`;
    } else if (stats.dollarTestMultiple >= 1.0) {
      dollarTag = `通过检验（${stats.dollarTestMultiple}x）`;
      dollarTagClass = "val-tag--green";
      dollarDesc = `每留存 1 元资本创造了 ${stats.dollarTestMultiple} 元市值，有效通过巴菲特一美元检验，为股东创造净增值。`;
    } else if (stats.dollarTestMultiple > 0) {
      dollarTag = `资本折损（${stats.dollarTestMultiple}x）`;
      dollarTagClass = "val-tag--amber";
      dollarDesc = `每留存 1 元资本仅换取 ${stats.dollarTestMultiple} 元市值增量，留存资金回报率不及市场基准。`;
    } else {
      dollarTag = "价值侵蚀";
      dollarTagClass = "val-tag--red";
      dollarDesc = "跨期市值录得净缩水，股东权益或留存收益在市场上遭遇折价。";
    }
  }

  // Gauge needle position: scale [-0.5, 3.5] -> [0%, 100%]
  const gaugeMin = -0.5;
  const gaugeMax = 3.5;
  const dollarValClamped =
    stats.dollarTestMultiple != null
      ? Math.max(gaugeMin, Math.min(gaugeMax, stats.dollarTestMultiple))
      : 1.0;
  const gaugeNeedlePct = ((dollarValClamped - gaugeMin) / (gaugeMax - gaugeMin)) * 100;
  const gaugeBenchmarkPct = ((1.0 - gaugeMin) / (gaugeMax - gaugeMin)) * 100;

  // Evaluate Share Count Tag
  let shareTag = "股本中性稳定";
  let shareTagClass = "val-tag--neutral";
  let shareDesc = `近${stats.spanYears}年总股本规模保持相对平稳。`;

  if (stats.shareDeltaPct != null) {
    if (stats.shareDeltaPct <= -5.0) {
      shareTag = `🔥 实质注销缩股 ${Math.abs(stats.shareDeltaPct)}%`;
      shareTagClass = "val-tag--deep-green";
      shareDesc = `真金白银持续注销在外流通股份，大幅浓缩每股含金量，提升股东长期每股收益。`;
    } else if (stats.shareDeltaPct <= -1.0) {
      shareTag = `微幅回购注销 ${Math.abs(stats.shareDeltaPct)}%`;
      shareTagClass = "val-tag--green";
      shareDesc = `回购注销略微超过期权稀释，每股股本轻微缩减。`;
    } else if (stats.shareDeltaPct >= 5.0) {
      shareTag = `⚠️ 股本增发稀释 +${stats.shareDeltaPct}%`;
      shareTagClass = "val-tag--amber";
      shareDesc = `近${stats.spanYears}年在外流通股数持续扩张，需警惕高管期权激励或外延增发带来的股东权益稀释。`;
    } else {
      shareTag = `股本稳定 (${stats.shareDeltaPct > 0 ? "+" : ""}${stats.shareDeltaPct}%)`;
      shareTagClass = "val-tag--neutral";
      shareDesc = `回购节奏与期权授予基本相抵，总股本波动在可控区间。`;
    }
  }

  // Capital Reinvestment Intensity
  let reinvestIntensity = "轻资产型";
  if (stats.capexPct > 50) {
    reinvestIntensity = "重资产再投资";
  } else if (stats.capexPct > 25) {
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

  const rawMaxBuyback = Math.max(0, ...stats.annuals.map((a) => a.repurchaseAmt || 0));
  // Leave 25% head space for buyback bars so they don't overpower the shares line
  const maxBuyback = rawMaxBuyback > 0 ? rawMaxBuyback * 1.35 : 100;

  const chartPoints = validAnnuals.map((a, i) => {
    const x = padL + (validAnnuals.length > 1 ? (i / (validAnnuals.length - 1)) * innerW : innerW / 2);
    const sharesRatio = (a.shares! - minShares) / Math.max(1, maxShares - minShares);
    const y = padT + (1 - sharesRatio) * innerH;
    return { x, y, year: a.year, shares: a.shares!, buyback: a.repurchaseAmt || 0 };
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
      {/* ── 1. Header with Core Scorecard Summary ── */}
      <div className="val-section-head">
        <div>
          <div className="val-title-row">
            <h3 className="val-title">资本配置行为总账</h3>
            <span className={`val-status-badge ${dollarTagClass}`}>{dollarTag}</span>
            <span className={`val-status-badge ${shareTagClass}`}>{shareTag}</span>
          </div>
          <p className="val-subtitle">
            基于 {stats.earliestYear} - {stats.latestYear}（近 {stats.spanYears} 年）真实财务披露 · 追踪真金白银现金去向与股东回报纪律
          </p>
        </div>
      </div>

      {/* ── 2. Top Metric Cards 4-Column Grid ── */}
      <div className="val-multiples-grid" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
        {/* Card 1: Buffett $1 Rule Test */}
        <div className="val-multiple-card">
          <span className="val-card-label">巴菲特一美元检验 · $1 Rule</span>
          <div className="val-card-val-row">
            <span
              className="val-card-val"
              style={{
                color:
                  stats.dollarTestMultiple != null && stats.dollarTestMultiple >= 1.0
                    ? "#047857"
                    : "#b91c1c",
              }}
            >
              {stats.dollarTestMultiple != null ? `${stats.dollarTestMultiple}x` : "—"}
            </span>
            <span
              className={`val-card-subtag ${
                stats.dollarTestMultiple != null && stats.dollarTestMultiple >= 2.0
                  ? "val-tag--sub-green"
                  : stats.dollarTestMultiple != null && stats.dollarTestMultiple >= 1.0
                  ? "val-tag--sub-green"
                  : "val-tag--sub-red"
              }`}
            >
              基准 1.00x
            </span>
          </div>
          <span className="val-card-hint">
            {stats.dollarTestMethod === "equity"
              ? "Δ市值 / Δ净资产 · 留存创造比"
              : "Δ市值 / 累积利润 · 缩股创造比"}
          </span>
        </div>

        {/* Card 2: Share Count Trajectory */}
        <div className="val-multiple-card">
          <span className="val-card-label">近{stats.spanYears}年总股本变化 · Dilution</span>
          <div className="val-card-val-row">
            <span
              className="val-card-val"
              style={{
                color:
                  stats.shareDeltaPct != null && stats.shareDeltaPct <= -1
                    ? "#047857"
                    : stats.shareDeltaPct != null && stats.shareDeltaPct >= 3
                    ? "#d97706"
                    : "#0f172a",
              }}
            >
              {stats.shareDeltaPct != null
                ? `${stats.shareDeltaPct > 0 ? "+" : ""}${stats.shareDeltaPct}%`
                : "—"}
            </span>
            <span
              className={`val-card-subtag ${
                stats.shareDeltaPct != null && stats.shareDeltaPct <= -1
                  ? "val-tag--sub-green"
                  : stats.shareDeltaPct != null && stats.shareDeltaPct >= 3
                  ? "val-tag--sub-orange"
                  : "val-tag--sub-slate"
              }`}
            >
              {stats.shareDeltaPct != null && stats.shareDeltaPct <= -1
                ? "股份注销缩股"
                : stats.shareDeltaPct != null && stats.shareDeltaPct >= 3
                ? "期权增发稀释"
                : "股本基本平稳"}
            </span>
          </div>
          <span className="val-card-hint">
            {stats.sharesStart && stats.sharesEnd
              ? `${formatUsdInYi(stats.sharesStart)}股 → ${formatUsdInYi(stats.sharesEnd)}股`
              : "摊薄总股本走廊"}
          </span>
        </div>

        {/* Card 3: Cumulative Buybacks */}
        <div className="val-multiple-card">
          <span className="val-card-label">近{stats.spanYears}年累计股票回购 · Buybacks</span>
          <div className="val-card-val-row">
            <span
              className="val-card-val"
              style={{ color: stats.cumBuybacks > 0 ? "#4f46e5" : "#64748b" }}
            >
              {stats.cumBuybacks > 0
                ? `${currencySym}${formatUsdInYi(stats.cumBuybacks)}`
                : "无显著回购"}
            </span>
            <span className="val-card-subtag val-tag--sub-slate">
              {stats.cumBuybacks > 0
                ? `占FCF ${((stats.cumBuybacks / Math.max(1, stats.cumFcf)) * 100).toFixed(0)}%`
                : "未实施回购"}
            </span>
          </div>
          <span className="val-card-hint">
            真金白银注销在外流通股份与回报股东
          </span>
        </div>

        {/* Card 4: FCF Conversion Ratio */}
        <div className="val-multiple-card">
          <span className="val-card-label">现金再投资强度 · CapEx / OCF</span>
          <div className="val-card-val-row">
            <span className="val-card-val">{stats.capexPct}%</span>
            <span className="val-card-subtag val-tag--sub-slate">
              {reinvestIntensity}
            </span>
          </div>
          <span className="val-card-hint">
            资本支出 {currencySym}{formatUsdInYi(stats.cumCapEx)}
          </span>
        </div>
      </div>

      {/* ── 3. Visual Scale: Buffett $1 Benchmark Gauge Card ── */}
      <div className="val-chart-block">
        <div className="val-chart-header">
          <div>
            <h4 className="val-block-title">巴菲特一美元检验标尺 (The $1 Benchmark Gauge)</h4>
            <span className="val-block-desc">
              衡量每 1 元留存利润是否在市场上创造出超过 1 元的市场价值 · 巴菲特致股东信经典准则
            </span>
          </div>
          <div className="cap-chart-hud">
            当前创造倍数：<strong>{stats.dollarTestMultiple != null ? `${stats.dollarTestMultiple}x` : "—"}</strong>
            <span> · 及格基准线 <strong>1.00x</strong></span>
          </div>
        </div>

        <div className="cap-gauge-block">
          <div className="cap-gauge-header">
            <span className="cap-gauge-title">一美元创造倍数区间标尺</span>
            <span className="cap-gauge-subtitle">
              {stats.dollarTestMethod === "equity"
                ? "计算口径：Δ总市值 / Δ账面股东权益"
                : `计算口径：Δ总市值 / 近${stats.spanYears}年累积净利润 (大额回购调整)`}
            </span>
          </div>

          <div className="cap-gauge-track-wrap">
            <div className="cap-gauge-track">
              <div className="cap-gauge-seg cap-gauge-seg--red" style={{ flex: 1.5 }}>
                <span>&lt;0x 价值侵蚀</span>
              </div>
              <div className="cap-gauge-seg cap-gauge-seg--amber" style={{ flex: 1.5 }}>
                <span>0~1.0x 资本折损</span>
              </div>
              <div className="cap-gauge-seg cap-gauge-seg--green" style={{ flex: 1.5 }}>
                <span>1.0~2.0x 达标创造</span>
              </div>
              <div className="cap-gauge-seg cap-gauge-seg--deep-green" style={{ flex: 2 }}>
                <span>&gt;2.0x 卓越复利</span>
              </div>
            </div>

            {/* Benchmark 1.0x Line */}
            <div
              className="cap-gauge-benchmark-line"
              style={{ left: `${gaugeBenchmarkPct}%` }}
              title="巴菲特 1.00x 及格基准红线"
            >
              <span className="cap-gauge-benchmark-label">1.0x 及格线</span>
            </div>

            {/* Dynamic Needle */}
            <div
              className="cap-gauge-needle"
              style={{ left: `${gaugeNeedlePct}%` }}
            >
              <div className="cap-gauge-needle-bubble">
                {stats.dollarTestMultiple != null ? `${stats.dollarTestMultiple}x` : "—"}
              </div>
              <div className="cap-gauge-needle-pin" />
            </div>
          </div>

          <p className="cap-gauge-desc">{dollarDesc}</p>
        </div>
      </div>

      {/* ── 4. Capital Allocation Step-Down Waterfall Flow ── */}
      <div className="val-chart-block">
        <div className="val-chart-header">
          <div>
            <h4 className="val-block-title">经营现金流 (OCF) 资本去向阶梯瀑布</h4>
            <span className="val-block-desc">
              近 {stats.spanYears} 年累计经营现金流 {currencySym}{formatUsdInYi(stats.cumOcf)} 的五向阶梯分解流向
            </span>
          </div>
        </div>

        {/* Waterfall Step Columns with Clean Connectors */}
        <div className="cap-wf-steps-grid">
          {/* Step 1: Cumulative OCF Base */}
          <div className="cap-wf-step-card cap-wf-step-card--base" title="主营业务累计经营现金流全部自生造血">
            <div className="cap-wf-step-badge">1. 资金源头</div>
            <div className="cap-wf-step-val">{currencySym}{formatUsdInYi(stats.cumOcf)}</div>
            <div className="cap-wf-step-name">累计主营现金流</div>
            <div className="cap-wf-step-sub">自生造血 (100%)</div>
          </div>

          <div className="cap-wf-connector">−</div>

          {/* Step 2: CapEx Reinvestment */}
          <div className="cap-wf-step-card cap-wf-step-card--capex" title={`累计资本支出占造血 ${stats.capexPct}%`}>
            <div className="cap-wf-step-badge">2. 再投资支出</div>
            <div className="cap-wf-step-val cap-wf-step-val--red">
              -{currencySym}{formatUsdInYi(stats.cumCapEx)}
            </div>
            <div className="cap-wf-step-name">资本支出 (CapEx)</div>
            <div className="cap-wf-step-sub">占造血 {stats.capexPct}% · {reinvestIntensity}</div>
          </div>

          <div className="cap-wf-connector">=</div>

          {/* Step 3: Free Cash Flow */}
          <div className="cap-wf-step-card cap-wf-step-card--fcf" title={`真实自由现金流，现金转化率 ${stats.fcfPct}%`}>
            <div className="cap-wf-step-badge">3. 自由真金</div>
            <div className="cap-wf-step-val cap-wf-step-val--green">
              {currencySym}{formatUsdInYi(stats.cumFcf)}
            </div>
            <div className="cap-wf-step-name">自由现金流 (FCF)</div>
            <div className="cap-wf-step-sub">造血转化率 {stats.fcfPct}%</div>
          </div>

          <div className="cap-wf-connector">−</div>

          {/* Step 4: Share Buybacks */}
          <div className="cap-wf-step-card cap-wf-step-card--buyback" title="用于二级市场回购注销在外流通股份">
            <div className="cap-wf-step-badge">4. 股东回购</div>
            <div className="cap-wf-step-val cap-wf-step-val--blue">
              {stats.cumBuybacks > 0 ? `-${currencySym}${formatUsdInYi(stats.cumBuybacks)}` : "0"}
            </div>
            <div className="cap-wf-step-name">二级市场回购</div>
            <div className="cap-wf-step-sub">
              {stats.cumBuybacks > 0
                ? `占FCF ${((stats.cumBuybacks / Math.max(1, stats.cumFcf)) * 100).toFixed(0)}%`
                : "未实施回购"}
            </div>
          </div>

          <div className="cap-wf-connector">=</div>

          {/* Step 5: Final Retained Cash / Dividends */}
          <div className="cap-wf-step-card cap-wf-step-card--retained" title="最终自由现金结余，用于现金分红派息、偿债或留存">
            <div className="cap-wf-step-badge">5. 留存结余</div>
            <div className="cap-wf-step-val cap-wf-step-val--purple">
              {currencySym}{formatUsdInYi(Math.max(0, stats.cumFcf - stats.cumBuybacks))}
            </div>
            <div className="cap-wf-step-name">分红派息 / 结余</div>
            <div className="cap-wf-step-sub">现金分红或留存</div>
          </div>
        </div>
      </div>

      {/* ── 5. Diluted Share Count & Buyback Intensity Dual-Axis Chart ── */}
      <div className="val-chart-block">
        <div className="val-chart-header">
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", marginBottom: "4px" }}>
              <h4 className="val-block-title">历年总股本走廊与回购力度双轴趋势</h4>
              <span className={`val-status-badge ${shareTagClass}`}>{shareTag}</span>
            </div>
            <span className="val-block-desc">
              {shareDesc} 折线：在外流通摊薄总股本走廊（浓缩 vs 稀释） · 柱状：该年度股票回购注销资金投入
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
                {activeHover.buyback > 0 && (
                  <span> · 回购 {currencySym}{formatUsdInYi(activeHover.buyback)}</span>
                )}
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
              年度经营现金流、资本开支、真实在外流通总股本与净资产收益率 (ROE) 走廊
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
                <th style={{ textAlign: "right" }}>在外摊薄总股本</th>
                <th style={{ textAlign: "right" }}>ROE</th>
              </tr>
            </thead>
            <tbody>
              {stats.annuals.slice().reverse().map((a) => (
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
                      color: a.freeCashFlow != null && a.freeCashFlow > 0 ? "#059669" : undefined,
                    }}
                  >
                    {a.freeCashFlow != null
                      ? `${currencySym}${formatUsdInYi(a.freeCashFlow)}`
                      : "—"}
                  </td>
                  <td
                    style={{
                      textAlign: "right",
                      color: a.repurchaseAmt && a.repurchaseAmt > 0 ? "#4f46e5" : undefined,
                    }}
                  >
                    {a.repurchaseAmt && a.repurchaseAmt > 0
                      ? `${currencySym}${formatUsdInYi(a.repurchaseAmt)}`
                      : "—"}
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
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
