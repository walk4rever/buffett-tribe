"use client";

import { Star, Sparkles, Trash2 } from "lucide-react";
import { useWatchlist, type WatchlistCompanyItem } from "@/hooks/useWatchlist";

interface WatchlistSectionProps {
  items?: WatchlistCompanyItem[];
  activeTicker?: string | null;
  onSelectCompany?: (company: WatchlistCompanyItem) => void;
  onRemoveCompany?: (ticker: string) => void;
  loading?: boolean;
}

export function WatchlistSection({
  items: propsItems,
  activeTicker,
  onSelectCompany,
  onRemoveCompany: propsOnRemove,
  loading: propsLoading,
}: WatchlistSectionProps = {}) {
  const hookWatchlist = useWatchlist();

  const items = propsItems ?? hookWatchlist.items;
  const loading = propsLoading ?? hookWatchlist.loading;
  const onRemoveCompany = propsOnRemove ?? hookWatchlist.removeWatchlist;
  if (loading && items.length === 0) {
    return (
      <div className="agent-workspace-empty-card">
        <p className="agent-workspace-empty-text">加载关注列表中…</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="agent-workspace-empty-card">
        <Star size={22} className="agent-workspace-empty-icon" />
        <p className="agent-workspace-empty-text">
          暂无关注公司。在公司详情页点击「收藏」星标即可加入关注，随时在此调起专属投研对话。
        </p>
      </div>
    );
  }

  return (
    <ul className="agent-workspace-watchlist-list">
      {items.map((company: WatchlistCompanyItem) => {
        const isActive =
          activeTicker && activeTicker.toUpperCase() === company.ticker.toUpperCase();

        return (
          <li key={company.id} className="agent-workspace-watchlist-li">
            <button
              type="button"
              className={`agent-workspace-watchlist-item ${isActive ? "is-active" : ""}`}
              onClick={() => onSelectCompany?.(company)}
              title={`打开 ${company.companyName || company.ticker} 专属投研对话`}
            >
              <div className="agent-workspace-watchlist-head">
                <span className="agent-workspace-watchlist-ticker">
                  {company.ticker}
                </span>
                <span className="agent-workspace-watchlist-hint">
                  <Sparkles size={11} className="agent-workspace-watchlist-sparkle" />
                  <span>AI解读</span>
                </span>
              </div>
              <div className="agent-workspace-watchlist-body">
                <span className="agent-workspace-watchlist-name">
                  {company.companyName || company.ticker}
                </span>
              </div>
            </button>

            {onRemoveCompany && (
              <button
                type="button"
                className="agent-workspace-watchlist-del-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveCompany(company.ticker);
                }}
                title={`取消关注 ${company.companyName || company.ticker}`}
                aria-label="取消关注"
              >
                <Trash2 size={13} />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
