"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AccountNameForm({ initialName }: { initialName: string }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/auth/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).catch(() => null);
    setSubmitting(false);

    if (!res) {
      setError("网络错误");
      return;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? "保存失败");
      return;
    }

    setEditing(false);
    router.refresh();
  }

  if (!editing) {
    return (
      <div className="dashboard-field-row">
        <span>{name || "未设置"}</span>
        <button type="button" className="dashboard-inline-btn" onClick={() => setEditing(true)}>
          编辑
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="dashboard-inline-form">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={60}
        className="dashboard-input"
      />
      <button type="submit" disabled={submitting} className="dashboard-inline-btn">
        保存
      </button>
      <button
        type="button"
        className="dashboard-inline-btn dashboard-inline-btn-muted"
        onClick={() => {
          setEditing(false);
          setName(initialName);
          setError(null);
        }}
      >
        取消
      </button>
      {error && <span className="dashboard-field-error">{error}</span>}
    </form>
  );
}
