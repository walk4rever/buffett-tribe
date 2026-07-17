"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export type CompanyDirectoryItem = {
  cik: string;
  nameZh: string;
  nameEn: string;
  tickers: string[];
  href: string | null;
};

export function CompanyDirectory({ companies }: { companies: CompanyDirectoryItem[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter(
      (c) =>
        c.nameZh.toLowerCase().includes(q) ||
        c.nameEn.toLowerCase().includes(q) ||
        c.tickers.some((t) => t.toLowerCase().includes(q))
    );
  }, [companies, query]);

  // The grid's column count is responsive (6 / 4 / 2, see globals.css breakpoints);
  // padding to a multiple of 12 (their LCM) keeps the last row full at every
  // breakpoint, so the per-cell border-top/border-left lines never break
  // partway through a short final row.
  const fillerCount = (12 - (filtered.length % 12)) % 12;

  return (
    <>
      <div className="companies-search">
        <input
          className="companies-search-input"
          type="search"
          placeholder="搜索公司名称或代码（如 AAPL）…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="搜索公司名称或代码"
        />
        <span className="companies-search-count">{filtered.length} 家</span>
      </div>
      {filtered.length === 0 ? (
        <div className="companies-empty">没有匹配“{query.trim()}”的公司</div>
      ) : (
        <div className="companies-grid">
          {filtered.map((c) =>
            c.href ? (
              <Link key={c.cik} href={c.href} className="companies-item">
                <span className="companies-item-zh">{c.nameZh}</span>
                <span className="companies-item-en">{c.nameEn}</span>
                {c.tickers.length > 0 ? (
                  <span className="companies-item-ticker">({c.tickers.join(" / ")})</span>
                ) : null}
              </Link>
            ) : (
              <span key={c.cik} className="companies-item companies-item--static">
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
      )}
    </>
  );
}
