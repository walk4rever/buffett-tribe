"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import { BtLogoMark } from "@/components/BtLogoMark";

export function SiteNav() {
  const { data: session } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!userMenuRef.current) return;
      if (!userMenuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <nav className="home-nav">
      <div className="home-nav-in">
        <Link href="/" className="home-nav-logo">
          <BtLogoMark />
          Buffett Tribe
        </Link>
        <div className="home-nav-center" aria-label="部落成员与入口">
          <Link href="/master" className="home-nav-link">
            大师
          </Link>
          <Link href="/company" className="home-nav-link">
            公司
          </Link>
          <Link href="/insights" className="home-nav-link">
            洞见
          </Link>
          <span className="home-nav-divider">|</span>
          <Link href="/agent" className="home-nav-link">
            对话
          </Link>
          <Link href="/punch" className="home-nav-link">
            打孔
          </Link>
          <span className="home-nav-link home-nav-link--disabled" aria-disabled="true">
            活动
          </span>
        </div>
        <div className="home-nav-right">
          {session ? (
            <div className="user-menu" ref={userMenuRef}>
              <button
                type="button"
                className="user-menu-trigger home-nav-link"
                onClick={() => setMenuOpen((v) => !v)}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
              >
                {session.user?.email || session.user?.name || "已登录"}
              </button>
              {menuOpen ? (
                <div className="user-menu-dropdown" role="menu">
                  <button onClick={() => signOut()} className="user-menu-item user-menu-logout" role="menuitem">
                    退出登录
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <Link href="/login" className="home-nav-login">登录</Link>
          )}
        </div>
      </div>
    </nav>
  );
}
