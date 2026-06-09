import Link from "next/link";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { SiteNav } from "@/components/SiteNav";
import { estimateReadingMinutes } from "@/lib/insights";

export const dynamic = "force-dynamic";

export default async function InsightsPage() {
  const posts = await getInsightPosts();

  const latestUpdatedAt = posts[0]?.updatedAt ?? null;

  return (
    <div className="home-v2 insights-page">
      <SiteNav />
      <main className="insights-shell">
        <header className="insights-head">
          <div>
            <p className="insights-kicker">Research Notes</p>
            <h1>洞见</h1>
            <p className="insights-lede">从访谈、股东信和投资史里提炼可复用的判断框架。</p>
          </div>
          <div className="insights-stat">
            <span>{posts.length}</span>
            <em>篇文章{latestUpdatedAt ? ` · 更新于 ${formatDate(latestUpdatedAt)}` : ""}</em>
          </div>
        </header>

        <div className="insights-layout">
          <section className="insights-list" aria-label="文章列表">
            {posts.length === 0 ? (
              <div className="insights-empty">暂无匹配文章</div>
            ) : (
              posts.map((post, index) => (
                <Link
                  key={post.slug}
                  href={`/insights/${post.slug}`}
                  className={`insight-row${index === 0 ? " insight-row--featured" : ""}`}
                >
                  <div className="insight-row-main">
                    <div className="insight-row-meta">
                      <span>{post.source || "Buffett Tribe"}</span>
                      <span>{post.publishedAt ? formatDate(post.publishedAt) : formatDate(post.updatedAt)}</span>
                      <span>{estimateReadingMinutes(post.contentRaw)} 分钟</span>
                    </div>
                    <h2>{post.title}</h2>
                    {post.description ? <p>{post.description}</p> : null}
                    <div className="insight-row-tags">
                      {post.tags.slice(0, 5).map((postTag) => (
                        <span key={postTag}>{postTag}</span>
                      ))}
                    </div>
                  </div>
                  <div className="insight-row-side">
                    <span>{post.author || "编辑部"}</span>
                    <em>阅读</em>
                  </div>
                </Link>
              ))
            )}
          </section>
        </div>
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
