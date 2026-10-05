"use client";

import { useEffect, useState } from "react";

interface CompanyOption {
  id: string;
  name: string;
  canonicalName: string;
  ticker: string | null;
  market: string | null;
  code: string | null;
}

interface ArticleOption {
  id: string;
  slug: string;
  title: string;
  source: string | null;
  status: string;
  publishedAt: string | null;
  updatedAt: string;
  companies: CompanyOption[];
}

function formatDate(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function statusLabel(status: string) {
  if (status === "published") return null;
  if (status === "draft") return "草稿";
  if (status === "archived") return "已归档";
  return status;
}

function companySubLabel(company: CompanyOption) {
  return [company.ticker ?? company.code, company.market?.toUpperCase()]
    .filter(Boolean)
    .join(" · ");
}

export function AdminInsightCompanyLinks() {
  const [articles, setArticles] = useState<ArticleOption[]>([]);
  const [articlePage, setArticlePage] = useState(1);
  const [articleTotal, setArticleTotal] = useState(0);
  const [articleTotalPages, setArticleTotalPages] = useState(1);
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const [selectedArticle, setSelectedArticle] = useState<ArticleOption | null>(null);
  const [companyQuery, setCompanyQuery] = useState("");
  const [companyResults, setCompanyResults] = useState<CompanyOption[]>([]);
  const [selectedCompanies, setSelectedCompanies] = useState<CompanyOption[]>([]);
  const [loadingArticles, setLoadingArticles] = useState(true);
  const [loadingCompanies, setLoadingCompanies] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoadingArticles(true);
      try {
        const params = new URLSearchParams({
          type: "posts",
          page: String(articlePage),
        });
        const response = await fetch(`/api/admin/insight-company-links?${params}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("无法读取文章列表");
        const data = (await response.json()) as {
          posts: ArticleOption[];
          page: number;
          total: number;
          totalPages: number;
        };
        setArticles(data.posts);
        setArticleTotal(data.total);
        setArticleTotalPages(data.totalPages);
        setArticlePage(data.page);
      } catch (error) {
        if (!controller.signal.aborted) {
          setNotice({
            kind: "error",
            text: error instanceof Error ? error.message : "无法读取文章列表",
          });
        }
      } finally {
        if (!controller.signal.aborted) setLoadingArticles(false);
      }
    }, 180);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [articlePage]);

  useEffect(() => {
    const query = companyQuery.trim();
    if (!query) {
      setCompanyResults([]);
      setLoadingCompanies(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoadingCompanies(true);
      try {
        const params = new URLSearchParams({ type: "companies", q: query });
        const response = await fetch(`/api/admin/insight-company-links?${params}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("无法搜索公司");
        const data = (await response.json()) as { companies: CompanyOption[] };
        setCompanyResults(data.companies);
      } catch (error) {
        if (!controller.signal.aborted) {
          setNotice({
            kind: "error",
            text: error instanceof Error ? error.message : "无法搜索公司",
          });
        }
      } finally {
        if (!controller.signal.aborted) setLoadingCompanies(false);
      }
    }, 180);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [companyQuery]);

  function chooseArticle(article: ArticleOption) {
    setSelectedArticleId(article.id);
    setSelectedArticle(article);
    setSelectedCompanies(article.companies);
    setNotice(null);
    setCompanyQuery("");
    setCompanyResults([]);
  }

  function toggleCompany(company: CompanyOption) {
    setSelectedCompanies((current) =>
      current.some((item) => item.id === company.id)
        ? current.filter((item) => item.id !== company.id)
        : [...current, company],
    );
    setNotice(null);
  }

  async function saveAssociations() {
    if (!selectedArticle) return;
    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/insight-company-links", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postId: selectedArticle.id,
          companyIds: selectedCompanies.map((company) => company.id),
        }),
      });
      const data = (await response.json()) as {
        error?: string;
        companies?: CompanyOption[];
      };
      if (!response.ok) throw new Error(data.error ?? "保存失败");

      const savedCompanies = data.companies ?? [];
      setSelectedCompanies(savedCompanies);
      setSelectedArticle((current) =>
        current?.id === selectedArticle.id ? { ...current, companies: savedCompanies } : current,
      );

      // Refetch the article list to reflect the saved associations
      try {
        const params = new URLSearchParams({
          type: "posts",
          page: String(articlePage),
        });
        const listResponse = await fetch(`/api/admin/insight-company-links?${params}`);
        if (listResponse.ok) {
          const listData = (await listResponse.json()) as {
            posts: ArticleOption[];
            page: number;
            total: number;
            totalPages: number;
          };
          setArticles(listData.posts);
          setArticleTotal(listData.total);
          setArticleTotalPages(listData.totalPages);
        }
      } catch {
        // Fallback: update only in-memory articles if refetch fails
        setArticles((current) =>
          current.map((article) =>
            article.id === selectedArticle.id ? { ...article, companies: savedCompanies } : article,
          ),
        );
      }

      setNotice({ kind: "success", text: "关联已保存" });
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "保存失败",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-insight-links">
      <section className="admin-insight-links-panel" aria-label="文章列表">
        <div className="admin-insight-links-panel-head">
          <span>{loadingArticles ? "读取中" : `共 ${articleTotal} 篇`}</span>
        </div>
        <div className="admin-insight-links-list" aria-live="polite">
          {loadingArticles ? (
            <p className="admin-insight-links-empty">正在读取文章…</p>
          ) : articles.length === 0 ? (
            <p className="admin-insight-links-empty">没有找到文章</p>
          ) : (
            articles.map((article) => {
              const publicationDate = formatDate(article.publishedAt);
              const secondaryMeta = publicationDate ?? statusLabel(article.status);

              return (
                <button
                  key={article.id}
                  type="button"
                  className={`admin-insight-links-article${
                    selectedArticleId === article.id ? " admin-insight-links-article--active" : ""
                  }`}
                  onClick={() => chooseArticle(article)}
                >
                  <span className="admin-insight-links-article-title" title={article.title}>
                    {article.title}
                  </span>
                  <span className="admin-insight-links-article-meta">
                    {article.source && <span>{article.source}</span>}
                    {secondaryMeta && <span>{secondaryMeta}</span>}
                  </span>
                  {article.companies.length > 0 && (
                    <span
                      className="admin-insight-links-article-companies"
                      title={article.companies.map((company) => company.name).join("、")}
                    >
                      {article.companies.map((company) => company.name).join("、")}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
        {articleTotalPages > 1 && (
          <nav className="admin-insight-links-pagination" aria-label="文章分页">
            <span>
              第 {articlePage} / {articleTotalPages} 页
            </span>
            <div>
              <button
                type="button"
                disabled={articlePage <= 1 || loadingArticles}
                onClick={() => setArticlePage((page) => Math.max(1, page - 1))}
              >
                上一页
              </button>
              <button
                type="button"
                disabled={articlePage >= articleTotalPages || loadingArticles}
                onClick={() => setArticlePage((page) => Math.min(articleTotalPages, page + 1))}
              >
                下一页
              </button>
            </div>
          </nav>
        )}
      </section>

      <section className="admin-insight-links-panel" aria-label="公司关联设置">
        {selectedArticle ? (
          <>
            <div className="admin-insight-links-selected-head">
              <div>
                <p className="admin-insight-links-eyebrow">当前文章</p>
                <h2>{selectedArticle.title}</h2>
              </div>
              <a href={`/insights/${selectedArticle.slug}`} target="_blank" rel="noreferrer">
                打开文章 ↗
              </a>
            </div>

            <label className="admin-insight-links-label" htmlFor="admin-company-search">
              添加公司
            </label>
            <input
              id="admin-company-search"
              className="admin-insight-links-input"
              value={companyQuery}
              onChange={(event) => setCompanyQuery(event.target.value)}
              placeholder="输入公司名称、Ticker 或代码"
              maxLength={100}
            />
            {companyQuery.trim() && (
              <div className="admin-insight-links-results" aria-live="polite">
                {loadingCompanies ? (
                  <p className="admin-insight-links-empty">正在搜索公司…</p>
                ) : companyResults.length === 0 ? (
                  <p className="admin-insight-links-empty">没有找到公司</p>
                ) : (
                  companyResults.map((company) => {
                    const isSelected = selectedCompanies.some((item) => item.id === company.id);
                    return (
                      <button
                        key={company.id}
                        type="button"
                        className={`admin-insight-links-company-result${
                          isSelected ? " admin-insight-links-company-result--selected" : ""
                        }`}
                        onClick={() => toggleCompany(company)}
                      >
                        <span>
                          <strong>{company.name}</strong>
                          {company.canonicalName !== company.name && (
                            <small>{company.canonicalName}</small>
                          )}
                        </span>
                        <span className="admin-insight-links-company-sub">
                          {companySubLabel(company)}
                        </span>
                        <span aria-hidden="true">{isSelected ? "已选" : "添加"}</span>
                      </button>
                    );
                  })
                )}
              </div>
            )}

            <div className="admin-insight-links-current">
              <div className="admin-insight-links-current-head">
                <h3>已关联公司</h3>
                <span>{selectedCompanies.length}</span>
              </div>
              {selectedCompanies.length === 0 ? (
                <p className="admin-insight-links-empty">尚未关联公司</p>
              ) : (
                <ul className="admin-insight-links-chips">
                  {selectedCompanies.map((company) => (
                    <li key={company.id}>
                      <span>
                        {company.name}
                        {companySubLabel(company) ? ` · ${companySubLabel(company)}` : ""}
                      </span>
                      <button
                        type="button"
                        aria-label={`移除 ${company.name}`}
                        onClick={() => toggleCompany(company)}
                      >
                        移除
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="admin-insight-links-footer">
              {notice && (
                <p
                  className={`admin-insight-links-notice admin-insight-links-notice--${notice.kind}`}
                  role="status"
                >
                  {notice.text}
                </p>
              )}
              <button
                type="button"
                className="admin-insight-links-save"
                onClick={saveAssociations}
                disabled={saving}
              >
                {saving ? "保存中…" : "保存关联"}
              </button>
            </div>
          </>
        ) : (
          <div className="admin-insight-links-placeholder">
            <h2>选择一篇文章</h2>
            <p>关联的公司会显示在文章页和公司参考资料中。</p>
          </div>
        )}
      </section>
    </div>
  );
}
