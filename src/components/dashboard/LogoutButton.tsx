"use client";

import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";

export function LogoutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/" })}
      className="dashboard-head-btn dashboard-logout-btn"
      title="退出登录"
    >
      <LogOut size={14} />
      <span>退出</span>
    </button>
  );
}

