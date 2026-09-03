"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";

const NAV_ITEMS: ReadonlyArray<{ href: string; label: string }> = [
  { href: "/admin", label: "总览" },
  { href: "/admin/users", label: "用户" },
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
        <div>
          <p className="admin-shell-kicker">Admin</p>
          <h1>管理后台</h1>
        </div>
        <div className="admin-shell-actions">
          <Link href="/dashboard" className="admin-shell-btn">
            控制台
          </Link>
          <button onClick={() => signOut()} className="admin-shell-btn">
            退出登录
          </button>
        </div>
      </header>

      <div className="admin-shell-body">
        <nav className="admin-shell-nav">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`admin-shell-nav-item${isActive(pathname, item.href) ? " admin-shell-nav-item--active" : ""}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="admin-shell-content">{children}</div>
      </div>
    </div>
  );
}
