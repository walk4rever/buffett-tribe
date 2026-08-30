import { Suspense } from "react";
import { LoginForm } from "@/components/LoginForm";
import { SiteNav } from "@/components/SiteNav";
import { BRAND_EN } from "@/lib/brand";

export const metadata = { title: `登录 / 注册 — ${BRAND_EN}` };

export default function LoginPage() {
  return (
    <div className="login-page">
      <SiteNav />
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
