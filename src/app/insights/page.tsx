import React from "react";
import Link from "next/link";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { SiteNav } from "@/components/SiteNav";
import { BRAND_EN } from "@/lib/brand";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ source?: string; page?: string }>;
}

export default async function InsightsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const selectedSource = sp.source?.trim() || null;
  const page = Math.max(1, Number(sp.page) || 1);
  const perPage = 30;

  const [posts, sources, total] = await Promise.all([
    getInsightPosts(selectedSource, page, perPage),
    getInsightSources(),
    getInsightPostCount(selectedSource),
  ]);

  const totalPages = Math.ceil(total / perPage);
  const hasNextPage = page < totalPages;
  const hasPrevPage = page > 1;

  return (
    <div className="home-v2 insights-page">
      <SiteNav />
      <main className="insights-shell">
        <header className="insights-head">
          <h1>洞见</h1>
          <p className="insights-lede">关于公司、商业模式、技术演进与资本配置的深度观察。</p>
        </header>

        {sources.length > 0 && (
          <div className="insights-filter-bar" aria-label="按栏目筛选">
            <Link
              href="/insights"
              className={`insights-filter-pill${!selectedSource ? " insights-filter-pill--active" : ""}`}
            >
              全部
            </Link>
            {sources.map((source) => (
              <Link
                key={source}
                href={`/insights?source=${encodeURIComponent(source)}`}
                className={`insights-filter-pill${selectedSource === source ? " insights-filter-pill--active" : ""}`}
              >
                {source}
              </Link>
            ))}
          </div>
        )}

        <section className="insights-list" aria-label="文章列表">
          {posts.length === 0 ? (
            <div className="insights-empty">暂无文章</div>
          ) : (
            posts.map((post) => {
              const sourceLabel = post.source || BRAND_EN;
              const formattedDate = formatDate(post.publishedAt ?? post.updatedAt);

              return (
                <Link
                  key={post.slug}
                  href={`/insights/${post.slug}`}
                  className="insight-row"
                >
                  <div className="insight-row-head">
                    <span className="insight-row-source">{sourceLabel}</span>
                    <span className="insight-row-date">{formattedDate}</span>
                  </div>
                  <h2 className="insight-row-title">{post.title}</h2>
                  {post.description && (
                    <p className="insight-row-desc">{post.description}</p>
                  )}
                  {post.tags.length > 0 && (
                    <div className="insight-row-tags">
                      {post.tags.slice(0, 4).map((postTag) => (
                        <span key={postTag} className="insight-row-tag">
                          {postTag}
                        </span>
                      ))}
                    </div>
                  )}
                </Link>
              );
            })
          )}
        </section>

        {posts.length > 0 && (
          <>
            <p className="insights-list-end">
              共 {total} 篇 · 第 {page} / {totalPages} 页
            </p>

            {totalPages > 1 && (
              <div className="insights-pagination">
                {hasPrevPage ? (
                  <Link
                    href={buildPageUrl(selectedSource, page - 1)}
                    className="insights-pagination-btn"
                  >
                    ← 上一页
                  </Link>
                ) : (
                  <span className="insights-pagination-btn insights-pagination-btn--disabled">
                    ← 上一页
                  </span>
                )}

                <span className="insights-pagination-info">
                  {page} / {totalPages}
                </span>

                {hasNextPage ? (
                  <Link
                    href={buildPageUrl(selectedSource, page + 1)}
                    className="insights-pagination-btn"
                  >
                    下一页 →
                  </Link>
                ) : (
                  <span className="insights-pagination-btn insights-pagination-btn--disabled">
                    下一页 →
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function buildPageUrl(source: string | null, page: number): string {
  const params = new URLSearchParams();
  if (source) params.set("source", source);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/insights?${query}` : "/insights";
}

async function getInsightPostCount(source: string | null): Promise<number> {
  try {
    return await prisma.insightPost.count({
      where: {
        status: "published",
        ...(source ? { source } : {}),
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2021") {
      return 0;
    }
    throw err;
  }
}

async function getInsightSources(): Promise<string[]> {
  try {
    const rows = await prisma.insightPost.findMany({
      where: { status: "published", source: { not: null } },
      select: { source: true },
      distinct: ["source"],
      orderBy: { source: "asc" },
    });
    return rows.map((r) => r.source).filter((s): s is string => Boolean(s));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2021") {
      return [];
    }
    throw err;
  }
}

async function getInsightPosts(source: string | null, page: number, perPage: number) {
  try {
    const skip = (page - 1) * perPage;
    return await prisma.insightPost.findMany({
      where: {
        status: "published",
        ...(source ? { source } : {}),
      },
      select: {
        slug: true,
        title: true,
        description: true,
        source: true,
        author: true,
        publishedAt: true,
        tags: true,
        updatedAt: true,
      },
      orderBy: [{ publishedAt: "desc" }, { updatedAt: "desc" }],
      take: perPage,
      skip: skip,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2021") {
      console.warn("[insights] InsightPost table does not exist; run prisma migrate deploy.");
      return [];
    }
    throw err;
  }
}

function formatDate(date: Date): string {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const year = date.getFullYear();
  return `${year}年${month}月${day}日`;
}
