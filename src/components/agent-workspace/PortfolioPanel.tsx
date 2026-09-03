"use client";

import { useState } from "react";
import { usePortfolio, type PortfolioHolding } from "@/hooks/usePortfolio";
import { CollapsibleSection } from "@/components/agent-workspace/CollapsibleSection";
import { PortfolioHoldingRow } from "@/components/agent-workspace/PortfolioHoldingRow";
import { PortfolioAddForm } from "@/components/agent-workspace/PortfolioAddForm";
import { currencySymbol } from "@/lib/currency";

function formatMoney(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface CurrencyGroup {
  currency: PortfolioHolding["currency"];
  marketLabel: string;
  holdings: PortfolioHolding[];
  totalCost: number;
  pricedValue: number;
  pricedCost: number;
  unpricedCount: number;
}

// US holdings first, then A股, then 港股 — a fixed display order rather than
// insertion order, so the panel doesn't reshuffle sections as holdings are added.
const MARKET_LABEL: Record<PortfolioHolding["currency"], string> = {
  USD: "US",
  CNY: "CN",
  HKD: "HK",
};
const MARKET_ORDER: PortfolioHolding["currency"][] = ["USD", "CNY", "HKD"];

// StockPrice.close is a raw quote in each security's own trading currency, never
// FX-converted — so holdings across markets can't be blended into one number.
// Group by currency/market instead of pretending "$" covers a HKD/CNY position too.
function groupByMarket(holdings: PortfolioHolding[]): CurrencyGroup[] {
  return MARKET_ORDER.map((currency) => {
    const marketHoldings = holdings.filter((h) => h.currency === currency);
    const group: CurrencyGroup = {
      currency,
      marketLabel: MARKET_LABEL[currency],
      holdings: marketHoldings,
      totalCost: 0,
      pricedValue: 0,
      pricedCost: 0,
      unpricedCount: 0,
    };
    for (const h of marketHoldings) {
      group.totalCost += h.shares * h.costBasis;
      if (h.currentPrice != null) {
        group.pricedValue += h.shares * h.currentPrice;
        group.pricedCost += h.shares * h.costBasis;
      } else {
        group.unpricedCount += 1;
      }
    }
    return group;
  }).filter((group) => group.holdings.length > 0);
}

export function PortfolioPanel() {
  const { holdings, loading, addHolding, updateHolding, deleteHolding } = usePortfolio();
  const [adding, setAdding] = useState(false);

  const marketGroups = groupByMarket(holdings);

  return (
    <CollapsibleSection
      title="资产组合"
      defaultOpen
      align="right"
      action={
        <button
          type="button"
          className="agent-workspace-new-btn"
          onClick={() => setAdding((prev) => !prev)}
          title={adding ? "取消" : "添加持仓"}
        >
          {adding ? "取消" : "+ 添加"}
        </button>
      }
    >
      <div className="agent-portfolio">
        {adding && <PortfolioAddForm onAdd={addHolding} onDone={() => setAdding(false)} />}

      {loading ? (
        <p className="agent-workspace-empty">加载中…</p>
      ) : holdings.length === 0 && !adding ? (
        <div className="agent-workspace-empty-card">
          <p className="agent-workspace-empty-text">
            还没有录入持仓，点击上方「+ 添加持仓」录入你的标的、份额与成本。
          </p>
        </div>
      ) : (
        marketGroups.map((group) => {
          const symbol = currencySymbol(group.currency);
          const hasPriced = group.pricedValue > 0 || group.pricedCost > 0;
          const gain = group.pricedValue - group.pricedCost;
          const gainPct = group.pricedCost > 0 ? (gain / group.pricedCost) * 100 : null;
          return (
            <div key={group.currency} className="agent-portfolio-market-group">
              <div className="agent-portfolio-summary">
                <div className="agent-portfolio-summary-head">
                  <span className="agent-portfolio-market-tag">{group.marketLabel}</span>
                  <span className="agent-portfolio-summary-value">
                    {hasPriced ? `${symbol}${formatMoney(group.pricedValue)}` : "—"}
                  </span>
                </div>
                {hasPriced && gainPct != null && (
                  <div className={`agent-portfolio-gain ${gain >= 0 ? "is-up" : "is-down"}`}>
                    {gain >= 0 ? "+" : ""}
                    {symbol}
                    {formatMoney(gain)} ({gain >= 0 ? "+" : ""}
                    {gainPct.toFixed(1)}%)
                  </div>
                )}
                <div className="agent-portfolio-summary-sub">
                  总成本 {symbol}
                  {formatMoney(group.totalCost)}
                  {group.unpricedCount > 0 && ` · ${group.unpricedCount} 个持仓暂无价格数据`}
                </div>
              </div>
              <ul className="agent-portfolio-list">
                {group.holdings.map((h) => (
                  <PortfolioHoldingRow
                    key={h.id}
                    holding={h}
                    onUpdate={(patch) => updateHolding(h.id, patch)}
                    onDelete={() => void deleteHolding(h.id)}
                  />
                ))}
              </ul>
            </div>
          );
        })
      )}
      </div>
    </CollapsibleSection>
  );
}
