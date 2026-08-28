"use client";

import { useState } from "react";
import { usePortfolio, type PortfolioHolding } from "@/hooks/usePortfolio";
import { CollapsibleSection } from "@/components/agent-workspace/CollapsibleSection";
import { PortfolioHoldingRow } from "@/components/agent-workspace/PortfolioHoldingRow";
import { PortfolioAddForm } from "@/components/agent-workspace/PortfolioAddForm";
import { currencyPrefix } from "@/lib/currency";

function formatMoney(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface CurrencyGroup {
  currency: PortfolioHolding["currency"];
  totalCost: number;
  pricedValue: number;
  pricedCost: number;
  unpricedCount: number;
}

// StockPrice.close is a raw quote in each security's own trading currency, never
// FX-converted — so holdings across markets can't be blended into one number.
// Summarize per currency instead of pretending "$" covers a HKD/CNY position too.
function summarizeByCurrency(holdings: PortfolioHolding[]): CurrencyGroup[] {
  const groups = new Map<string, CurrencyGroup>();
  for (const h of holdings) {
    const group = groups.get(h.currency) ?? {
      currency: h.currency,
      totalCost: 0,
      pricedValue: 0,
      pricedCost: 0,
      unpricedCount: 0,
    };
    group.totalCost += h.shares * h.costBasis;
    if (h.currentPrice != null) {
      group.pricedValue += h.shares * h.currentPrice;
      group.pricedCost += h.shares * h.costBasis;
    } else {
      group.unpricedCount += 1;
    }
    groups.set(h.currency, group);
  }
  return [...groups.values()];
}

export function PortfolioPanel() {
  const { holdings, loading, addHolding, updateHolding, deleteHolding } = usePortfolio();
  const [adding, setAdding] = useState(false);

  const currencyGroups = summarizeByCurrency(holdings);

  return (
    <CollapsibleSection
      title="资产组合"
      defaultOpen
      align="right"
      action={
        <button type="button" className="agent-workspace-new-btn" onClick={() => setAdding(true)} title="添加持仓">
          + 添加
        </button>
      }
    >
      <div className="agent-portfolio">
        {currencyGroups.length > 0 && (
          <div className="agent-portfolio-summary">
            {currencyGroups.map((group) => {
              const prefix = currencyPrefix(group.currency);
              const hasPriced = group.pricedValue > 0 || group.pricedCost > 0;
              const gain = group.pricedValue - group.pricedCost;
              const gainPct = group.pricedCost > 0 ? (gain / group.pricedCost) * 100 : null;
              return (
                <div key={group.currency} className="agent-portfolio-summary-group">
                  <div className="agent-portfolio-summary-head">
                    <span className="agent-portfolio-summary-value">
                      {hasPriced ? `${prefix}${formatMoney(group.pricedValue)}` : "—"}
                    </span>
                    <span className="agent-portfolio-currency-tag">{group.currency}</span>
                  </div>
                  {hasPriced && gainPct != null && (
                    <div className={`agent-portfolio-gain ${gain >= 0 ? "is-up" : "is-down"}`}>
                      {gain >= 0 ? "+" : ""}
                      {prefix}
                      {formatMoney(gain)} ({gain >= 0 ? "+" : ""}
                      {gainPct.toFixed(1)}%)
                    </div>
                  )}
                  <div className="agent-portfolio-summary-sub">
                    总成本 {prefix}
                    {formatMoney(group.totalCost)}
                    {group.unpricedCount > 0 && ` · ${group.unpricedCount} 个持仓暂无价格数据`}
                  </div>
                </div>
              );
            })}
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
  );
}
