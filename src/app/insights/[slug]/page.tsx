import { notFound } from "next/navigation";
import Link from "next/link";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { SiteNav } from "@/components/SiteNav";
import { InsightReader } from "@/components/InsightReader";
import { InsightOverviewShareButton } from "@/components/InsightOverviewShareButton";
import { InsightChatShell } from "@/components/InsightChatShell";
import { extractInsightOverviewShareContent, isInsightFormat } from "@/lib/insights";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function InsightDetailPage({ params }: Props) {
  const { slug } = await params;
  const post = await getInsightPost(slug);

  if (!post || post.status !== "published") notFound();

  const format = isInsightFormat(post.format) ? post.format : "markdown";
  const dateLabel = post.publishedAt ? formatDate(post.publishedAt) : formatDate(post.updatedAt);
  const overview = extractInsightOverviewShareContent(post.contentRaw, post.description ?? undefined);
  const [relatedEntities, adjacent] = await Promise.all([
    post.entityIds.length > 0 ? getEntitiesByIds(post.entityIds) : Promise.resolve([]),
    getAdjacentPosts(post.slug),
  ]);

  return (
    <div className="home-v2 insight-detail-page">
      <SiteNav />
      <main className="insight-detail-shell">
        <InsightChatShell slug={post.slug} title={post.title}>
          <header className="insight-detail-head">
            <h1>{post.title}</h1>
            <div className="insight-detail-meta">
              <span>{post.sourceUrl ? <a href={post.sourceUrl} target="_blank" rel="noopener noreferrer">{post.source || "来源"}</a> : post.source || "Buffett Tribe"}</span>
              {post.author && post.author !== post.source ? <span>{post.author}</span> : null}
              <span>{dateLabel}</span>
            </div>
            {post.description ? <p className="insight-detail-desc">{post.description}</p> : null}
            {post.tags.length > 0 ? (
              <div className="insight-row-tags insight-detail-tags">
                {post.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            ) : null}
          </header>

          <InsightReader
            title={post.title}
            content={post.contentRaw}
            format={format}
            actions={(
              <InsightOverviewShareButton
                title={post.title}
                source={post.source}
                dateLabel={dateLabel}
                overviewTitle={overview.title}
                overviewMarkdown={overview.markdown}
              />
            )}
          />

          {relatedEntities.length > 0 && (
            <aside className="insight-related-entities">
              <h2 className="insight-related-entities-title">相关公司</h2>
              <div className="insight-related-entities-list">
                {relatedEntities.map((entity) => {
                  const meta = (entity.metadata ?? {}) as { nameZh?: string };
                  const nameZh = meta.nameZh ?? entity.canonicalName;
                  const href = entity.cik ? `/company/cik-${entity.cik}` : null;
                  const ticker = entity.ticker ?? entity.code;
                  return href ? (
                    <a key={entity.id} href={href} className="insight-entity-chip">
                      {ticker && <span className="insight-entity-ticker">{ticker}</span>}
                      <span>{nameZh}</span>
                    </a>
                  ) : (
                    <span key={entity.id} className="insight-entity-chip">
                      {ticker && <span className="insight-entity-ticker">{ticker}</span>}
                      <span>{nameZh}</span>
                    </span>
                  );
                })}
              </div>
            </aside>
          )}

          <nav className="insight-detail-nav" aria-label="文章导航">
            {adjacent.newer ? (
              <Link href={`/insights/${adjacent.newer.slug}`} className="insight-detail-nav-link">
                <span className="insight-detail-nav-label">← 较新一篇</span>
                <span className="insight-detail-nav-title">{adjacent.newer.title}</span>
              </Link>
            ) : <span />}
            {adjacent.older ? (
              <Link href={`/insights/${adjacent.older.slug}`} className="insight-detail-nav-link insight-detail-nav-link--older">
                <span className="insight-detail-nav-label">较早一篇 →</span>
                <span className="insight-detail-nav-title">{adjacent.older.title}</span>
              </Link>
            ) : <span />}
          </nav>
          <Link href="/insights" className="insight-detail-back">← 返回洞见列表</Link>
        </InsightChatShell>
      </main>
    </div>
  );
}

async function getAdjacentPosts(slug: string) {
  try {
    const posts = await prisma.insightPost.findMany({
      where: { status: "published" },
      select: { slug: true, title: true },
      orderBy: [{ publishedAt: "desc" }, { updatedAt: "desc" }],
      take: 80,
    });
    const index = posts.findIndex((p) => p.slug === slug);
    if (index === -1) return { newer: null, older: null };
    return {
      newer: index > 0 ? posts[index - 1] : null,
      older: index < posts.length - 1 ? posts[index + 1] : null,
    };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2021") {
      return { newer: null, older: null };
    }
    throw err;
  }
}

async function getInsightPost(slug: string) {
  try {
    const decodedSlug = decodeURIComponent(slug);
    return await prisma.insightPost.findUnique({
      where: { slug: decodedSlug },
      select: {
        slug: true,
        title: true,
        description: true,
        source: true,
        sourceUrl: true,
        author: true,
        publishedAt: true,
        tags: true,
        entityIds: true,
        format: true,
        contentRaw: true,
        updatedAt: true,
        status: true,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2021") {
      console.warn("[insights] InsightPost table does not exist; run prisma migrate deploy.");
      return null;
    }
    throw err;
  }
}

async function getEntitiesByIds(ids: string[]) {
  return prisma.entity.findMany({
    where: { id: { in: ids } },
    select: { id: true, canonicalName: true, ticker: true, cik: true, code: true, metadata: true },
  });
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
