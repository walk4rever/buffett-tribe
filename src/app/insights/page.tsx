import React from "react";
import Link from "next/link";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { SiteNav } from "@/components/SiteNav";

export const dynamic = "force-dynamic";

export default async function InsightsPage() {
  const posts = await getInsightPosts();

  return (
    <div className="home-v2 insights-page">
      <SiteNav />
      <main className="insights-shell">
        <header className="insights-head">
          <h1>洞见</h1>
          <p className="insights-lede">关于公司、商业模式、技术演进与资本配置的深度观察。</p>
        </header>

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

async function getInsightPosts() {
  try {
    return await prisma.insightPost.findMany({
      where: {
        status: "published",
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

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
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

function getInsightSourcePillClass(source: string): string {
  const normalized = source.trim().toLowerCase();
  if (normalized === "invest like the best") return "insight-row-source-pill--iltb";
  if (normalized === "acquired") return "insight-row-source-pill--acquired";
  if (normalized === "business breakdowns") return "insight-row-source-pill--breakdowns";
  if (normalized === "founders") return "insight-row-source-pill--founders";
  return "insight-row-source-pill--default";
}
