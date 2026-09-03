"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AdjustCreditsForm({ userId }: { userId: string }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(amount);
    if (!Number.isFinite(value) || value === 0) {
      setError("请输入非零整数");
      return;
    }

    setSubmitting(true);
    setError(null);
    const res = await fetch(`/api/admin/users/${userId}/adjust-credits`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: Math.trunc(value) }),
    }).catch(() => null);
    setSubmitting(false);

    if (!res) {
      setError("网络错误");
      return;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? "调整失败");
      return;
    }

    setAmount("");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="admin-adjust-credits-form">
      <input
        type="number"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="±额度"
        className="admin-adjust-credits-input"
      />
      <button type="submit" disabled={submitting} className="admin-adjust-credits-btn">
        调整
      </button>
      {error && <span className="admin-adjust-credits-error">{error}</span>}
    </form>
  );
}
