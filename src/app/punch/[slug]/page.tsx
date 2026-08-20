import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteNav } from "@/components/SiteNav";
import { getPunchBySlug } from "@/lib/punch";
import { formatUsdInYi } from "@/lib/currency";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  active: "进行中",
  exited: "已平仓",
  thesis_broken: "逻辑被推翻",
};

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const punch = await getPunchBySlug(slug);
  if (!punch) return { title: "打孔 — 巴菲特部落" };
  return {
    title: `${punch.masterName ?? ""} × ${punch.companyName ?? ""} — 打孔 — 巴菲特部落`,
    description: punch.headline,
  };
}

export default async function PunchDetailPage({ params }: Props) {
  const { slug } = await params;
  const punch = await getPunchBySlug(slug);
  if (!punch) notFound();

  return (
    <div className="home-v2 punch-detail-page">
      <SiteNav />
      <main className="punch-detail-shell">
        <Link href="/punch" className="punch-detail-back">
          ← 打孔
        </Link>

        <header className="punch-detail-head">
          <div className="punch-detail-who">
            {punch.masterInitials && (
              <span className="punch-avatar punch-avatar--lg" style={{ background: punch.masterColor ?? undefined }}>
                {punch.masterInitials.slice(0, 2)}
              </span>
            )}
            <div className="punch-detail-who-text">
              {punch.masterHref ? (
                <Link href={punch.masterHref} className="punch-detail-master">
                  {punch.masterName}
                </Link>
              ) : (
                <span className="punch-detail-master">{punch.masterName ?? "未知投资人"}</span>
              )}
              <span className="punch-detail-arrow">→</span>
              {punch.companyHref ? (
                <Link href={punch.companyHref} className="punch-detail-company">
                  {punch.companyName}
                  {punch.companyTicker ? ` (${punch.companyTicker})` : ""}
                </Link>
              ) : (
                <span className="punch-detail-company">
                  {punch.companyName ?? "未知公司"}
                  {punch.companyTicker ? ` (${punch.companyTicker})` : ""}
                </span>
              )}
            </div>
            <div className="punch-card-badges">
              {punch.punchYear && <span className="punch-year">{punch.punchYear}年</span>}
              <span className={`punch-status punch-status--${punch.status}`}>
                {STATUS_LABEL[punch.status] ?? punch.status}
              </span>
            </div>
          </div>
          <h1 className="punch-detail-headline">{punch.headline}</h1>
          {punch.entrySummary && <p className="punch-detail-entry">{punch.entrySummary}</p>}
        </header>

        {punch.livePosition && (
          <div className="punch-live-position">
            <span className="punch-live-position-label">最新 13F 快照 · {punch.livePosition.asOfDate}</span>
            <span className="punch-live-position-stats">
              {punch.livePosition.percentOfPortfolio != null
                ? `占组合 ${punch.livePosition.percentOfPortfolio.toFixed(1)}%`
                : null}
              {punch.livePosition.valueUsd
                ? ` · 持仓市值 $${formatUsdInYi(punch.livePosition.valueUsd)}`
                : null}
            </span>
          </div>
        )}

        <section className="punch-detail-fields">
          <article className="punch-field">
            <h2>叙事</h2>
            <p>{punch.thesis}</p>
          </article>
          {punch.catalyst && (
            <article className="punch-field">
              <h2>催化剂</h2>
              <p>{punch.catalyst}</p>
            </article>
          )}
          {punch.valuation && (
            <article className="punch-field">
              <h2>估值</h2>
              <p>{punch.valuation}</p>
            </article>
          )}
          {punch.risk && (
            <article className="punch-field">
              <h2>风险</h2>
              <p>{punch.risk}</p>
            </article>
          )}
        </section>

        {punch.quotes.length > 0 && (
          <section className="punch-quotes">
            <h2>原话</h2>
            {punch.quotes.map((q, i) => (
              <blockquote key={i} className="punch-quote-item">
                <p>{q.text}</p>
                <cite>
                  {q.date} ·{" "}
                  {q.sourceUrl ? <Link href={q.sourceUrl}>{q.sourceTitle}</Link> : q.sourceTitle}
                </cite>
              </blockquote>
            ))}
          </section>
        )}
      </main>
    </div>
  );
}
