"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import { useWatchlist } from "@/hooks/useWatchlist";

interface CompanyWatchlistButtonProps {
  ticker: string;
  companyName?: string;
  entityId?: string;
}

export function CompanyWatchlistButton({
  ticker,
  companyName,
  entityId,
}: CompanyWatchlistButtonProps) {
  const { data: session } = useSession();
  const router = useRouter();
  const { isWatched, toggleWatchlist } = useWatchlist();
  const [toggling, setToggling] = useState(false);

  const watched = isWatched({ entityId, ticker });

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!session) {
      const currentUrl = typeof window !== "undefined" ? window.location.pathname : "/company";
      router.push(`/login?callbackUrl=${encodeURIComponent(currentUrl)}`);
      return;
    }

    if (toggling) return;
    setToggling(true);
    try {
      await toggleWatchlist({ entityId, ticker, companyName });
    } finally {
      setToggling(false);
    }
  };

  return (
    <button
      type="button"
      className={`company-tabs-action-btn company-tabs-watchlist-btn ${
        watched ? "company-tabs-watchlist-btn--active" : ""
      }`}
      onClick={handleClick}
      disabled={toggling}
      title={
        !session
          ? "登录后收藏该公司"
          : watched
          ? "已收藏（点击取消）"
          : `收藏${companyName ? ` ${companyName}` : "该公司"}`
      }
      aria-label={watched ? "已收藏" : "收藏"}
    >
      <Star
        size={14}
        strokeWidth={watched ? 1.5 : 1.8}
        fill={watched ? "currentColor" : "none"}
        className="company-tabs-action-icon"
      />
    </button>
  );
}
