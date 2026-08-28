"use client";

import { useState } from "react";
import { usePortfolio } from "@/hooks/usePortfolio";
import { CollapsibleSection } from "@/components/agent-workspace/CollapsibleSection";
import { PortfolioHoldingRow } from "@/components/agent-workspace/PortfolioHoldingRow";
import { PortfolioAddForm } from "@/components/agent-workspace/PortfolioAddForm";

function formatMoney(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function PortfolioPanel() {
  const { holdings, loading, addHolding, updateHolding, deleteHolding } = usePortfolio();
  const [adding, setAdding] = useState(false);

  const priced = holdings.filter((h) => h.currentPrice != null);
  const totalCost = holdings.reduce((sum, h) => sum + h.shares * h.costBasis, 0);
  const pricedValue = priced.reduce((sum, h) => sum + h.shares * (h.currentPrice ?? 0), 0);
  const pricedCost = priced.reduce((sum, h) => sum + h.shares * h.costBasis, 0);
  const gain = pricedValue - pricedCost;
  const gainPct = pricedCost > 0 ? (gain / pricedCost) * 100 : null;
  const unpricedCount = holdings.length - priced.length;

  return (
    <div className="agent-workspace-sections">
      <CollapsibleSection
        title="资产组合"
        defaultOpen
        action={
          <button type="button" className="agent-workspace-new-btn" onClick={() => setAdding(true)} title="添加持仓">
            + 添加
          </button>
        }
      >
        <div className="agent-portfolio">
          {holdings.length > 0 && (
            <div className="agent-portfolio-summary">
              <div className="agent-portfolio-summary-value">
                {priced.length > 0 ? `$${formatMoney(pricedValue)}` : "—"}
              </div>
              {priced.length > 0 && gainPct != null && (
                <div className={`agent-portfolio-gain ${gain >= 0 ? "is-up" : "is-down"}`}>
                  {gain >= 0 ? "+" : ""}
                  {formatMoney(gain)} ({gain >= 0 ? "+" : ""}
                  {gainPct.toFixed(1)}%)
                </div>
              )}
              <div className="agent-portfolio-summary-sub">
                总成本 ${formatMoney(totalCost)}
                {unpricedCount > 0 && ` · ${unpricedCount} 个持仓暂无价格数据`}
              </div>
            </div>
          )}

          {adding && <PortfolioAddForm onAdd={addHolding} onDone={() => setAdding(false)} />}

          {loading ? (
            <p className="agent-workspace-empty">加载中…</p>
          ) : holdings.length === 0 && !adding ? (
            <p className="agent-workspace-empty">
              还没有持仓，点击&ldquo;+ 添加&rdquo;录入你的股票、份额和成本。
            </p>
          ) : (
            <ul className="agent-portfolio-list">
              {holdings.map((h) => (
                <PortfolioHoldingRow
                  key={h.id}
                  holding={h}
                  onUpdate={(patch) => updateHolding(h.id, patch)}
                  onDelete={() => void deleteHolding(h.id)}
                />
              ))}
            </ul>
          )}
        </div>
      </CollapsibleSection>
    </div>
  );
}
