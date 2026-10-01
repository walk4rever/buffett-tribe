import Link from "next/link";
import {
  Users,
  Percent,
  Building2,
  CheckCircle2,
  ArrowUpRight,
  UserCheck,
  Clock,
} from "lucide-react";
import prisma from "@/lib/prisma";
import { currentPeriod, SPEND_AGENT, GRANT_FREE } from "@/lib/credits";
import { formatCompanyUrl } from "@/lib/company-data";

export default async function AdminOverviewPage() {
  const period = currentPeriod();

  const [
    userCount,
    granted,
    spent,
    recentUsers,
    totalCompanies,
    phaseCounts,
    recentCompanyUpdates,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.creditLedger.aggregate({
      _sum: { delta: true },
      where: { period, reason: GRANT_FREE },
    }),
    prisma.creditLedger.aggregate({
      _sum: { delta: true },
      where: { period, reason: SPEND_AGENT },
    }),
    prisma.user.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    }),
    prisma.entity.count({ where: { type: "company" } }),
    prisma.$queryRaw<Array<{ onboardPhase: number; count: bigint }>>`
      SELECT "onboardPhase", count(*) as count
      FROM "Entity"
      WHERE type = 'company'
      GROUP BY "onboardPhase"
      ORDER BY "onboardPhase" ASC;
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
      take: 8,
    }),
  ]);

  const grantedTotal = granted._sum.delta ?? 0;
  const spentTotal = Math.abs(spent._sum.delta ?? 0);
  const burnRate =
    grantedTotal > 0 ? ((spentTotal / grantedTotal) * 100).toFixed(1) : "0.0";

  const phaseMap: Record<number, number> = {};
  for (const row of phaseCounts) {
    phaseMap[row.onboardPhase] = Number(row.count);
  }

  const p1 = phaseMap[1] ?? 0;
  const p2 = phaseMap[2] ?? 0;
  const completedCount = p1 + p2;
  const completionRate =
    totalCompanies > 0 ? ((completedCount / totalCompanies) * 100).toFixed(1) : "0.0";

  return (
    <div className="admin-page-container">
      {/* Page Title */}
      <div className="admin-page-heading">
        <div>
          <h1 className="admin-page-title">全站数据大盘</h1>
          <p className="admin-page-desc">
            用户增长与公司建档核心指标概览 · 本月账期 {period}
          </p>
        </div>
      </div>

      {/* 4-Stat Grid: 用户2个 + 公司2个 */}
      <div className="admin-stat-grid">
        <Link href="/admin/users" className="admin-stat-card">
          <div className="admin-stat-top">
            <span className="admin-stat-label">总注册用户</span>
            <span className="admin-stat-icon admin-stat-icon--blue">
              <Users size={16} />
            </span>
          </div>
          <div className="admin-stat-value">{userCount.toLocaleString()}</div>
          <div className="admin-stat-bottom">
            <span>点击查看用户详情</span>
            <ArrowUpRight size={13} />
          </div>
        </Link>

        <div className="admin-stat-card">
          <div className="admin-stat-top">
            <span className="admin-stat-label">本月额度消耗率</span>
            <span className="admin-stat-icon admin-stat-icon--purple">
              <Percent size={16} />
            </span>
          </div>
          <div className="admin-stat-value">{burnRate}%</div>
          <div className="admin-stat-bottom">
            <span className="admin-stat-hint">消耗 {spentTotal.toLocaleString()} / 发放 {grantedTotal.toLocaleString()}</span>
          </div>
        </div>

        <Link href="/admin/universe" className="admin-stat-card">
          <div className="admin-stat-top">
            <span className="admin-stat-label">全量公司底座</span>
            <span className="admin-stat-icon admin-stat-icon--orange">
              <Building2 size={16} />
            </span>
          </div>
          <div className="admin-stat-value">{totalCompanies.toLocaleString()}</div>
          <div className="admin-stat-bottom">
            <span>点击查看建档管线</span>
            <ArrowUpRight size={13} />
          </div>
        </Link>

        <div className="admin-stat-card">
          <div className="admin-stat-top">
            <span className="admin-stat-label">建档完成率</span>
            <span className="admin-stat-icon admin-stat-icon--green">
              <CheckCircle2 size={16} />
            </span>
          </div>
          <div className="admin-stat-value">{completionRate}%</div>
          <div className="admin-stat-bottom">
            <span className="admin-stat-hint">P1+P2 共 {completedCount.toLocaleString()} 家</span>
          </div>
        </div>
      </div>

      {/* 2-Column Activity Feed */}
      <div className="admin-activity-grid">
        {/* Recent Registered Users */}
        <section className="admin-card">
          <div className="admin-card-header">
            <div className="admin-card-title-group">
              <UserCheck size={16} className="admin-card-title-icon" />
              <h2>最新注册用户</h2>
            </div>
            <Link href="/admin/users" className="admin-card-link">
              <span>查看全部</span>
              <ArrowUpRight size={13} />
            </Link>
          </div>

          <div className="admin-user-mini-list">
            {recentUsers.map((u) => {
              const initial = (u.name || u.email || "U").slice(0, 1).toUpperCase();
              const formattedDate = new Intl.DateTimeFormat("zh-CN", {
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              }).format(new Date(u.createdAt));

              return (
                <div key={u.id} className="admin-user-mini-item">
                  <div className="admin-user-mini-avatar">{initial}</div>
                  <div className="admin-user-mini-info">
                    <div className="admin-user-mini-primary">
                      <span className="admin-user-mini-name">
                        {u.email ?? u.name ?? u.id}
                      </span>
                      {u.role === "admin" && (
                        <span className="admin-badge admin-badge--admin">Admin</span>
                      )}
                    </div>
                    {u.name && u.email && (
                      <span className="admin-user-mini-sub">{u.name}</span>
                    )}
                  </div>
                  <time className="admin-user-mini-time">{formattedDate}</time>
                </div>
              );
            })}
          </div>
        </section>

        {/* Recent Company Updates */}
        <section className="admin-card">
          <div className="admin-card-header">
            <div className="admin-card-title-group">
              <Clock size={16} className="admin-card-title-icon" />
              <h2>管线最新更新</h2>
            </div>
            <Link href="/admin/universe" className="admin-card-link">
              <span>查看全部</span>
              <ArrowUpRight size={13} />
            </Link>
          </div>

          <div className="admin-universe-feed-list">
            {recentCompanyUpdates.length === 0 ? (
              <div className="admin-universe-empty">暂无近期更新</div>
            ) : (
              recentCompanyUpdates.map((c) => {
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
      </div>
    </div>
  );
}

