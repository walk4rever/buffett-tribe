"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { PortfolioHolding } from "@/hooks/usePortfolio";
import { currencySymbol } from "@/lib/currency";

function formatMoney(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatShares(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

interface PortfolioHoldingRowProps {
  holding: PortfolioHolding;
  onUpdate: (patch: { shares?: number; costBasis?: number }) => Promise<string | null>;
  onDelete: () => void;
}

export function PortfolioHoldingRow({ holding, onUpdate, onDelete }: PortfolioHoldingRowProps) {
  const [editing, setEditing] = useState(false);
  const [sharesInput, setSharesInput] = useState(String(holding.shares));
  const [costInput, setCostInput] = useState(String(holding.costBasis));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const marketValue = holding.currentPrice != null ? holding.currentPrice * holding.shares : null;
  const costTotal = holding.costBasis * holding.shares;
  const gain = marketValue != null ? marketValue - costTotal : null;
  const gainPct = gain != null && costTotal > 0 ? (gain / costTotal) * 100 : null;
  const symbol = currencySymbol(holding.currency);

  function startEdit() {
    setSharesInput(String(holding.shares));
    setCostInput(String(holding.costBasis));
    setError(null);
    setEditing(true);
  }

  async function save() {
    const shares = Number(sharesInput);
    const costBasis = Number(costInput);
    if (!Number.isFinite(shares) || shares <= 0) {
      setError("份额需大于 0");
      return;
    }
    if (!Number.isFinite(costBasis) || costBasis < 0) {
      setError("成本需为非负数");
      return;
    }
    setSaving(true);
    const err = await onUpdate({ shares, costBasis });
    setSaving(false);
    if (err) {
      setError(err);
      return;
    }
    setEditing(false);
  }

  if (editing) {
    return (
      <li className="agent-portfolio-row agent-portfolio-row-editing">
        <div className="agent-portfolio-row-head">
          <span className="agent-portfolio-ticker">{holding.ticker}</span>
        </div>
        <div className="agent-portfolio-edit-fields">
          <label className="agent-portfolio-edit-field">
            <span className="agent-portfolio-edit-label">份额</span>
            <input
              className="agent-portfolio-input"
              type="number"
              min="0"
              step="any"
              value={sharesInput}
              onChange={(e) => setSharesInput(e.target.value)}
            />
          </label>
          <label className="agent-portfolio-edit-field">
            <span className="agent-portfolio-edit-label">每股成本</span>
            <input
              className="agent-portfolio-input"
              type="number"
              min="0"
              step="any"
              value={costInput}
              onChange={(e) => setCostInput(e.target.value)}
            />
          </label>
        </div>
        {error && <p className="agent-portfolio-error">{error}</p>}
        <div className="agent-portfolio-edit-actions">
          <button type="button" className="agent-portfolio-btn-danger" onClick={onDelete} title="删除持仓">
            <Trash2 size={15} strokeWidth={1.9} />
          </button>
          <div className="agent-portfolio-edit-actions-right">
            <button type="button" className="agent-portfolio-btn-ghost" onClick={() => setEditing(false)}>
              取消
            </button>
            <button type="button" className="agent-portfolio-btn" onClick={() => void save()} disabled={saving}>
              保存
            </button>
          </div>
        </div>
      </li>
    );
  }

  return (
    <li className="agent-portfolio-row">
      <button type="button" className="agent-portfolio-row-main" onClick={startEdit} title="点击编辑份额/成本">
        <div className="agent-portfolio-row-head">
          <span className="agent-portfolio-ticker">{holding.ticker}</span>
          {holding.companyName && <span className="agent-portfolio-name">{holding.companyName}</span>}
        </div>
        <div className="agent-portfolio-row-value">
          {marketValue != null ? (
            <>
              <span>
                {symbol}
                {formatMoney(marketValue)}
              </span>
              {gain != null && gainPct != null && (
                <span className={`agent-portfolio-gain ${gain >= 0 ? "is-up" : "is-down"}`}>
                  {gain >= 0 ? "+" : ""}
                  {symbol}
                  {formatMoney(gain)} ({gain >= 0 ? "+" : ""}
                  {gainPct.toFixed(1)}%)
                </span>
              )}
            </>
          ) : (
            <span className="agent-portfolio-no-price">暂无价格数据</span>
          )}
        </div>
        <div className="agent-portfolio-row-meta">
          {formatShares(holding.shares)}股/{symbol}
          {formatMoney(holding.costBasis)} -&gt;{" "}
          {holding.currentPrice != null ? `${symbol}${formatMoney(holding.currentPrice)}` : "暂无"}
          {holding.priceDate && <span className="agent-portfolio-row-date"> ({holding.priceDate})</span>}
        </div>
      </button>
    </li>
  );
}
