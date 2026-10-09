"use client";

import { useEffect, useState, useCallback } from "react";
import { normalizeTicker } from "@/lib/ticker";

export interface WatchlistCompanyItem {
  id: string;
  entityId: string;
  ticker: string;
  companyName: string;
  url?: string | null;
  createdAt: string;
}

export function useWatchlist() {
  const [items, setItems] = useState<WatchlistCompanyItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch("/api/watchlist", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { items?: WatchlistCompanyItem[] };
        if (data.items) {
          setItems(data.items);
        }
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchItems();
  }, [fetchItems]);

  const isWatched = useCallback(
    (identifier: { entityId?: string | null; ticker?: string | null } | string | null | undefined): boolean => {
      if (!identifier) return false;
      if (typeof identifier === "string") {
        const normalized = normalizeTicker(identifier) || identifier.toUpperCase();
        return items.some((item) => {
          const itemNorm = normalizeTicker(item.ticker) || item.ticker.toUpperCase();
          return itemNorm === normalized || item.entityId === identifier;
        });
      }
      if (identifier.entityId) {
        if (items.some((item) => item.entityId === identifier.entityId)) return true;
      }
      if (identifier.ticker) {
        const normalized = normalizeTicker(identifier.ticker) || identifier.ticker.toUpperCase();
        return items.some((item) => {
          const itemNorm = normalizeTicker(item.ticker) || item.ticker.toUpperCase();
          return itemNorm === normalized;
        });
      }
      return false;
    },
    [items]
  );

  const toggleWatchlist = useCallback(
    async (params: { entityId?: string; ticker?: string; companyName?: string }): Promise<boolean> => {
      const normalizedTicker = params.ticker
        ? normalizeTicker(params.ticker) || params.ticker.toUpperCase()
        : undefined;

      const currentlyWatched = items.some((i) => {
        if (params.entityId && i.entityId === params.entityId) return true;
        if (normalizedTicker) {
          const iNorm = normalizeTicker(i.ticker) || i.ticker.toUpperCase();
          return iNorm === normalizedTicker;
        }
        return false;
      });

      if (currentlyWatched) {
        // Optimistic remove
        setItems((prev) =>
          prev.filter((i) => {
            if (params.entityId && i.entityId === params.entityId) return false;
            if (normalizedTicker) {
              const iNorm = normalizeTicker(i.ticker) || i.ticker.toUpperCase();
              return iNorm !== normalizedTicker;
            }
            return true;
          })
        );

        const deleteQuery = params.entityId
          ? `entityId=${encodeURIComponent(params.entityId)}`
          : `ticker=${encodeURIComponent(normalizedTicker!)}`;

        const res = await fetch(`/api/watchlist?${deleteQuery}`, {
          method: "DELETE",
        }).catch(() => null);

        if (!res?.ok) {
          void fetchItems();
          return true;
        }
        return false;
      } else {
        // Optimistic add
        const tempItem: WatchlistCompanyItem = {
          id: `temp-${Date.now()}`,
          entityId: params.entityId ?? `temp-entity-${Date.now()}`,
          ticker: normalizedTicker || "",
          companyName: params.companyName || normalizedTicker || "",
          createdAt: new Date().toISOString(),
        };
        setItems((prev) => [tempItem, ...prev]);

        const res = await fetch("/api/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entityId: params.entityId,
            ticker: normalizedTicker,
            companyName: params.companyName,
          }),
        }).catch(() => null);

        if (!res?.ok) {
          void fetchItems();
          return false;
        }

        const data = (await res.json()) as { item?: WatchlistCompanyItem };
        if (data.item) {
          setItems((prev) => prev.map((it) => (it.id === tempItem.id ? data.item! : it)));
        }
        return true;
      }
    },
    [items, fetchItems]
  );

  const removeWatchlist = useCallback(
    async (identifier: { entityId?: string; ticker?: string } | string) => {
      let query = "";
      if (typeof identifier === "string") {
        query = `ticker=${encodeURIComponent(identifier)}`;
      } else if (identifier.entityId) {
        query = `entityId=${encodeURIComponent(identifier.entityId)}`;
      } else if (identifier.ticker) {
        query = `ticker=${encodeURIComponent(identifier.ticker)}`;
      }

      setItems((prev) =>
        prev.filter((i) => {
          if (typeof identifier === "string") {
            const norm = normalizeTicker(identifier) || identifier.toUpperCase();
            return (normalizeTicker(i.ticker) || i.ticker.toUpperCase()) !== norm && i.entityId !== identifier;
          }
          if (identifier.entityId && i.entityId === identifier.entityId) return false;
          if (identifier.ticker) {
            const norm = normalizeTicker(identifier.ticker) || identifier.ticker.toUpperCase();
            return (normalizeTicker(i.ticker) || i.ticker.toUpperCase()) !== norm;
          }
          return true;
        })
      );

      if (query) {
        await fetch(`/api/watchlist?${query}`, { method: "DELETE" }).catch(() => null);
      }
    },
    []
  );

  return {
    items,
    loading,
    isWatched,
    toggleWatchlist,
    removeWatchlist,
    refresh: fetchItems,
  };
}
