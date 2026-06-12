"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export type CompanyDirectoryItem = {
  cik: string;
  nameZh: string;
  nameEn: string;
  href: string | null;
};

export function CompanyDirectory({ companies }: { companies: CompanyDirectoryItem[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter(
      (c) => c.nameZh.toLowerCase().includes(q) || c.nameEn.toLowerCase().includes(q)
    );
  }, [companies, query]);

  return (
    <>
      <div className="companies-search">
        <input
          className="companies-search-input"
          type="search"
          placeholder="搜索公司名称…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="搜索公司"
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
              </Link>
            ) : (
              <span key={c.cik} className="companies-item companies-item--static">
                <span className="companies-item-zh">{c.nameZh}</span>
                <span className="companies-item-en">{c.nameEn}</span>
              </span>
            )
          )}
        </div>
      )}
    </>
  );
}
