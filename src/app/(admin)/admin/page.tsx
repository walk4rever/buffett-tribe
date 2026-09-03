import Link from "next/link";
import {
  Users,
  CreditCard,
  Flame,
  Percent,
  ArrowUpRight,
  Clock,
  UserCheck,
} from "lucide-react";
import prisma from "@/lib/prisma";
import { currentPeriod, GRANT_FREE, SPEND_AGENT, GRANT_ADMIN_ADJUST } from "@/lib/credits";

function formatReason(reason: string): string {
  switch (reason) {
    case GRANT_FREE:
      return "月度免费额度";
    case SPEND_AGENT:
      return "投研 Agent 消耗";
    case GRANT_ADMIN_ADJUST:
      return "管理员调整";
    default:
      return reason;
  }
}

export default async function AdminOverviewPage() {
  const period = currentPeriod();

  const [userCount, granted, spent, recentUsers, recentLedger] = await Promise.all([
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
    prisma.creditLedger.findMany({
      take: 6,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        delta: true,
        reason: true,
        createdAt: true,
        user: { select: { email: true, name: true } },
      },
    }),
  ]);

  const grantedTotal = granted._sum.delta ?? 0;
  const spentTotal = Math.abs(spent._sum.delta ?? 0);
  const burnRate =
    grantedTotal > 0 ? ((spentTotal / grantedTotal) * 100).toFixed(1) : "0.0";

  return (
    <div className="admin-page-container">
      {/* Page Title */}
      <div className="admin-page-heading">
        <div>
          <h1 className="admin-page-title">数据大盘</h1>
          <p className="admin-page-desc">
            全站用户增长与本月 ({period}) 额度运转概况
          </p>
        </div>
      </div>

      {/* 4-Stat Grid */}
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
            <span className="admin-stat-label">本月已发放额度</span>
            <span className="admin-stat-icon admin-stat-icon--green">
              <CreditCard size={16} />
            </span>
          </div>
          <div className="admin-stat-value">{grantedTotal.toLocaleString()}</div>
          <div className="admin-stat-bottom">
            <span className="admin-stat-hint">按需分配给活跃用户</span>
          </div>
        </div>

        <div className="admin-stat-card">
          <div className="admin-stat-top">
            <span className="admin-stat-label">本月已消耗额度</span>
            <span className="admin-stat-icon admin-stat-icon--orange">
              <Flame size={16} />
            </span>
          </div>
          <div className="admin-stat-value">{spentTotal.toLocaleString()}</div>
          <div className="admin-stat-bottom">
            <span className="admin-stat-hint">AI 深度投研问答调用</span>
          </div>
        </div>

        <div className="admin-stat-card">
          <div className="admin-stat-top">
            <span className="admin-stat-label">全站额度消耗率</span>
            <span className="admin-stat-icon admin-stat-icon--purple">
              <Percent size={16} />
            </span>
          </div>
          <div className="admin-stat-value">{burnRate}%</div>
          <div className="admin-stat-bottom">
            <span className="admin-stat-hint">消耗量 / 发放量</span>
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

        {/* Recent Credit Activity */}
        <section className="admin-card">
          <div className="admin-card-header">
            <div className="admin-card-title-group">
              <Clock size={16} className="admin-card-title-icon" />
              <h2>最新额度变动流水</h2>
            </div>
          </div>

          <div className="admin-ledger-mini-list">
            {recentLedger.map((row) => {
              const isPositive = row.delta > 0;
              const formattedTime = new Intl.DateTimeFormat("zh-CN", {
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              }).format(new Date(row.createdAt));

              return (
                <div key={row.id} className="admin-ledger-mini-item">
                  <div className="admin-ledger-mini-info">
                    <span className="admin-ledger-mini-user">
                      {row.user?.email || row.user?.name || "未知用户"}
                    </span>
                    <span className="admin-ledger-mini-reason">
                      {formatReason(row.reason)}
                    </span>
                  </div>
                  <div className="admin-ledger-mini-meta">
                    <span
                      className={`admin-ledger-mini-delta ${
                        isPositive
                          ? "admin-ledger-mini-delta--pos"
                          : "admin-ledger-mini-delta--neg"
                      }`}
                    >
                      {isPositive ? `+${row.delta}` : row.delta}
                    </span>
                    <time className="admin-ledger-mini-time">{formattedTime}</time>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

