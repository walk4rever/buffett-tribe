"use client";

import { useState } from "react";
import type { NewHoldingInput } from "@/hooks/usePortfolio";

interface PortfolioAddFormProps {
  onAdd: (input: NewHoldingInput) => Promise<string | null>;
  onDone: () => void;
}

export function PortfolioAddForm({ onAdd, onDone }: PortfolioAddFormProps) {
  const [ticker, setTicker] = useState("");
  const [shares, setShares] = useState("");
  const [costBasis, setCostBasis] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const sharesNum = Number(shares);
    const costNum = Number(costBasis);
    if (!ticker.trim()) {
      setError("请输入股票代码");
      return;
    }
    if (!Number.isFinite(sharesNum) || sharesNum <= 0) {
      setError("份额需大于 0");
      return;
    }
    if (!Number.isFinite(costNum) || costNum < 0) {
      setError("成本需为非负数");
      return;
    }
    setSaving(true);
    setError(null);
    const err = await onAdd({ ticker: ticker.trim(), shares: sharesNum, costBasis: costNum });
    setSaving(false);
    if (err) {
      setError(err);
      return;
    }
    onDone();
  }

  return (
    <form className="agent-portfolio-add-form" onSubmit={(e) => void handleSubmit(e)}>
      <input
        className="agent-portfolio-input"
        placeholder="代码，如 GOOG"
        value={ticker}
        onChange={(e) => setTicker(e.target.value)}
        autoFocus
      />
      <input
        className="agent-portfolio-input"
        type="number"
        min="0"
        step="any"
        placeholder="份额"
        value={shares}
        onChange={(e) => setShares(e.target.value)}
      />
      <input
        className="agent-portfolio-input"
        type="number"
        min="0"
        step="any"
        placeholder="每股成本"
        value={costBasis}
        onChange={(e) => setCostBasis(e.target.value)}
      />
      {error && <p className="agent-portfolio-error">{error}</p>}
      <div className="agent-portfolio-edit-actions">
        <button type="submit" className="agent-portfolio-btn" disabled={saving}>
          添加
        </button>
        <button type="button" className="agent-portfolio-btn-ghost" onClick={onDone}>
          取消
        </button>
      </div>
    </form>
  );
}
