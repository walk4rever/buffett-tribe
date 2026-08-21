"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") ?? "/";

  const [tab, setTab] = useState<"login" | "register" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setInfo("");
    setLoading(true);
    await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setLoading(false);
    setInfo("如果该邮箱已注册，重置链接已发送，请查收邮件。");
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await signIn("credentials", {
      email: email.trim().toLowerCase(),
      password,
      redirect: false,
    });
    setLoading(false);
    if (res?.error) {
      setError("邮箱或密码错误");
    } else {
      router.push(callbackUrl);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "注册失败");
      setLoading(false);
      return;
    }
    // Auto-login after register
    await signIn("credentials", { email: email.trim().toLowerCase(), password, redirect: false });
    setLoading(false);
    router.push(callbackUrl);
  }

  return (
    <div className="login-wrap">
      <Link href="/" className="login-brand">Buffett Tribe</Link>
      <p className="login-sub">登录后可使用 AI 投研对话、打孔等更多功能</p>

      <div className="login-card">
        <div className="login-tabs">
          <button
            className={`login-tab${tab === "login" ? " login-tab--active" : ""}`}
            onClick={() => { setTab("login"); setError(""); setInfo(""); }}
          >
            登录
          </button>
          <button
            className={`login-tab${tab === "register" ? " login-tab--active" : ""}`}
            onClick={() => { setTab("register"); setError(""); setInfo(""); }}
          >
            注册
          </button>
        </div>

        <form onSubmit={tab === "login" ? handleLogin : tab === "register" ? handleRegister : handleForgot} className="login-form">
          {tab === "register" && (
            <input
              className="login-input"
              type="text"
              placeholder="昵称（可选）"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
          <input
            className="login-input"
            type="email"
            placeholder="邮箱地址"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
          {tab !== "forgot" && (
            <input
              className="login-input"
              type="password"
              placeholder={tab === "register" ? "设置密码（至少 6 位）" : "输入密码"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          )}

          {error && <p className="login-error">{error}</p>}
          {info && <p className="login-info">{info}</p>}

          <button className="login-submit" type="submit" disabled={loading}>
            {loading ? "请稍候…" : tab === "login" ? "登录" : tab === "register" ? "创建账号" : "发送重置邮件"}
          </button>

          {tab === "login" && (
            <button
              type="button"
              className="login-forgot"
              onClick={() => { setTab("forgot"); setError(""); setInfo(""); }}
            >
              忘记密码？
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
