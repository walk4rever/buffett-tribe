"use client";

import Link from "next/link";
import React, { useMemo, useState } from "react";

export type CompanyMarket = "us" | "hk" | "cn";

export type CompanyDirectoryItem = {
  key: string;
  nameZh: string;
  nameEn: string;
  tickers: string[];
  href: string | null;
  market: CompanyMarket;
  isComplete: boolean;
  onboardPhase?: number;
};

const MARKET_SECTIONS: Array<{ market: CompanyMarket; label: string }> = [
  { market: "cn", label: "A股" },
  { market: "hk", label: "港股" },
  { market: "us", label: "美股" },
];

export function CompanyGrid({ items }: { items: CompanyDirectoryItem[] }) {
  // Pad to a full row of 6 (the desktop column count) so a short section's
  // last row still reads as a complete grid rather than one lone box.
  const fillerCount = (6 - (items.length % 6)) % 6;

  return (
    <div className="companies-grid">
      {items.map((c) =>
        c.href ? (
          <Link key={c.key} href={c.href} className="companies-item">
            <span className="companies-item-zh">{c.nameZh}</span>
            <span className="companies-item-en">{c.nameEn}</span>
            {c.tickers.length > 0 ? (
              <span className="companies-item-ticker">({c.tickers.join(" / ")})</span>
            ) : null}
          </Link>
        ) : (
          <span
            key={c.key}
            className="companies-item companies-item--static"
            title="尚未完成深度建档 (Phase 0)"
          >
            <span className="companies-item-zh">{c.nameZh}</span>
            <span className="companies-item-en">{c.nameEn}</span>
            {c.tickers.length > 0 ? (
              <span className="companies-item-ticker">({c.tickers.join(" / ")})</span>
            ) : null}
          </span>
        )
      )}
      {Array.from({ length: fillerCount }, (_, i) => (
        <span key={`filler-${i}`} aria-hidden="true" className="companies-item companies-item--filler" />
      ))}
    </div>
  );
}

export function CompanyDirectory({
  recentlyUpdated = [],
  totalCount = 16435,
}: {
  recentlyUpdated?: CompanyDirectoryItem[];
  totalCount?: number;
}) {
  const [inputValue, setInputValue] = useState("");
  const [searchedQuery, setSearchedQuery] = useState("");
  const [results, setResults] = useState<CompanyDirectoryItem[]>([]);
  const [loading, setLoading] = useState(false);

  const performSearch = async (targetQuery: string) => {
    const trimmed = targetQuery.trim();
    if (!trimmed) {
      setSearchedQuery("");
      setResults([]);
      setLoading(false);
      return;
    }

    setSearchedQuery(trimmed);
    setLoading(true);
    try {
      const res = await fetch(`/api/company/search?q=${encodeURIComponent(trimmed)}`);
      if (!res.ok) throw new Error("Search failed");
      const data = await res.json();
      setResults(data.items || []);
    } catch (err) {
      console.error("Search fetch failed:", err);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    performSearch(inputValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      performSearch(inputValue);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);
    if (!val.trim() && searchedQuery) {
      setSearchedQuery("");
      setResults([]);
      setLoading(false);
    }
  };

  const sections = useMemo(() => {
    if (!searchedQuery) return [];
    const marketSections = MARKET_SECTIONS.map((section) => ({
      ...section,
      key: section.market as string,
      items: results.filter((c) => c.market === section.market),
    }));
    return marketSections.filter((section) => section.items.length > 0);
  }, [results, searchedQuery]);

  const countLabel = useMemo(() => {
    if (!searchedQuery) return `${totalCount.toLocaleString()} 家`;
    if (loading) return "搜索中…";
    return `找到 ${results.length} 家`;
  }, [searchedQuery, loading, results.length, totalCount]);

  return (
    <>
      <form onSubmit={handleSubmit} className="companies-search" role="search">
        <input
          className="companies-search-input"
          type="search"
          placeholder="搜索公司名称或代码（按回车搜索，如 600519、00700、AAPL）…"
          value={inputValue}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          aria-label="搜索公司名称或代码"
        />
        <span className="companies-search-count">{countLabel}</span>
      </form>

      {/* Default state: query is empty, show recently updated if available */}
      {!searchedQuery ? (
        recentlyUpdated.length > 0 ? (
          <section className="companies-section">
            <h2 className="companies-section-title">
              最近更新
              <span className="companies-section-count">({recentlyUpdated.length})</span>
            </h2>
            <CompanyGrid items={recentlyUpdated} />
          </section>
        ) : null
      ) : loading && results.length === 0 ? (
        <div className="companies-empty">正在检索全市场 {totalCount.toLocaleString()} 家公司…</div>
      ) : sections.length === 0 ? (
        <div className="companies-empty">没有匹配“{searchedQuery}”的公司</div>
      ) : (
        sections.map((section) => (
          <section key={section.key} className="companies-section">
            <h2 className="companies-section-title">
              {section.label}
              <span className="companies-section-count">({section.items.length})</span>
            </h2>
            <CompanyGrid items={section.items} />
          </section>
        ))
      )}
    </>
  );
}
