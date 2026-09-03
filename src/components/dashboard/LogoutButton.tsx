"use client";

import { signOut } from "next-auth/react";

export function LogoutButton() {
  return (
    <button onClick={() => signOut({ callbackUrl: "/" })} className="dashboard-admin-link dashboard-logout-btn">
      退出登录
    </button>
  );
}
