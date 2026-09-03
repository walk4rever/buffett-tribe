import Link from "next/link";
import prisma from "@/lib/prisma";
import { currentPeriod, GRANT_FREE, SPEND_AGENT } from "@/lib/credits";

export default async function AdminOverviewPage() {
  const period = currentPeriod();

  const [userCount, granted, spent] = await Promise.all([
    prisma.user.count(),
    prisma.creditLedger.aggregate({
      _sum: { delta: true },
      where: { period, reason: GRANT_FREE },
    }),
    prisma.creditLedger.aggregate({
      _sum: { delta: true },
      where: { period, reason: SPEND_AGENT },
    }),
  ]);

  return (
    <div className="admin-stat-grid">
      <Link href="/admin/users" className="admin-stat-tile">
        <p className="admin-stat-label">用户数</p>
        <p className="admin-stat-value">{userCount}</p>
      </Link>
      <div className="admin-stat-tile">
        <p className="admin-stat-label">本月已发放额度</p>
        <p className="admin-stat-value">{granted._sum.delta ?? 0}</p>
      </div>
      <div className="admin-stat-tile">
        <p className="admin-stat-label">本月已消耗额度</p>
        <p className="admin-stat-value">{Math.abs(spent._sum.delta ?? 0)}</p>
      </div>
    </div>
  );
}
