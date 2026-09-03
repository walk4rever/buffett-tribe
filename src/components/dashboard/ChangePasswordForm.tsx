"use client";

import { useState } from "react";
import { ShieldCheck, ChevronDown, ChevronUp } from "lucide-react";

export function ChangePasswordForm() {
  const [open, setOpen] = useState(false);
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
      setError("网络连接超时");
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
    setTimeout(() => {
      setSuccess(false);
      setOpen(false);
    }, 2000);
  }

  return (
    <div className="dashboard-password-section">
      <div className="dashboard-password-row" onClick={() => setOpen(!open)}>
        <div className="dashboard-password-info">
          <span className="dashboard-password-title">账户密码</span>
          <span className="dashboard-password-desc">已设置密码保护，建议定期更换</span>
        </div>
        <button
          type="button"
          className="dashboard-inline-action-btn"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(!open);
          }}
        >
          <span>{open ? "收起" : "修改密码"}</span>
          {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
      </div>

      {open && (
        <form onSubmit={handleSubmit} className="dashboard-password-form">
          <div className="dashboard-input-field">
            <label className="dashboard-label">当前密码</label>
            <input
              type="password"
              placeholder="请输入当前使用的密码"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              className="dashboard-input"
            />
          </div>

          <div className="dashboard-input-field">
            <label className="dashboard-label">新密码</label>
            <input
              type="password"
              placeholder="至少 6 位字符"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={6}
              className="dashboard-input"
            />
          </div>

          <div className="dashboard-input-field">
            <label className="dashboard-label">确认新密码</label>
            <input
              type="password"
              placeholder="请再次输入新密码"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={6}
              className="dashboard-input"
            />
          </div>

          {error && <p className="dashboard-field-error">{error}</p>}
          {success && (
            <p className="dashboard-field-success">
              <ShieldCheck size={14} /> 密码更新成功！
            </p>
          )}

          <div className="dashboard-form-actions">
            <button
              type="submit"
              disabled={submitting}
              className="dashboard-btn-primary"
            >
              {submitting ? "保存中…" : "更新密码"}
            </button>
            <button
              type="button"
              className="dashboard-btn-ghost"
              onClick={() => {
                setOpen(false);
                setError(null);
                setSuccess(false);
              }}
            >
              取消
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
