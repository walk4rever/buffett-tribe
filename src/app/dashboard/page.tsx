import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import {
  Shield,
  Bot,
  Target,
  FileText,
  User as UserIcon,
  ShieldCheck,
  ArrowRight,
  Sparkles,
} from "lucide-react";
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

  const [user, chatTurnsCount, notesCount] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    }),
    prisma.chatTurn.count({
      where: { userId: session.user.id, role: "user" },
    }),
    prisma.note.count({
      where: { userId: session.user.id },
    }),
  ]);

  const displayName = user?.name || user?.email?.split("@")[0] || "部落成员";
  const avatarInitial = (user?.name?.[0] || user?.email?.[0] || "U").toUpperCase();
  const joinDate = user?.createdAt
    ? new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(
        new Date(user.createdAt)
      )
    : "近期加入";

  return (
    <div className="dashboard-page">
      <SiteNav />

      <main className="dashboard-shell">
        {/* User Hero Banner */}
        <section className="dashboard-hero">
          <div className="dashboard-hero-profile">
            <div className="dashboard-avatar" aria-hidden="true">
              {avatarInitial}
            </div>
            <div className="dashboard-hero-meta">
              <div className="dashboard-hero-name-row">
                <h1 className="dashboard-hero-title">你好，{displayName}</h1>
                {user?.role === "admin" ? (
                  <span className="dashboard-badge dashboard-badge--admin">管理员</span>
                ) : (
                  <span className="dashboard-badge dashboard-badge--member">部落成员</span>
                )}
              </div>
              <p className="dashboard-hero-sub">
                <span>{user?.email}</span>
                <span className="dashboard-hero-dot">·</span>
                <span>{joinDate}加入</span>
              </p>
            </div>
          </div>

          <div className="dashboard-hero-actions">
            {user?.role === "admin" && (
              <Link href="/admin" className="dashboard-head-btn dashboard-head-btn--admin">
                <Shield size={14} />
                <span>管理后台</span>
              </Link>
            )}
            <LogoutButton />
          </div>
        </section>

        {/* Bento Grid */}
        <div className="dashboard-grid">
          {/* Left Column: Core Assets & Activity */}
          <div className="dashboard-grid-main">
            <QuotaCard />

            {/* Quick Workspaces */}
            <section className="dashboard-card dashboard-workspaces-card">
              <div className="dashboard-card-header">
                <div className="dashboard-card-title-wrap">
                  <span className="dashboard-card-icon"><Sparkles size={16} /></span>
                  <h2>投研与决策工作台</h2>
                </div>
              </div>

              <div className="dashboard-workspace-list">
                <Link href="/agent" className="dashboard-workspace-item">
                  <div className="dashboard-workspace-icon dashboard-workspace-icon--blue">
                    <Bot size={20} />
                  </div>
                  <div className="dashboard-workspace-info">
                    <div className="dashboard-workspace-title-row">
                      <span className="dashboard-workspace-title">AI 深度投研 Agent</span>
                      {chatTurnsCount > 0 && (
                        <span className="dashboard-workspace-counter">{chatTurnsCount} 次对话</span>
                      )}
                    </div>
                    <p className="dashboard-workspace-desc">
                      多源智能检索公司财报、大师股东信与一手洞见
                    </p>
                  </div>
                  <ArrowRight size={16} className="dashboard-workspace-arrow" />
                </Link>

                <Link href="/punch" className="dashboard-workspace-item">
                  <div className="dashboard-workspace-icon dashboard-workspace-icon--purple">
                    <Target size={20} />
                  </div>
                  <div className="dashboard-workspace-info">
                    <div className="dashboard-workspace-title-row">
                      <span className="dashboard-workspace-title">20次打孔法则</span>
                    </div>
                    <p className="dashboard-workspace-desc">
                      追踪巴菲特、段永平、李录等投资大师顶级确信度决策
                    </p>
                  </div>
                  <ArrowRight size={16} className="dashboard-workspace-arrow" />
                </Link>

                <Link href="/agent" className="dashboard-workspace-item">
                  <div className="dashboard-workspace-icon dashboard-workspace-icon--green">
                    <FileText size={20} />
                  </div>
                  <div className="dashboard-workspace-info">
                    <div className="dashboard-workspace-title-row">
                      <span className="dashboard-workspace-title">我的投研笔记</span>
                      {notesCount > 0 && (
                        <span className="dashboard-workspace-counter">{notesCount} 篇笔记</span>
                      )}
                    </div>
                    <p className="dashboard-workspace-desc">
                      在标的研报与财报分析中随手沉淀私人投资手记
                    </p>
                  </div>
                  <ArrowRight size={16} className="dashboard-workspace-arrow" />
                </Link>
              </div>
            </section>
          </div>

          {/* Right Column: Account & Security */}
          <div className="dashboard-grid-side">
            <section className="dashboard-card dashboard-account-card">
              <div className="dashboard-card-header">
                <div className="dashboard-card-title-wrap">
                  <span className="dashboard-card-icon"><UserIcon size={16} /></span>
                  <h2>账号信息</h2>
                </div>
              </div>

              <div className="dashboard-account-list">
                <div className="dashboard-account-row">
                  <span className="dashboard-account-label">注册邮箱</span>
                  <div className="dashboard-account-val-wrap">
                    <span className="dashboard-account-val">{user?.email ?? "—"}</span>
                    <span className="dashboard-tag-verified">
                      <ShieldCheck size={12} /> 已验证
                    </span>
                  </div>
                </div>

                <div className="dashboard-account-row">
                  <span className="dashboard-account-label">显示昵称</span>
                  <div className="dashboard-account-val-wrap">
                    <AccountNameForm initialName={user?.name ?? ""} />
                  </div>
                </div>

                <div className="dashboard-account-row">
                  <span className="dashboard-account-label">账号 ID</span>
                  <div className="dashboard-account-val-wrap">
                    <code className="dashboard-account-uid" title={user?.id}>
                      {user?.id ? `${user.id.slice(0, 10)}…` : "—"}
                    </code>
                  </div>
                </div>
              </div>
            </section>

            <section className="dashboard-card dashboard-security-card">
              <div className="dashboard-card-header">
                <div className="dashboard-card-title-wrap">
                  <span className="dashboard-card-icon"><ShieldCheck size={16} /></span>
                  <h2>安全设置</h2>
                </div>
              </div>
              <ChangePasswordForm />
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}

