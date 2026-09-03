import prisma from "@/lib/prisma";
import { currentPeriod, getBalance } from "@/lib/credits";
import { AdminUsersTable, type UserRow } from "@/components/admin/AdminUsersTable";

export default async function AdminUsersPage() {
  const period = currentPeriod();
  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true, role: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  const balances = await Promise.all(users.map((u) => getBalance(u.id, period)));

  const initialUsers: UserRow[] = users.map((u, i) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    createdAt: u.createdAt.toISOString(),
    balance: balances[i],
  }));

  return (
    <div className="admin-page-container">
      <div className="admin-page-heading">
        <div>
          <h1 className="admin-page-title">用户与额度管理</h1>
          <p className="admin-page-desc">
            查看全站注册用户、检索账号信息并调整 AI 投研可用额度
          </p>
        </div>
      </div>

      <AdminUsersTable initialUsers={initialUsers} />
    </div>
  );
}

