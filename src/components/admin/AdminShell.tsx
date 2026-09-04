"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  LayoutDashboard,
  Users,
  Megaphone,
  ArrowLeft,
  LogOut,
  User,
} from "lucide-react";
import { BtLogoMark } from "@/components/BtLogoMark";
import { BRAND_EN } from "@/lib/brand";

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
}

const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { href: "/admin", label: "数据总览", icon: LayoutDashboard },
  { href: "/admin/users", label: "用户与额度", icon: Users },
  { href: "/admin/announcements", label: "发布与邮件", icon: Megaphone },
];

function isActive(pathname: string | null, href: string) {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname?.startsWith(`${href}/`) === true;
}

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="admin-shell">
      <header className="admin-shell-header">
        <div className="admin-shell-header-in">
          <div className="admin-shell-brand-wrap">
            <Link href="/" className="admin-shell-brand">
              <BtLogoMark />
              <span className="admin-shell-brand-text">{BRAND_EN}</span>
            </Link>
            <span className="admin-shell-badge">管理后台</span>
            <span className="admin-shell-divider">/</span>
            <Link href="/" className="admin-shell-back-link">
              <ArrowLeft size={13} />
              <span>返回主站</span>
            </Link>
          </div>

          <div className="admin-shell-actions">
            <Link href="/dashboard" className="admin-shell-btn">
              <User size={14} />
              <span>个人控制台</span>
            </Link>
            <button
              onClick={() => signOut({ callbackUrl: "/" })}
              className="admin-shell-btn admin-shell-btn--ghost"
              title="退出登录"
            >
              <LogOut size={14} />
              <span>退出</span>
            </button>
          </div>
        </div>
      </header>

      <div className="admin-shell-body">
        <aside className="admin-shell-sidebar">
          <nav className="admin-shell-nav" aria-label="管理导航">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`admin-shell-nav-item${active ? " admin-shell-nav-item--active" : ""}`}
                >
                  <Icon size={16} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </aside>

        <main className="admin-shell-content">{children}</main>
      </div>
    </div>
  );
}
