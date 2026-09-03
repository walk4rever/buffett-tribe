import prisma from "@/lib/prisma";
import { currentPeriod, getBalance } from "@/lib/credits";
import { AdjustCreditsForm } from "@/components/admin/AdjustCreditsForm";

export default async function AdminUsersPage() {
  const period = currentPeriod();
  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true, role: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  const balances = await Promise.all(users.map((u) => getBalance(u.id, period)));

  return (
    <table className="admin-users-table">
      <thead>
        <tr>
          <th>邮箱</th>
          <th>角色</th>
          <th>本月余额</th>
          <th>调整额度</th>
        </tr>
      </thead>
      <tbody>
        {users.map((user, i) => (
          <tr key={user.id}>
            <td>{user.email ?? user.name ?? user.id}</td>
            <td>{user.role === "admin" ? "admin" : "user"}</td>
            <td>{balances[i]}</td>
            <td>
              <AdjustCreditsForm userId={user.id} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
