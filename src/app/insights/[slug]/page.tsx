import { notFound } from "next/navigation";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { SiteNav } from "@/components/SiteNav";
import { InsightReader } from "@/components/InsightReader";
import { InsightOverviewShareButton } from "@/components/InsightOverviewShareButton";
import { estimateReadingMinutes, extractInsightOverviewShareContent, isInsightFormat } from "@/lib/insights";

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

  return (
    <div className="home-v2 insight-detail-page">
      <SiteNav />
      <main className="insight-detail-shell">
        <header className="insight-detail-head">
          <h1>{post.title}</h1>
          <div className="insight-detail-meta">
            <span>{post.sourceUrl ? <a href={post.sourceUrl} target="_blank" rel="noopener noreferrer">{post.source || "来源"}</a> : post.source || "Buffett Tribe"}</span>
            {post.author ? <span>{post.author}</span> : null}
            <span>{dateLabel}</span>
            <span>{estimateReadingMinutes(post.contentRaw)} min</span>
          </div>
          {post.description ? <p className="insight-detail-desc">{post.description}</p> : null}
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
      </main>
    </div>
  );
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

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
