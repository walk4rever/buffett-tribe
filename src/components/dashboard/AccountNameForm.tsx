"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Check, X } from "lucide-react";

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
        <span className="dashboard-account-val">{name || "未设置昵称"}</span>
        <button
          type="button"
          className="dashboard-inline-action-btn"
          onClick={() => setEditing(true)}
          title="修改昵称"
        >
          <Pencil size={12} />
          <span>修改</span>
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
        placeholder="输入您的昵称"
        autoFocus
        className="dashboard-input dashboard-input-inline"
      />
      <button
        type="submit"
        disabled={submitting}
        className="dashboard-btn-primary dashboard-btn-xs"
        title="保存"
      >
        <Check size={12} />
        <span>{submitting ? "保存中" : "保存"}</span>
      </button>
      <button
        type="button"
        className="dashboard-btn-ghost dashboard-btn-xs"
        onClick={() => {
          setEditing(false);
          setName(initialName);
          setError(null);
        }}
        title="取消"
      >
        <X size={12} />
        <span>取消</span>
      </button>
      {error && <span className="dashboard-field-error">{error}</span>}
    </form>
  );
}
