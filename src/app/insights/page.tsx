import Link from "next/link";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { SiteNav } from "@/components/SiteNav";
import { estimateReadingMinutes } from "@/lib/insights";

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
            posts.map((post, index) => {
              const articleNumber = posts.length - index;

              return (
                <Link
                  key={post.slug}
                  href={`/insights/${post.slug}`}
                  className="insight-row"
                >
                  <span className="insight-row-num">第{articleNumber}篇</span>
                  <div className="insight-row-body">
                    <div className="insight-row-meta">
                      <span>{post.source || "Buffett Tribe"}</span>
                      <span>{post.publishedAt ? formatDate(post.publishedAt) : formatDate(post.updatedAt)}</span>
                      <span>{estimateReadingMinutes(post.contentRaw)} min</span>
                    </div>
                    <h2>{post.title}</h2>
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
        contentRaw: true,
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
