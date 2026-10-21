import Link from "next/link";
import {
  Layers,
  CheckCircle2,
  Clock,
  Building2,
  TrendingUp,
  ShieldAlert,
  ArrowUpRight,
} from "lucide-react";
import prisma from "@/lib/prisma";
import { classifyOnboardError } from "@/lib/onboard-error";
import { formatCompanyUrl } from "@/lib/company-data";
import { AdminUniverseExplorer } from "@/components/admin/AdminUniverseExplorer";

export const dynamic = "force-dynamic";

export default async function AdminUniversePage() {
  const [
    totalCompanies,
    phaseCounts,
    marketPhaseCounts,
    retryStageCounts,
    retryMarketCounts,
    recentBatches,
    recentFailureEvents,
    retryableCount,
    retryableCompanies,
    retryExhaustedCompanies,
    fastTrackCount,
  ] =
    await Promise.all([
      prisma.entity.count({ where: { type: "company" } }),
      prisma.$queryRaw<Array<{ onboardPhase: number; count: bigint }>>`
        SELECT "onboardPhase", count(*) as count
        FROM "Entity"
        WHERE type = 'company'
        GROUP BY "onboardPhase"
        ORDER BY "onboardPhase" ASC;
      `,
      prisma.$queryRaw<Array<{ market: string; onboardPhase: number; count: bigint }>>`
        SELECT COALESCE(market, 'unknown') as market, "onboardPhase", count(*) as count
        FROM "Entity"
        WHERE type = 'company'
        GROUP BY market, "onboardPhase"
        ORDER BY market ASC, "onboardPhase" ASC;
      `,
      prisma.$queryRaw<Array<{ retryExhaustedStage: number | null; count: bigint }>>`
        SELECT "retryExhaustedStage", count(*) as count
        FROM "Entity"
        WHERE type = 'company'
        GROUP BY "retryExhaustedStage"
        ORDER BY "retryExhaustedStage" ASC NULLS LAST;
      `,
      prisma.$queryRaw<Array<{ market: string; count: bigint }>>`
        SELECT COALESCE(market, 'unknown') as market, count(*) as count
        FROM "Entity"
        WHERE type = 'company'
          AND "retryExhaustedStage" IS NOT NULL
        GROUP BY market;
      `,
      prisma.$queryRaw<Array<{
        batchId: string;
        startedAt: Date;
        completedAt: Date;
        total: number;
        succeeded: number;
        failed: number;
      }>>`
        SELECT "batchId",
               min("createdAt") AS "startedAt",
               max("createdAt") AS "completedAt",
               count(*)::int AS total,
               count(*) FILTER (WHERE result = 'success')::int AS succeeded,
               count(*) FILTER (WHERE result = 'failure')::int AS failed
        FROM "OnboardEvent"
        WHERE "createdAt" >= NOW() - INTERVAL '72 hours'
        GROUP BY "batchId"
        ORDER BY max("createdAt") DESC
        LIMIT 8;
      `,
      prisma.$queryRaw<Array<{
        id: string;
        ticker: string | null;
        market: string | null;
        phase: number;
        targetPhase: number | null;
        errorCategory: string | null;
        errorMessage: string | null;
        createdAt: Date;
      }>>`
        SELECT id, ticker, market, phase, "targetPhase",
               "errorCategory", "errorMessage", "createdAt"
        FROM "OnboardEvent"
        WHERE result = 'failure'
          AND "createdAt" >= NOW() - INTERVAL '72 hours'
        ORDER BY "createdAt" DESC
        LIMIT 8;
      `,
      prisma.$queryRaw<Array<{ count: number }>>`
        SELECT count(*)::int AS count
        FROM "Entity"
        WHERE type = 'company'
          AND "onboardPhase" >= 0
          AND "retryExhaustedStage" IS NULL
          AND (
            CASE WHEN metadata->>'onboardPhase1Attempts' ~ '^[0-9]+$'
              THEN (metadata->>'onboardPhase1Attempts')::int ELSE 0 END BETWEEN 1 AND 2
            OR CASE WHEN metadata->>'onboardPhase2Attempts' ~ '^[0-9]+$'
              THEN (metadata->>'onboardPhase2Attempts')::int ELSE 0 END BETWEEN 1 AND 2
            OR CASE WHEN metadata->>'phase3Attempts' ~ '^[0-9]+$'
              THEN (metadata->>'phase3Attempts')::int ELSE 0 END BETWEEN 1 AND 2
          );
      `,
      prisma.$queryRaw<Array<{
        id: string;
        cik: string | null;
        ticker: string | null;
        market: string | null;
        canonicalName: string;
        onboardPhase: number;
        metadata: unknown;
      }>>`
        SELECT id, cik, ticker, market, "canonicalName", "onboardPhase", metadata
        FROM "Entity"
        WHERE type = 'company'
          AND "onboardPhase" >= 0
          AND "retryExhaustedStage" IS NULL
          AND (
            CASE WHEN metadata->>'onboardPhase1Attempts' ~ '^[0-9]+$'
              THEN (metadata->>'onboardPhase1Attempts')::int ELSE 0 END BETWEEN 1 AND 2
            OR CASE WHEN metadata->>'onboardPhase2Attempts' ~ '^[0-9]+$'
              THEN (metadata->>'onboardPhase2Attempts')::int ELSE 0 END BETWEEN 1 AND 2
            OR CASE WHEN metadata->>'phase3Attempts' ~ '^[0-9]+$'
              THEN (metadata->>'phase3Attempts')::int ELSE 0 END BETWEEN 1 AND 2
          )
        ORDER BY "updatedAt" ASC
        LIMIT 6;
      `,
      prisma.entity.findMany({
        where: {
          type: "company",
          retryExhaustedStage: { not: null },
        },
        select: {
          id: true,
          cik: true,
          ticker: true,
          code: true,
          market: true,
          canonicalName: true,
          onboardPhase: true,
          retryExhaustedStage: true,
          updatedAt: true,
          metadata: true,
        },
        orderBy: [
          { priority: "desc" },
          { retryExhaustedStage: "desc" },
          { updatedAt: "asc" },
        ],
        take: 6,
      }),
      prisma.entity.count({
        where: {
          type: "company",
          onboardPhase: { gte: 0 },
          priority: { gt: 0 },
        },
      }),
    ]);

  const phaseMap: Record<number, number> = {};
  for (const row of phaseCounts) {
    phaseMap[row.onboardPhase] = Number(row.count);
  }
  const retryStageMap: Record<number, number> = {};
  for (const row of retryStageCounts) {
    if (row.retryExhaustedStage != null) {
      retryStageMap[row.retryExhaustedStage] = Number(row.count);
    }
  }

  const p0 = phaseMap[0] ?? 0;
  const p1 = phaseMap[1] ?? 0;
  const p2 = phaseMap[2] ?? 0;
  const pErr = phaseMap[-1] ?? 0;
  const retryExhaustedCount =
    (retryStageMap[1] ?? 0) +
    (retryStageMap[2] ?? 0) +
    (retryStageMap[3] ?? 0);
  const retryableTotal = Number(retryableCount[0]?.count ?? 0);

  const p0Pct = ((p0 / (totalCompanies || 1)) * 100).toFixed(1);
  const p1Pct = ((p1 / (totalCompanies || 1)) * 100).toFixed(1);
  const p2Pct = ((p2 / (totalCompanies || 1)) * 100).toFixed(1);
  const pErrPct = ((pErr / (totalCompanies || 1)) * 100).toFixed(1);

  // Market stats calculation
  const markets = [
    { key: "us", label: "美股 (US)", flag: "🇺🇸" },
    { key: "hk", label: "港股 (HK)", flag: "🇭🇰" },
    { key: "cn", label: "A股 (CN)", flag: "🇨🇳" },
  ];

  const marketStats = markets.map((m) => {
    const rows = marketPhaseCounts.filter((r) => r.market === m.key);
    const mP0 = Number(rows.find((r) => r.onboardPhase === 0)?.count ?? 0);
    const mP1 = Number(rows.find((r) => r.onboardPhase === 1)?.count ?? 0);
    const mP2 = Number(rows.find((r) => r.onboardPhase === 2)?.count ?? 0);
    const mPErr = Number(rows.find((r) => r.onboardPhase === -1)?.count ?? 0);
    const mRetry = Number(
      retryMarketCounts.find((r) => r.market === m.key)?.count ?? 0,
    );
    const mTotal = mP0 + mP1 + mP2 + mPErr;
    const activeTotal = mTotal - mPErr;
    const rate = activeTotal > 0 ? (((mP1 + mP2) / activeTotal) * 100).toFixed(1) : "0.0";
    return {
      ...m,
      total: mTotal,
      activeTotal,
      p0: mP0,
      p1: mP1,
      p2: mP2,
      pErr: mPErr,
      retryExhausted: mRetry,
      rate,
    };
  });

  return (
    <div className="admin-page-container">
      {/* Page Heading */}
      <div className="admin-page-heading">
        <div>
          <h1 className="admin-page-title">公司大盘与建档管线</h1>
          <p className="admin-page-desc">
            全市场 {totalCompanies.toLocaleString()} 家上市公司建档阶段监控、三大市场推进与最新数据库入库流水
            {retryExhaustedCount > 0 ? `；${retryExhaustedCount} 家重试耗尽待人工` : ""}
            {fastTrackCount > 0 ? `（当前 ${fastTrackCount} 家快速通道加急插队中）` : ""}
          </p>
        </div>
      </div>

      {/* 5-Stat Two-Row Metrics: Row 1 = Macro Universe & Exclusions, Row 2 = Operating Pipeline Funnel */}
      <div className="admin-universe-stats-group">
        {/* Row 1: Macro Universe (2 Cards) */}
        <div className="admin-universe-stats-row1">
          <div className="admin-stat-card">
            <div className="admin-stat-top">
              <span className="admin-stat-label">全量上市公司大盘</span>
              <span className="admin-stat-icon admin-stat-icon--purple">
                <Building2 size={16} />
              </span>
            </div>
            <div className="admin-stat-value">{totalCompanies.toLocaleString()}</div>
            <div className="admin-stat-bottom">
              <span className="admin-stat-hint">
                覆盖美/港/A三大市场 · 实际运营实体 {(totalCompanies - pErr).toLocaleString()} 家
              </span>
            </div>
          </div>

          <div className="admin-stat-card">
            <div className="admin-stat-top">
              <span className="admin-stat-label">Phase -1 · 豁免非运营标的</span>
              <span className="admin-stat-icon admin-stat-icon--amber">
                <ShieldAlert size={16} />
              </span>
            </div>
            <div className="admin-stat-value">{pErr.toLocaleString()}</div>
            <div className="admin-stat-bottom">
              <span className="admin-stat-hint">
                {pErrPct}% 粉单/ETF/退市等主动豁免（不占用建档管线）
              </span>
            </div>
          </div>
        </div>

        {/* Row 2: Pipeline Lifecycle Funnel (3 Cards) */}
        <div className="admin-universe-stats-row2">
          <div className="admin-stat-card">
            <div className="admin-stat-top">
              <span className="admin-stat-label">Phase 0 · 待处理底座</span>
              <span className="admin-stat-icon admin-stat-icon--orange">
                <Clock size={16} />
              </span>
            </div>
            <div className="admin-stat-value">{p0.toLocaleString()}</div>
            <div className="admin-stat-bottom">
              <span className="admin-stat-hint">
                占运营实体 {(((p0) / (totalCompanies - pErr || 1)) * 100).toFixed(1)}% · 等待逐批
                {fastTrackCount > 0 ? (
                  <> · <strong style={{ color: "var(--apple-blue, #0071e3)" }}>⚡ {fastTrackCount} 家快速排队</strong></>
                ) : (
                  retryExhaustedCount > 0
                    ? `建档 · ${retryExhaustedCount} 家重试耗尽`
                    : "建档"
                )}
              </span>
            </div>
          </div>

          <div className="admin-stat-card">
            <div className="admin-stat-top">
              <span className="admin-stat-label">Phase 1 · 基础已建档</span>
              <span className="admin-stat-icon admin-stat-icon--blue">
                <Layers size={16} />
              </span>
            </div>
            <div className="admin-stat-value">{p1.toLocaleString()}</div>
            <div className="admin-stat-bottom">
              <span className="admin-stat-hint">
                占运营实体 {(((p1) / (totalCompanies - pErr || 1)) * 100).toFixed(1)}% · 财报与量价历史就绪
              </span>
            </div>
          </div>

          <div className="admin-stat-card">
            <div className="admin-stat-top">
              <span className="admin-stat-label">Phase 2 · 深度研报就绪</span>
              <span className="admin-stat-icon admin-stat-icon--green">
                <CheckCircle2 size={16} />
              </span>
            </div>
            <div className="admin-stat-value">{p2.toLocaleString()}</div>
            <div className="admin-stat-bottom">
              <span className="admin-stat-hint">
                占运营实体 {(((p2) / (totalCompanies - pErr || 1)) * 100).toFixed(1)}% · 完整五维研报与画布
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Visual Progress Bar Card */}
      <section className="admin-card">
        <div className="admin-card-header">
          <div className="admin-card-title-group">
            <TrendingUp size={16} className="admin-card-title-icon" />
            <h2>大盘整体建档进度条</h2>
          </div>
          <span className="admin-stat-hint">
            已建档 (P1+P2): {(p1 + p2).toLocaleString()} 家 (
            占运营实体 {(((p1 + p2) / (totalCompanies - pErr || 1)) * 100).toFixed(1)}%)
          </span>
        </div>

        <div className="admin-universe-progress-wrap">
          <div className="admin-universe-bar">
            <div
              className="admin-universe-segment admin-universe-segment--green"
              style={{ width: `${Math.max(1, parseFloat(p2Pct))}%` }}
              title={`Phase 2 深度分析: ${p2.toLocaleString()} 家 (${p2Pct}%)`}
            />
            <div
              className="admin-universe-segment admin-universe-segment--blue"
              style={{ width: `${Math.max(1, parseFloat(p1Pct))}%` }}
              title={`Phase 1 基础建档: ${p1.toLocaleString()} 家 (${p1Pct}%)`}
            />
            <div
              className="admin-universe-segment admin-universe-segment--gray"
              style={{ width: `${parseFloat(p0Pct)}%` }}
              title={`Phase 0 待处理: ${p0.toLocaleString()} 家 (${p0Pct}%)`}
            />
            {pErr > 0 && (
              <div
                className="admin-universe-segment admin-universe-segment--amber"
                style={{ width: `${parseFloat(pErrPct)}%` }}
                title={`Phase -1 豁免/非运营: ${pErr.toLocaleString()} 家 (${pErrPct}%)`}
              />
            )}
          </div>
          <div className="admin-universe-legend">
            <div className="admin-universe-legend-item">
              <span className="admin-universe-dot admin-universe-dot--green" />
              <span>Phase 2 深度研报 ({p2.toLocaleString()} 家 · {p2Pct}%)</span>
            </div>
            <div className="admin-universe-legend-item">
              <span className="admin-universe-dot admin-universe-dot--blue" />
              <span>Phase 1 基础建档 ({p1.toLocaleString()} 家 · {p1Pct}%)</span>
            </div>
            <div className="admin-universe-legend-item">
              <span className="admin-universe-dot admin-universe-dot--gray" />
              <span>Phase 0 待建档底座 ({p0.toLocaleString()} 家 · {p0Pct}%)</span>
            </div>
            {pErr > 0 && (
              <div className="admin-universe-legend-item">
                <span className="admin-universe-dot admin-universe-dot--amber" />
                <span>Phase -1 豁免非运营 ({pErr.toLocaleString()} 家 · {pErrPct}%)</span>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 3 Market Breakdown Cards */}
      <div className="admin-universe-market-grid">
        {marketStats.map((m) => (
          <div key={m.key} className="admin-card admin-universe-market-card">
            <div className="admin-universe-market-top">
              <span className="admin-universe-market-flag">{m.flag}</span>
              <div>
                <h3 className="admin-universe-market-title">{m.label}</h3>
                <span className="admin-universe-market-sub">
                  总量 {m.total.toLocaleString()} 家 · 运营建档率 {m.rate}%
                  {m.retryExhausted > 0 ? ` · 重试 ${m.retryExhausted}` : ""}
                </span>
              </div>
            </div>

            <div className="admin-universe-market-stats">
              <div className="admin-universe-market-stat-col">
                <span className="admin-universe-market-num">{m.p2.toLocaleString()}</span>
                <span className="admin-universe-market-lbl">P2 深度</span>
              </div>
              <div className="admin-universe-market-stat-col">
                <span className="admin-universe-market-num">{m.p1.toLocaleString()}</span>
                <span className="admin-universe-market-lbl">P1 基础</span>
              </div>
              <div className="admin-universe-market-stat-col">
                <span className="admin-universe-market-num">{m.p0.toLocaleString()}</span>
                <span className="admin-universe-market-lbl">P0 待建档</span>
              </div>
              <div className="admin-universe-market-stat-col">
                <span className="admin-universe-market-num">{m.pErr.toLocaleString()}</span>
                <span className="admin-universe-market-lbl">P-1 豁免</span>
              </div>
            </div>

            <div className="admin-universe-mini-bar">
              <div
                className="admin-universe-segment admin-universe-segment--green"
                style={{ width: `${(m.p2 / (m.total || 1)) * 100}%` }}
                title={`Phase 2 深度: ${m.p2}`}
              />
              <div
                className="admin-universe-segment admin-universe-segment--blue"
                style={{ width: `${(m.p1 / (m.total || 1)) * 100}%` }}
                title={`Phase 1 基础: ${m.p1}`}
              />
              {m.pErr > 0 && (
                <div
                  className="admin-universe-segment admin-universe-segment--amber"
                  style={{ width: `${(m.pErr / (m.total || 1)) * 100}%` }}
                  title={`Phase -1 豁免: ${m.pErr}`}
                />
              )}
            </div>
          </div>
        ))}
      </div>

      {/* 2-Column: Recent Live Feeds & Pipeline Health */}
      <div className="admin-activity-grid">
        {/* Recent batch activity */}
        <section className="admin-card">
          <div className="admin-card-header">
            <div className="admin-card-title-group">
              <Clock size={16} className="admin-card-title-icon" />
              <h2>最近批次与活动</h2>
            </div>
            <span className="admin-stat-hint">最近 {recentBatches.length} 批</span>
          </div>

          <div className="admin-universe-feed-list">
            {recentBatches.length === 0 ? (
              <div className="admin-universe-empty">
                新事件表已启用，等待下一批 worker 写入
              </div>
            ) : (
              recentBatches.map((batch) => {
                const completed = new Intl.DateTimeFormat("zh-CN", {
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                  timeZone: "Asia/Shanghai",
                }).format(new Date(batch.completedAt));
                const elapsedMinutes = Math.max(
                  0,
                  Math.round(
                    (new Date(batch.completedAt).getTime() -
                      new Date(batch.startedAt).getTime()) /
                      60000,
                  ),
                );

                return (
                  <div key={batch.batchId} className="admin-universe-feed-item">
                    <div className="admin-universe-feed-main">
                      <span
                        className={`admin-badge ${
                          batch.failed > 0 ? "admin-badge--red" : "admin-badge--green"
                        }`}
                      >
                        {batch.failed > 0 ? "部分失败" : "全部成功"}
                      </span>
                      <span className="admin-universe-feed-name">
                        成功 {batch.succeeded} / 失败 {batch.failed}
                      </span>
                    </div>

                    <div className="admin-universe-feed-right">
                      <time className="admin-user-mini-time">
                        {completed} · {elapsedMinutes} 分钟
                      </time>
                    </div>
                  </div>
                );
              })
            )}

            {recentFailureEvents.length > 0 && (
              <>
                <div className="admin-stat-hint" style={{ marginTop: "18px" }}>
                  最近失败
                </div>
                {recentFailureEvents.map((event) => (
                  <div key={event.id} className="admin-universe-feed-item">
                    <div className="admin-universe-feed-main">
                      <span className="admin-badge admin-badge--red">
                        P{event.targetPhase ?? event.phase + 1}
                      </span>
                      <span className="admin-badge admin-badge--gray">
                        {(event.market || "us").toUpperCase()}
                      </span>
                      <span className="admin-universe-feed-ticker">{event.ticker}</span>
                      <span className="admin-universe-feed-name">
                        {event.errorCategory || "阶段执行失败"}
                      </span>
                    </div>
                    <div className="admin-universe-feed-right">
                      <time className="admin-user-mini-time">
                        {new Intl.DateTimeFormat("zh-CN", {
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                          timeZone: "Asia/Shanghai",
                        }).format(new Date(event.createdAt))}
                      </time>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </section>

        {/* Action queue */}
        <section className="admin-card">
          <div className="admin-card-header">
            <div className="admin-card-title-group">
              {retryExhaustedCount > 0 ? (
                <ShieldAlert size={16} className="admin-card-title-icon admin-card-title-icon--amber" />
              ) : pErr > 0 ? (
                <ShieldAlert size={16} className="admin-card-title-icon admin-card-title-icon--amber" />
              ) : (
                <CheckCircle2 size={16} className="admin-card-title-icon admin-card-title-icon--green" />
              )}
              <h2>待处理队列</h2>
            </div>
            <span className="admin-stat-hint">
              {retryExhaustedCount.toLocaleString()} 重试耗尽 · {retryableTotal.toLocaleString()} 可重试
            </span>
          </div>

          <div className="admin-universe-error-box">
            {retryExhaustedCompanies.length === 0 && retryableCompanies.length === 0 ? (
              <div className="admin-universe-healthy">
                <CheckCircle2 size={32} className="admin-universe-healthy-icon" />
                <p className="admin-universe-healthy-title">当前没有待处理失败</p>
                <span className="admin-universe-healthy-sub">
                  自动重试与人工处理队列均为空。
                </span>
              </div>
            ) : (
              <div className="admin-universe-feed-list">
                <div className="admin-stat-hint" style={{ marginTop: "18px" }}>
                  重试耗尽待人工
                </div>
                {retryExhaustedCompanies.length === 0 ? (
                  <div className="admin-universe-empty">暂无重试耗尽标的</div>
                ) : (
                  retryExhaustedCompanies.map((c) => {
                    const meta = (c.metadata as Record<string, unknown>) || {};
                    const zh = (typeof meta.nameZh === "string" && meta.nameZh) || c.canonicalName;
                    const stage = c.retryExhaustedStage;
                    const url = formatCompanyUrl(c);
                    const rawReason =
                      stage != null && typeof meta[`onboardPhase${stage}LastError`] === "string"
                        ? String(meta[`onboardPhase${stage}LastError`])
                        : "";
                    const category = classifyOnboardError(rawReason);
                    const attempts = Number(
                      meta[stage === 1 ? "onboardPhase1Attempts" : stage === 2 ? "onboardPhase2Attempts" : "phase3Attempts"] ?? 3,
                    );
                    const reason = category === "阶段执行失败"
                      ? `自动重试已耗尽 · 尝试 ${attempts} 次`
                      : `${category} · 尝试 ${attempts} 次`;
                    return (
                      <div key={c.id} className="admin-universe-feed-item admin-universe-feed-item--error">
                        <div className="admin-universe-feed-main">
                          <span className="admin-badge admin-badge--red">
                            重试耗尽 · P{stage}
                          </span>
                          <span className="admin-badge admin-badge--gray">{(c.market || "us").toUpperCase()}</span>
                          <span className="admin-universe-feed-ticker">{c.ticker || c.code}</span>
                          <span className="admin-universe-feed-name">{zh}</span>
                          {url && (
                            <Link href={url} target="_blank" rel="noreferrer" className="admin-universe-feed-link" title="查看公司详情">
                              <ArrowUpRight size={13} />
                            </Link>
                          )}
                        </div>
                        <div className="admin-universe-error-desc" title={rawReason || reason}>{reason}</div>
                      </div>
                    );
                  })
                )}

                <div className="admin-stat-hint" style={{ marginTop: "18px" }}>
                  自动重试中
                </div>
                {retryableCompanies.length === 0 ? (
                  <div className="admin-universe-empty">暂无自动重试中的标的</div>
                ) : (
                  retryableCompanies.map((c) => {
                    const meta = (c.metadata as Record<string, unknown>) || {};
                    const zh = (typeof meta.nameZh === "string" && meta.nameZh) || c.canonicalName;
                    const stage = c.onboardPhase + 1;
                    const url = formatCompanyUrl(c);
                    const rawReason =
                      typeof meta[`onboardPhase${stage}LastError`] === "string"
                        ? String(meta[`onboardPhase${stage}LastError`])
                        : "";
                    const category = classifyOnboardError(rawReason);
                    const attempts = Number(
                      meta[stage === 1 ? "onboardPhase1Attempts" : stage === 2 ? "onboardPhase2Attempts" : "phase3Attempts"] ?? 0,
                    );
                    const reason = category === "阶段执行失败"
                      ? `自动重试中 · 已尝试 ${attempts} 次`
                      : `${category} · 已尝试 ${attempts} 次`;
                    return (
                      <div key={c.id} className="admin-universe-feed-item">
                        <div className="admin-universe-feed-main">
                          <span className="admin-badge admin-badge--amber">
                            可重试 · P{stage}
                          </span>
                          <span className="admin-badge admin-badge--gray">
                            {(c.market || "us").toUpperCase()}
                          </span>
                          <span className="admin-universe-feed-ticker">{c.ticker || c.id}</span>
                          <span className="admin-universe-feed-name">{zh}</span>
                          {url && (
                            <Link href={url} target="_blank" rel="noreferrer" className="admin-universe-feed-link" title="查看公司详情">
                              <ArrowUpRight size={13} />
                            </Link>
                          )}
                        </div>
                        <div className="admin-universe-error-desc" title={rawReason || reason}>{reason}</div>
                      </div>
                    );
                  })
                )}

                <div className="admin-stat-hint" style={{ marginTop: "18px" }}>
                  另有 {pErr.toLocaleString()} 家主动豁免标的，不进入重试队列；可在下方全市场检索中按“豁免标的”查看。
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Interactive Explorer / Search Table */}
      <AdminUniverseExplorer initialFastTrackCount={fastTrackCount} totalCompanies={totalCompanies} />
    </div>
  );
}
