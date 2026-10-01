import prisma from "@/lib/prisma";
import { currentPeriod, getBalance, GRANT_FREE, SPEND_AGENT } from "@/lib/credits";
import { AdminUsersTable, type UserRow } from "@/components/admin/AdminUsersTable";
import { CreditCard, Flame, Percent, TrendingUp } from "lucide-react";

export default async function AdminUsersPage() {
  const period = currentPeriod();

  const [users, granted, spent] = await Promise.all([
    prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.creditLedger.aggregate({
      _sum: { delta: true },
      where: { period, reason: GRANT_FREE },
    }),
    prisma.creditLedger.aggregate({
      _sum: { delta: true },
      where: { period, reason: SPEND_AGENT },
    }),
  ]);

  const balances = await Promise.all(users.map((u) => getBalance(u.id, period)));

  const initialUsers: UserRow[] = users.map((u, i) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    createdAt: u.createdAt.toISOString(),
    balance: balances[i],
  }));

  const grantedTotal = granted._sum.delta ?? 0;
  const spentTotal = Math.abs(spent._sum.delta ?? 0);
  const burnRate =
    grantedTotal > 0 ? ((spentTotal / grantedTotal) * 100).toFixed(1) : "0.0";
  const avgPerUser = users.length > 0 ? Math.round(spentTotal / users.length) : 0;

  return (
    <div className="admin-page-container">
      <div className="admin-page-heading">
        <div>
          <h1 className="admin-page-title">用户与额度管理</h1>
          <p className="admin-page-desc">
            查看全站注册用户、检索账号信息并调整 AI 投研可用额度 · 本月账期 {period}
          </p>
        </div>
      </div>

      {/* 4-Stat Grid: 详细运营指标 */}
      <div className="admin-stat-grid">
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

        <div className="admin-stat-card">
          <div className="admin-stat-top">
            <span className="admin-stat-label">人均消耗额度</span>
            <span className="admin-stat-icon admin-stat-icon--blue">
              <TrendingUp size={16} />
            </span>
          </div>
          <div className="admin-stat-value">{avgPerUser.toLocaleString()}</div>
          <div className="admin-stat-bottom">
            <span className="admin-stat-hint">总消耗 / 用户数</span>
          </div>
        </div>
      </div>

      <AdminUsersTable initialUsers={initialUsers} />
    </div>
  );
}

