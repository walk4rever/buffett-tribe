"use client";

import { useEffect, useState } from "react";

export interface PortfolioHolding {
  id: string;
  ticker: string;
  companyName: string | null;
  currency: "USD" | "HKD" | "CNY";
  shares: number;
  costBasis: number;
  currentPrice: number | null;
  priceDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewHoldingInput {
  ticker: string;
  shares: number;
  costBasis: number;
}

// Owns the /agent page's portfolio panel: the user's manually entered holdings
// (ticker/shares/cost basis), with current price merged in server-side from the
// site's own StockPrice table (no live quote fetch — see PortfolioHolding model
// comment in schema.prisma).
export function usePortfolio() {
  const [holdings, setHoldings] = useState<PortfolioHolding[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/portfolio")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { holdings?: PortfolioHolding[] } | null) => {
        if (data?.holdings) setHoldings(data.holdings);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function addHolding(input: NewHoldingInput): Promise<string | null> {
    const res = await fetch("/api/portfolio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }).catch(() => null);
    if (!res) return "网络错误";
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      return body?.error ?? "添加失败";
    }
    const { holding } = (await res.json()) as { holding: PortfolioHolding };
    setHoldings((prev) => [...prev, holding]);
    return null;
  }

  async function updateHolding(
    id: string,
    patch: Partial<NewHoldingInput>,
  ): Promise<string | null> {
    const res = await fetch(`/api/portfolio/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => null);
    if (!res) return "网络错误";
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      return body?.error ?? "更新失败";
    }
    const { holding } = (await res.json()) as { holding: PortfolioHolding };
    setHoldings((prev) => prev.map((h) => (h.id === id ? holding : h)));
    return null;
  }

  async function deleteHolding(id: string) {
    setHoldings((prev) => prev.filter((h) => h.id !== id));
    await fetch(`/api/portfolio/${id}`, { method: "DELETE" }).catch(() => {});
  }

  return { holdings, loading, addHolding, updateHolding, deleteHolding };
}
