import Link from "next/link";
import {
  Layers,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Building2,
  ArrowUpRight,
  TrendingUp,
  ShieldAlert,
} from "lucide-react";
import prisma from "@/lib/prisma";
import { formatCompanyUrl } from "@/lib/company-data";
import { AdminUniverseExplorer } from "@/components/admin/AdminUniverseExplorer";

export const dynamic = "force-dynamic";

export default async function AdminUniversePage() {
  const [totalCompanies, phaseCounts, marketPhaseCounts, recentUpdates, failedCompanies, fastTrackCount] =
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
          onboardPhase: { in: [1, 2] },
        },
        select: {
          id: true,
          cik: true,
          code: true,
          ticker: true,
          market: true,
          canonicalName: true,
          onboardPhase: true,
          updatedAt: true,
          metadata: true,
        },
        orderBy: { updatedAt: "desc" },
        take: 15,
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
          onboardPhase: { in: [0, 1] },
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
    const mTotal = mP0 + mP1 + mP2 + mPErr;
    const activeTotal = mTotal - mPErr;
    const rate = activeTotal > 0 ? (((mP1 + mP2) / activeTotal) * 100).toFixed(1) : "0.0";
    return { ...m, total: mTotal, activeTotal, p0: mP0, p1: mP1, p2: mP2, pErr: mPErr, rate };
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

      {/* 5-Stat High-level Metrics */}
      <div className="admin-stat-grid admin-stat-grid--5">
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

        <div className="admin-stat-card">
          <div className="admin-stat-top">
            <span className="admin-stat-label">Phase -1 · 豁免非运营</span>
            <span className="admin-stat-icon admin-stat-icon--amber">
              <ShieldAlert size={16} />
            </span>
          </div>
          <div className="admin-stat-value">{pErr.toLocaleString()}</div>
          <div className="admin-stat-bottom">
            <span className="admin-stat-hint">{pErrPct}% 粉单/ETF/退市等豁免</span>
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
        {/* Recent Phase 1 Stream */}
        <section className="admin-card">
          <div className="admin-card-header">
            <div className="admin-card-title-group">
              <Clock size={16} className="admin-card-title-icon" />
              <h2>管线最新更新</h2>
            </div>
            <span className="admin-stat-hint">最新 {recentUpdates.length} 家</span>
          </div>

          <div className="admin-universe-feed-list">
            {recentUpdates.length === 0 ? (
              <div className="admin-universe-empty">暂无近期更新</div>
            ) : (
              recentUpdates.map((c) => {
                const meta = (c.metadata as Record<string, unknown>) || {};
                const zh = (typeof meta.nameZh === "string" && meta.nameZh) || c.canonicalName;
                const formattedTime = new Intl.DateTimeFormat("zh-CN", {
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: "Asia/Shanghai",
                }).format(new Date(c.updatedAt));
                const url = formatCompanyUrl(c);
                const phaseLabel = c.onboardPhase === 1 ? "P1" : "P2";
                const phaseBadgeClass = c.onboardPhase === 1 ? "admin-badge--blue" : "admin-badge--green";

                return (
                  <div key={c.id} className="admin-universe-feed-item">
                    <div className="admin-universe-feed-main">
                      <span className={`admin-badge ${phaseBadgeClass}`}>
                        {phaseLabel}
                      </span>
                      <span className="admin-badge admin-badge--gray">
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

        {/* Pipeline Health, Excluded Entities & Dead Letter Pool */}
        <section className="admin-card">
          <div className="admin-card-header">
            <div className="admin-card-title-group">
              {pErr > 0 ? (
                <ShieldAlert size={16} className="admin-card-title-icon admin-card-title-icon--amber" />
              ) : (
                <CheckCircle2 size={16} className="admin-card-title-icon admin-card-title-icon--green" />
              )}
              <h2>豁免非运营与死信池</h2>
            </div>
            <span className="admin-stat-hint">
              {pErr > 0 ? `${pErr.toLocaleString()} 家豁免/异常标的` : "运行健康"}
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
                  const isExcluded = Boolean(meta.isExcluded);
                  const reason =
                    (typeof meta.exclusionLabel === "string" && meta.exclusionLabel) ||
                    (typeof meta.onboardPhase1LastError === "string" && meta.onboardPhase1LastError) ||
                    (isExcluded ? "豁免非运营标的" : "多次重试失败");

                  return (
                    <div key={c.id} className="admin-universe-feed-item admin-universe-feed-item--error">
                      <div className="admin-universe-feed-main">
                        <span className={`admin-badge ${isExcluded ? "admin-badge--amber" : "admin-badge--red"}`}>
                          {isExcluded ? "豁免" : (c.market || "us").toUpperCase()}
                        </span>
                        <span className="admin-universe-feed-ticker">{c.ticker || c.code}</span>
                        <span className="admin-universe-feed-name">{zh}</span>
                      </div>
                      <div className="admin-universe-error-desc" title={reason}>
                        {reason}
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
      <AdminUniverseExplorer initialFastTrackCount={fastTrackCount} totalCompanies={totalCompanies} />
    </div>
  );
}
