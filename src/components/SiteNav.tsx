"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { BtLogoMark } from "@/components/BtLogoMark";
import { BRAND_EN } from "@/lib/brand";

export function SiteNav() {
  const { data: session } = useSession();
  const pathname = usePathname();

  function isActive(href: string) {
    return pathname === href || pathname?.startsWith(`${href}/`);
  }

  return (
    <nav className="home-nav">
      <div className="home-nav-in">
        <Link href="/" className="home-nav-logo">
          <BtLogoMark />
          {BRAND_EN}
        </Link>
        <div className="home-nav-center" aria-label="部落成员与入口">
          <Link
            href="/master"
            className={`home-nav-link${isActive("/master") ? " home-nav-link--active" : ""}`}
            aria-current={isActive("/master") ? "page" : undefined}
          >
            大师
          </Link>
          <Link
            href="/company"
            className={`home-nav-link${isActive("/company") ? " home-nav-link--active" : ""}`}
            aria-current={isActive("/company") ? "page" : undefined}
          >
            公司
          </Link>
          <Link
            href="/insights"
            className={`home-nav-link${isActive("/insights") ? " home-nav-link--active" : ""}`}
            aria-current={isActive("/insights") ? "page" : undefined}
          >
            洞见
          </Link>
          <span className="home-nav-divider">|</span>
          <Link
            href="/agent"
            className={`home-nav-link${isActive("/agent") ? " home-nav-link--active" : ""}`}
            aria-current={isActive("/agent") ? "page" : undefined}
          >
            投研
          </Link>
          <Link
            href="/punch"
            className={`home-nav-link${isActive("/punch") ? " home-nav-link--active" : ""}`}
            aria-current={isActive("/punch") ? "page" : undefined}
          >
            打孔
          </Link>
          <span className="home-nav-link home-nav-link--disabled" aria-disabled="true">
            活动
          </span>
        </div>
        <div className="home-nav-right">
          {session ? (
            <Link href="/dashboard" className="home-nav-login">控制台</Link>
          ) : (
            <Link href="/login" className="home-nav-login">登录</Link>
          )}
        </div>
      </div>
    </nav>
  );
}
