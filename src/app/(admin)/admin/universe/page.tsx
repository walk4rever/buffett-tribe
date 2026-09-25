import Link from "next/link";
import {
  Layers,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Building2,
  ArrowUpRight,
  TrendingUp,
} from "lucide-react";
import prisma from "@/lib/prisma";
import { formatCompanyUrl } from "@/lib/company-data";
import { AdminUniverseExplorer } from "@/components/admin/AdminUniverseExplorer";

export const dynamic = "force-dynamic";

export default async function AdminUniversePage() {
  const [totalCompanies, phaseCounts, marketPhaseCounts, recentPhase1, failedCompanies, fastTrackCount] =
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
      prisma.entity.findMany({
        where: {
          type: "company",
          onboardPhase: 1,
        },
        select: {
          id: true,
          cik: true,
          code: true,
          ticker: true,
          market: true,
          canonicalName: true,
          updatedAt: true,
          metadata: true,
        },
        orderBy: { updatedAt: "desc" },
        take: 12,
      }),
      prisma.entity.findMany({
        where: {
          type: "company",
          onboardPhase: -1,
        },
        select: {
          id: true,
          ticker: true,
          code: true,
          market: true,
          canonicalName: true,
          updatedAt: true,
          metadata: true,
        },
        orderBy: { updatedAt: "desc" },
        take: 6,
      }),
      prisma.entity.count({
        where: {
          type: "company",
          onboardPhase: 0,
          priority: { gt: 0 },
        },
      }),
    ]);

  const phaseMap: Record<number, number> = {};
  for (const row of phaseCounts) {
    phaseMap[row.onboardPhase] = Number(row.count);
  }

  const p0 = phaseMap[0] ?? 0;
  const p1 = phaseMap[1] ?? 0;
  const p2 = phaseMap[2] ?? 0;
  const pErr = phaseMap[-1] ?? 0;

  const p0Pct = ((p0 / (totalCompanies || 1)) * 100).toFixed(1);
  const p1Pct = ((p1 / (totalCompanies || 1)) * 100).toFixed(1);
  const p2Pct = ((p2 / (totalCompanies || 1)) * 100).toFixed(1);

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
    const mTotal = mP0 + mP1 + mP2;
    const rate = mTotal > 0 ? (((mP1 + mP2) / mTotal) * 100).toFixed(1) : "0.0";
    return { ...m, total: mTotal, p0: mP0, p1: mP1, p2: mP2, rate };
  });

  return (
    <div className="admin-page-container">
      {/* Page Heading */}
      <div className="admin-page-heading">
        <div>
          <h1 className="admin-page-title">公司大盘与建档管线</h1>
          <p className="admin-page-desc">
            全市场 {totalCompanies.toLocaleString()} 家上市公司建档阶段监控、三大市场推进与最新数据库入库流水
            {fastTrackCount > 0 ? `（当前 ${fastTrackCount} 家快速通道加急插队中）` : ""}
          </p>
        </div>
      </div>

      {/* 4-Stat High-level Metrics */}
      <div className="admin-stat-grid">
        <div className="admin-stat-card">
          <div className="admin-stat-top">
            <span className="admin-stat-label">全量大盘底座</span>
            <span className="admin-stat-icon admin-stat-icon--purple">
              <Building2 size={16} />
            </span>
          </div>
          <div className="admin-stat-value">{totalCompanies.toLocaleString()}</div>
          <div className="admin-stat-bottom">
            <span className="admin-stat-hint">覆盖美/港/A三大市场</span>
          </div>
        </div>

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
              {p0Pct}% 等待逐批
              {fastTrackCount > 0 ? (
                <> · <strong style={{ color: "var(--apple-blue, #0071e3)" }}>⚡ {fastTrackCount} 家快速排队</strong></>
              ) : (
                " Onboard"
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
            <span className="admin-stat-hint">{p1Pct}% 财报与量价历史就绪</span>
          </div>
        </div>

        <div className="admin-stat-card">
          <div className="admin-stat-top">
            <span className="admin-stat-label">Phase 2 · 深度分析研报</span>
            <span className="admin-stat-icon admin-stat-icon--green">
              <CheckCircle2 size={16} />
            </span>
          </div>
          <div className="admin-stat-value">{p2.toLocaleString()}</div>
          <div className="admin-stat-bottom">
            <span className="admin-stat-hint">{p2Pct}% 完整五维研报与画布</span>
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
            {(((p1 + p2) / (totalCompanies || 1)) * 100).toFixed(1)}%)
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
                  总量 {m.total.toLocaleString()} 家 · 建档率 {m.rate}%
                </span>
              </div>
            </div>

            <div className="admin-universe-market-stats">
              <div className="admin-universe-market-stat-col">
                <span className="admin-universe-market-num">{m.p2}</span>
                <span className="admin-universe-market-lbl">Phase 2 深度</span>
              </div>
              <div className="admin-universe-market-stat-col">
                <span className="admin-universe-market-num">{m.p1}</span>
                <span className="admin-universe-market-lbl">Phase 1 基础</span>
              </div>
              <div className="admin-universe-market-stat-col">
                <span className="admin-universe-market-num">{m.p0}</span>
                <span className="admin-universe-market-lbl">Phase 0 待处理</span>
              </div>
            </div>

            <div className="admin-universe-mini-bar">
              <div
                className="admin-universe-segment admin-universe-segment--green"
                style={{ width: `${(m.p2 / (m.total || 1)) * 100}%` }}
              />
              <div
                className="admin-universe-segment admin-universe-segment--blue"
                style={{ width: `${(m.p1 / (m.total || 1)) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* 2-Column: Recent Live Feeds & Pipeline Health */}
      <div className="admin-activity-grid">
        {/* Recent Phase 1 Stream */}
        <section className="admin-card">
          <div className="admin-card-header">
            <div className="admin-card-title-group">
              <Clock size={16} className="admin-card-title-icon" />
              <h2>最新 Phase 1 接入流水 (来自 mini 写入)</h2>
            </div>
            <span className="admin-stat-hint">最新 {recentPhase1.length} 家</span>
          </div>

          <div className="admin-universe-feed-list">
            {recentPhase1.length === 0 ? (
              <div className="admin-universe-empty">暂无近期接入流水</div>
            ) : (
              recentPhase1.map((c) => {
                const meta = (c.metadata as Record<string, unknown>) || {};
                const zh = (typeof meta.nameZh === "string" && meta.nameZh) || c.canonicalName;
                const formattedTime = new Intl.DateTimeFormat("zh-CN", {
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                }).format(new Date(c.updatedAt));
                const url = formatCompanyUrl(c);

                return (
                  <div key={c.id} className="admin-universe-feed-item">
                    <div className="admin-universe-feed-main">
                      <span className="admin-badge admin-badge--blue">
                        {(c.market || "us").toUpperCase()}
                      </span>
                      <span className="admin-universe-feed-ticker">{c.ticker || c.code}</span>
                      <span className="admin-universe-feed-name">{zh}</span>
                    </div>

                    <div className="admin-universe-feed-right">
                      <time className="admin-user-mini-time">{formattedTime}</time>
                      {url && (
                        <Link
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="admin-universe-feed-link"
                          title="查看公司详情"
                        >
                          <ArrowUpRight size={13} />
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Pipeline Health & Dead Letter Pool */}
        <section className="admin-card">
          <div className="admin-card-header">
            <div className="admin-card-title-group">
              {pErr > 0 ? (
                <AlertTriangle size={16} className="admin-card-title-icon admin-card-title-icon--red" />
              ) : (
                <CheckCircle2 size={16} className="admin-card-title-icon admin-card-title-icon--green" />
              )}
              <h2>管线健康度与死信预警池</h2>
            </div>
            <span className="admin-stat-hint">
              {pErr > 0 ? `${pErr} 家异常标的` : "运行健康"}
            </span>
          </div>

          <div className="admin-universe-error-box">
            {failedCompanies.length === 0 ? (
              <div className="admin-universe-healthy">
                <CheckCircle2 size={32} className="admin-universe-healthy-icon" />
                <p className="admin-universe-healthy-title">当前无熔断死信标的</p>
                <span className="admin-universe-healthy-sub">
                  定时 Worker 每次运行如遇到网络超时会自动重试最多 3 次，连续失败 3 次将移入死信池并在本栏预警。
                </span>
              </div>
            ) : (
              <div className="admin-universe-feed-list">
                {failedCompanies.map((c) => {
                  const meta = (c.metadata as Record<string, unknown>) || {};
                  const zh = (typeof meta.nameZh === "string" && meta.nameZh) || c.canonicalName;
                  const errReason =
                    typeof meta.onboardPhase1LastError === "string"
                      ? meta.onboardPhase1LastError
                      : "多次重试失败";

                  return (
                    <div key={c.id} className="admin-universe-feed-item admin-universe-feed-item--error">
                      <div className="admin-universe-feed-main">
                        <span className="admin-badge admin-badge--red">
                          {(c.market || "us").toUpperCase()}
                        </span>
                        <span className="admin-universe-feed-ticker">{c.ticker || c.code}</span>
                        <span className="admin-universe-feed-name">{zh}</span>
                      </div>
                      <div className="admin-universe-error-desc" title={errReason}>
                        {errReason}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Interactive Explorer / Search Table */}
      <AdminUniverseExplorer initialFastTrackCount={fastTrackCount} />
    </div>
  );
}
