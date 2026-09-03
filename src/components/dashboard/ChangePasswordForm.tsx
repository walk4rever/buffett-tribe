"use client";

import { useState } from "react";

export function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致");
      return;
    }

    setSubmitting(true);
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    }).catch(() => null);
    setSubmitting(false);

    if (!res) {
      setError("网络错误");
      return;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? "修改失败");
      return;
    }

    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setSuccess(true);
  }

  return (
    <form onSubmit={handleSubmit} className="dashboard-password-form">
      <input
        type="password"
        placeholder="当前密码"
        value={currentPassword}
        onChange={(e) => setCurrentPassword(e.target.value)}
        required
        className="dashboard-input"
      />
      <input
        type="password"
        placeholder="新密码（至少 6 位）"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        required
        minLength={6}
        className="dashboard-input"
      />
      <input
        type="password"
        placeholder="确认新密码"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        required
        minLength={6}
        className="dashboard-input"
      />
      {error && <p className="dashboard-field-error">{error}</p>}
      {success && <p className="dashboard-field-success">密码已更新</p>}
      <button type="submit" disabled={submitting} className="dashboard-inline-btn">
        修改密码
      </button>
    </form>
  );
}
