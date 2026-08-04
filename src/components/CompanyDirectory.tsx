"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export type CompanyMarket = "us" | "hk" | "cn";

export type CompanyDirectoryItem = {
  key: string;
  nameZh: string;
  nameEn: string;
  tickers: string[];
  href: string | null;
  market: CompanyMarket;
  isComplete: boolean;
};

const MARKET_SECTIONS: Array<{ market: CompanyMarket; label: string }> = [
  { market: "cn", label: "A股" },
  { market: "hk", label: "港股" },
  { market: "us", label: "美股" },
];

function CompanyGrid({ items }: { items: CompanyDirectoryItem[] }) {
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
          <span key={c.key} className="companies-item companies-item--static">
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

  const sections = useMemo(() => {
    const complete = filtered.filter((c) => c.isComplete);
    const incomplete = filtered.filter((c) => !c.isComplete);
    const marketSections = MARKET_SECTIONS.map((section) => ({
      ...section,
      key: section.market as string,
      items: complete.filter((c) => c.market === section.market),
    }));
    const pendingSection = { market: "pending" as const, key: "pending", label: "待完善", items: incomplete };
    return [...marketSections, pendingSection].filter((section) => section.items.length > 0);
  }, [filtered]);

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
      {sections.length === 0 ? (
        <div className="companies-empty">没有匹配“{query.trim()}”的公司</div>
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
