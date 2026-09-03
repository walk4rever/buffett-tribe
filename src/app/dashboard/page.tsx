import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { SiteNav } from "@/components/SiteNav";
import { QuotaCard } from "@/components/dashboard/QuotaCard";
import { AccountNameForm } from "@/components/dashboard/AccountNameForm";
import { ChangePasswordForm } from "@/components/dashboard/ChangePasswordForm";
import { LogoutButton } from "@/components/dashboard/LogoutButton";
import { BRAND_ZH } from "@/lib/brand";

export const metadata = {
  title: `控制台 — ${BRAND_ZH}`,
};

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=%2Fdashboard");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { email: true, name: true, role: true },
  });

  return (
    <div className="dashboard-page">
      <SiteNav />
      <main className="dashboard-shell">
        <header className="dashboard-head">
          <h1>控制台</h1>
          <div className="dashboard-head-actions">
            {user?.role === "admin" && (
              <Link href="/admin" className="dashboard-admin-link">
                管理后台
              </Link>
            )}
            <LogoutButton />
          </div>
        </header>

        <div className="dashboard-cards">
          <QuotaCard />
          <section className="dashboard-card">
            <h2>账号</h2>
            <dl className="dashboard-account-info">
              <dt>邮箱</dt>
              <dd>{user?.email ?? "—"}</dd>
              <dt>昵称</dt>
              <dd>
                <AccountNameForm initialName={user?.name ?? ""} />
              </dd>
            </dl>
          </section>
          <section className="dashboard-card">
            <h2>修改密码</h2>
            <ChangePasswordForm />
          </section>
        </div>
      </main>
    </div>
  );
}
