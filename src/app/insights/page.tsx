import React from "react";
import Link from "next/link";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { SiteNav } from "@/components/SiteNav";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ source?: string }>;
}

export default async function InsightsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const selectedSource = sp.source?.trim() || null;

  const [posts, sources] = await Promise.all([
    getInsightPosts(selectedSource),
    getInsightSources(),
  ]);

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
                className={`insights-filter-pill insights-filter-pill--${getInsightSourcePillKey(source)}${selectedSource === source ? ` insights-filter-pill--active` : ""}`}
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
              const sourceLabel = post.source || "Buffett Tribe";

              return (
                <Link
                  key={post.slug}
                  href={`/insights/${post.slug}`}
                  className="insight-row"
                >
                  <span className="insight-row-num">
                    {formatDateTwoLine(post.publishedAt ?? post.updatedAt)}
                  </span>
                  <div className="insight-row-body">
                    <div className="insight-row-title-line">
                      <h2>{post.title}</h2>
                      <span className={`insight-row-source-pill ${getInsightSourcePillClass(sourceLabel)}`}>{sourceLabel}</span>
                    </div>
                    {post.description ? <p>{post.description}</p> : null}
                    {post.tags.length > 0 ? (
                      <div className="insight-row-tags">
                        {post.tags.slice(0, 4).map((postTag) => (
                          <span key={postTag}>{postTag}</span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </Link>
              );
            })
          )}
        </section>
      </main>
    </div>
  );
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

async function getInsightPosts(source: string | null) {
  try {
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
      take: 80,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2021") {
      console.warn("[insights] InsightPost table does not exist; run prisma migrate deploy.");
      return [];
    }
    throw err;
  }
}

function formatDateTwoLine(date: Date): React.ReactNode {
  const monthDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
  const year = date.getFullYear();
  return (
    <>
      <span className="insight-row-num-md">{monthDay}</span>
      <span className="insight-row-num-yr">{year}</span>
    </>
  );
}

function getInsightSourcePillKey(source: string): string {
  const normalized = source.trim().toLowerCase();
  if (normalized === "invest like the best") return "iltb";
  if (normalized === "acquired") return "acquired";
  if (normalized === "business breakdowns") return "breakdowns";
  if (normalized === "capital allocators") return "capitalallocators";
  return "default";
}

function getInsightSourcePillClass(source: string): string {
  return `insight-row-source-pill--${getInsightSourcePillKey(source)}`;
}
