"use client";

import { useState, useEffect, useTransition } from "react";
import Link from "next/link";
import { Search, ExternalLink, RefreshCw, AlertCircle } from "lucide-react";
import type { CompanyDirectoryItem } from "@/components/CompanyDirectory";

interface ExplorerItem extends CompanyDirectoryItem {
  updatedAt?: string;
  error?: string;
}

export function AdminUniverseExplorer() {
  const [query, setQuery] = useState("");
  const [market, setMarket] = useState("all");
  const [phase, setPhase] = useState("all");
  const [items, setItems] = useState<ExplorerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [, startTransition] = useTransition();

  const fetchResults = async (q: string, m: string, p: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (m !== "all") params.set("market", m);
      if (p !== "all") params.set("phase", p);
      params.set("limit", "40");

      const res = await fetch(`/api/company/search?${params.toString()}`);
      if (!res.ok) throw new Error("Search failed");
      const data = await res.json();
      setItems(data.items || []);
    } catch (err) {
      console.error("Failed to search universe:", err);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Initial fetch on mount or when filters change
    const timer = setTimeout(() => {
      startTransition(() => {
        fetchResults(query, market, phase);
      });
    }, 200);

    return () => clearTimeout(timer);
  }, [query, market, phase]);

  const marketColor: Record<string, string> = {
    us: "admin-badge--blue",
    hk: "admin-badge--purple",
    cn: "admin-badge--orange",
  };

  const phaseBadge = (phaseNum?: number) => {
    switch (phaseNum) {
      case 2:
        return <span className="admin-badge admin-badge--green">Phase 2 · 深度分析</span>;
      case 1:
        return <span className="admin-badge admin-badge--blue">Phase 1 · 基础建档</span>;
      case -1:
        return <span className="admin-badge admin-badge--red">异常 · 重试熔断</span>;
      default:
        return <span className="admin-badge admin-badge--gray">Phase 0 · 待建档</span>;
    }
  };

  return (
    <section className="admin-card">
      <div className="admin-card-header">
        <div className="admin-card-title-group">
          <h2>全市场标的检索与状态探查 (16,435 家)</h2>
        </div>
        <span className="admin-stat-hint">
          {loading ? "检索中…" : `展示匹配的前 ${items.length} 家`}
        </span>
      </div>

      {/* Filter Controls Bar */}
      <div className="admin-universe-filters">
        <div className="admin-universe-search">
          <Search size={15} className="admin-universe-search-icon" />
          <input
            type="search"
            placeholder="搜索代码或名称（如 600519、00700、AAPL、茅台）…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="admin-universe-input"
          />
        </div>

        <div className="admin-universe-select-group">
          <select
            value={market}
            onChange={(e) => setMarket(e.target.value)}
            className="admin-universe-select"
            aria-label="筛选交易市场"
          >
            <option value="all">全部市场</option>
            <option value="us">美股 (US)</option>
            <option value="hk">港股 (HK)</option>
            <option value="cn">A股 (CN)</option>
          </select>

          <select
            value={phase}
            onChange={(e) => setPhase(e.target.value)}
            className="admin-universe-select"
            aria-label="筛选建档阶段"
          >
            <option value="all">全部阶段</option>
            <option value="2">Phase 2 (深度分析)</option>
            <option value="1">Phase 1 (基础建档)</option>
            <option value="0">Phase 0 (待处理底座)</option>
            <option value="-1">Phase -1 (异常/死信池)</option>
          </select>

          <button
            type="button"
            onClick={() => fetchResults(query, market, phase)}
            className="admin-universe-refresh-btn"
            title="刷新数据"
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? "admin-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Table Results */}
      <div className="admin-table-container">
        <table className="admin-table">
          <thead>
            <tr>
              <th>市场</th>
              <th>证券代码</th>
              <th>公司名称</th>
              <th>当前建档阶段</th>
              <th>更新时间</th>
              <th className="admin-table-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={6} className="admin-table-empty">
                  {loading ? "正在检索全市场数据库…" : "没有找到匹配条件的公司"}
                </td>
              </tr>
            ) : (
              items.map((item) => {
                const formattedDate = item.updatedAt
                  ? new Intl.DateTimeFormat("zh-CN", {
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(new Date(item.updatedAt))
                  : "—";

                return (
                  <tr key={item.key}>
                    <td>
                      <span className={`admin-badge ${marketColor[item.market] || "admin-badge--gray"}`}>
                        {item.market.toUpperCase()}
                      </span>
                    </td>
                    <td>
                      <span className="admin-code-cell">
                        {item.tickers.length > 0 ? item.tickers.join(" / ") : item.key}
                      </span>
                    </td>
                    <td>
                      <div className="admin-company-cell">
                        <span className="admin-company-zh">{item.nameZh}</span>
                        {item.nameEn && item.nameEn !== item.nameZh && (
                          <span className="admin-company-en">{item.nameEn}</span>
                        )}
                        {item.error && (
                          <div className="admin-company-error" title={item.error}>
                            <AlertCircle size={12} />
                            <span>{item.error}</span>
                          </div>
                        )}
                      </div>
                    </td>
                    <td>{phaseBadge(item.onboardPhase)}</td>
                    <td className="admin-table-time">{formattedDate}</td>
                    <td className="admin-table-right">
                      {item.href ? (
                        <Link
                          href={item.href}
                          target="_blank"
                          rel="noreferrer"
                          className="admin-link-btn"
                        >
                          <span>查看详情</span>
                          <ExternalLink size={12} />
                        </Link>
                      ) : (
                        <span className="admin-disabled-text">未建档</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
