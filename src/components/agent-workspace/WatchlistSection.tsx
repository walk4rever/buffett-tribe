"use client";

import { Star, Trash2 } from "lucide-react";
import type { AgentTurnPreview } from "@/lib/agent-workspace-ui";
import { summarizeConversationPreview } from "@/lib/agent-workspace-ui";
import type { WatchlistCompanyItem } from "@/hooks/useWatchlist";

interface WatchlistSectionProps {
  items: WatchlistCompanyItem[];
  activeTicker?: string | null;
  onSelectCompany?: (company: WatchlistCompanyItem) => void;
  onRemoveCompany?: (ticker: string) => void;
  loading?: boolean;
  latestByContextKey?: Record<string, AgentTurnPreview>;
  previewsLoading?: boolean;
  previewsError?: boolean;
}

export function WatchlistSection({
  items,
  activeTicker,
  onSelectCompany,
  onRemoveCompany,
  loading = false,
  latestByContextKey = {},
  previewsLoading = false,
  previewsError = false,
}: WatchlistSectionProps) {
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
          暂无关注公司。在公司详情页点击星标关注后，最近对话会显示在这里。
        </p>
      </div>
    );
  }

  return (
    <ul className="agent-workspace-watchlist-list">
      {items.map((company: WatchlistCompanyItem) => {
        const isActive =
          activeTicker && activeTicker.toUpperCase() === company.ticker.toUpperCase();
        const preview = latestByContextKey[`company:${company.ticker}`];
        const previewText = preview
          ? summarizeConversationPreview(preview.text) || "发送了图片"
          : previewsLoading
            ? "正在读取最近对话…"
            : previewsError
              ? "暂时无法加载对话记录"
              : "还没有对话记录";
        const companyName = company.companyName || company.ticker;

        return (
          <li key={company.id} className="agent-workspace-watchlist-li">
            <button
              type="button"
              className={`agent-workspace-watchlist-item ${isActive ? "is-active" : ""}`}
              onClick={() => onSelectCompany?.(company)}
              title={companyName}
              aria-label={`打开 ${companyName} 的对话`}
            >
              <div className="agent-workspace-watchlist-head">
                <span className="agent-workspace-watchlist-name">{companyName}</span>
                <span className="agent-workspace-watchlist-ticker">{company.ticker}</span>
              </div>
              <div className="agent-workspace-watchlist-body">
                {preview?.role === "user" && (
                  <span className="agent-workspace-watchlist-preview-role">
                    你
                  </span>
                )}
                <span className="agent-workspace-watchlist-preview">
                  {previewText}
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
