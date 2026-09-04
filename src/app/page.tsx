import Link from "next/link";
import prisma from "@/lib/prisma";
import { formatCompanyUrl } from "@/lib/company-data";
import { SiteNav } from "@/components/SiteNav";
import { HeroSearch } from "@/components/HeroSearch";
import { getLatestHomeSignalCards } from "@/lib/home-signals";
import { getCoreTribeMembers, getTribeMemberColor } from "@/lib/tribe";
import { getAvailableQuarters, getLatestPortfolioValueUsd } from "@/lib/master-data";
import { formatUsdInYi } from "@/lib/currency";
import { BRAND_EN } from "@/lib/brand";

export const dynamic = "force-dynamic";

const POPULAR_COMPANIES = [
  { name: "贵州茅台", ticker: "600519", href: "/company/cn-600519" },
  { name: "腾讯控股", ticker: "00700", href: "/company/hk-00700" },
  { name: "苹果", ticker: "AAPL", href: "/company/CIK0000320193" },
  { name: "泡泡玛特", ticker: "09992", href: "/company/hk-09992" },
  { name: "阿里巴巴", ticker: "BABA", href: "/company/CIK0001577552" },
  { name: "英伟达", ticker: "NVDA", href: "/company/CIK0001045810" },
  { name: "Alphabet", ticker: "GOOG", href: "/company/CIK0001652044" },
];

async function getCoreMasters() {
  try {
    const members = await getCoreTribeMembers();
    return await Promise.all(
      members.map(async (m) => {
        const [quarters, portfolioValueUsd] = await Promise.all([
          getAvailableQuarters(m.id),
          getLatestPortfolioValueUsd(m.id),
        ]);
        return {
          ...m,
          color: getTribeMemberColor(m),
          latestQuarter: quarters[0] ?? null,
          aum: portfolioValueUsd != null ? `$${formatUsdInYi(portfolioValueUsd)}` : null,
        };
      })
    );
  } catch (err) {
    if (process.env.DEBUG_DB_FALLBACK === "1") {
      console.warn("[home:masters] DB query failed:", err);
    }
    return [];
  }
}

async function getLatestInsights() {
  try {
    return await prisma.insightPost.findMany({
      where: { status: "published" },
      select: {
        slug: true,
        title: true,
        description: true,
        source: true,
        publishedAt: true,
        tags: true,
      },
      orderBy: [{ publishedAt: "desc" }, { updatedAt: "desc" }],
      take: 6,
    });
  } catch (err) {
    if (process.env.DEBUG_DB_FALLBACK === "1") {
      console.warn("[home:insights] DB query failed:", err);
    }
    return [];
  }
}

function formatInsightDate(date: Date | null | undefined): string {
  if (!date) return "";
  const d = new Date(date);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export default async function Home() {
  const [signals, masters, insights] = await Promise.all([
    getLatestHomeSignalCards(),
    getCoreMasters(),
    getLatestInsights(),
  ]);

  return (
    <div className="home-v2">
      <SiteNav />

      {/* Signals & Popular Companies */}
      <section className="home-signals">
        <div className="home-signals-in">
          {signals.map((s) => (
            <div key={s.ticker} className={`home-sig home-sig--${s.type}`}>
              <span className="home-sig-tag">{s.tag}</span>
              <Link href={formatCompanyUrl({ cik: s.cik }) ?? "#"} className="home-sig-ticker">
                {s.tickerLabel}
              </Link>
              <div className="home-sig-company">{s.company}</div>
              <div className="home-sig-body">{s.body}</div>
              <div className="home-sig-chips">
                {s.chips.map((c) => (
                  <span key={c.label} className="home-sig-chip" style={c.style}>
                    {c.label}
                  </span>
                ))}
              </div>
            </div>
          ))}

          {/* Popular Companies Bar */}
          <div className="home-signals-popular">
            <div className="home-signals-popular-head">
              <span className="home-signals-popular-dot" />
              <span className="home-signals-popular-label">热门公司</span>
            </div>
            <div className="home-signals-popular-chips">
              {POPULAR_COMPANIES.map((c) => (
                <Link key={c.ticker} href={c.href} className="home-signals-popular-chip">
                  <span className="home-signals-popular-name">{c.name}</span>
                  <span className="home-signals-popular-code">{c.ticker}</span>
                </Link>
              ))}
            </div>
            <Link href="/company" className="home-signals-popular-more">
              全部公司库 <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </section>

      {/* Hero search */}
      <section className="home-hero">
        <Link href="/agent" className="home-hero-hitbox" aria-label="进入对话研究室" />
        <h1 className="home-hero-brand">买股票就是买公司</h1>
        <p className="home-hero-sub home-hero-sub--compact">
          用大师的框架，看懂一家公司
        </p>
        <HeroSearch />
      </section>

      {/* Core Masters Section */}
      {masters.length > 0 && (
        <section className="home-section home-masters-section">
          <div className="home-section-in">
            <div className="home-section-head">
              <div className="home-section-head-main">
                <div className="home-section-badge">投资大师</div>
                <h2 className="home-section-title">核心部落成员</h2>
                <p className="home-section-subtitle">
                  追踪巴菲特、李录、段永平的最新持仓变动与经典思想资料
                </p>
              </div>
              <Link href="/master" className="home-section-more">
                探索全部 11 位投资人 <span aria-hidden="true">→</span>
              </Link>
            </div>

            <div className="home-masters-grid">
              {masters.map((m) => (
                <div key={m.id} className="home-master-card">
                  <Link href={`/master/${m.id}`} className="home-master-main">
                    <div className="home-master-top">
                      <span
                        className="home-master-avatar"
                        style={{ background: m.color }}
                      >
                        {m.initials.slice(0, 2)}
                      </span>
                      <div className="home-master-info">
                        <div className="home-master-name-row">
                          <span className="home-master-name">{m.nameZh}</span>
                          <span className="home-master-name-en">{m.name}</span>
                        </div>
                        <div className="home-master-firm">{m.firm}</div>
                      </div>
                      {m.aum && <span className="home-master-aum">{m.aum}</span>}
                    </div>
                  </Link>

                  <div className="home-master-quarter-bar">
                    <span className="home-master-quarter-dot" />
                    <span className="home-master-quarter-text">
                      最新 13F · {m.latestQuarter ? `${m.latestQuarter.year} Q${m.latestQuarter.quarter} 已更新` : "已同步"}
                    </span>
                  </div>

                  <div className="home-master-links">
                    <Link href={m.materialHref} className="home-master-link">
                      <span className="home-master-link-icon">🧠</span>
                      <div className="home-master-link-meta">
                        <span className="home-master-link-title">资料库</span>
                        <span className="home-master-link-sub">{m.materialSub}</span>
                      </div>
                    </Link>
                    <Link href={m.holdingsHref} className="home-master-link">
                      <span className="home-master-link-icon">📊</span>
                      <div className="home-master-link-meta">
                        <span className="home-master-link-title">持仓明细</span>
                        <span className="home-master-link-sub">
                          {m.latestQuarter ? `${m.latestQuarter.year} Q${m.latestQuarter.quarter}` : "持仓报告"}
                        </span>
                      </div>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Latest Insights Section */}
      {insights.length > 0 && (
        <section className="home-section home-insights-section">
          <div className="home-section-in">
            <div className="home-section-head">
              <div className="home-section-head-main">
                <div className="home-section-badge">深度洞见</div>
                <h2 className="home-section-title">最新深度研究</h2>
                <p className="home-section-subtitle">
                  围绕商业模式、护城河评估、前沿趋势与大师持仓的深度研究
                </p>
              </div>
              <Link href="/insights" className="home-section-more">
                浏览全部洞见 <span aria-hidden="true">→</span>
              </Link>
            </div>

            <div className="home-insights-grid">
              {insights.map((post) => {
                const sourceLabel = post.source || BRAND_EN;
                const formattedDate = formatInsightDate(post.publishedAt);

                return (
                  <Link
                    key={post.slug}
                    href={`/insights/${post.slug}`}
                    className="home-insight-card"
                  >
                    <div className="home-insight-card-head">
                      <span className="home-insight-source">{sourceLabel}</span>
                      {formattedDate && (
                        <span className="home-insight-date">{formattedDate}</span>
                      )}
                    </div>
                    <h3 className="home-insight-title">{post.title}</h3>
                    {post.description && (
                      <p className="home-insight-desc">{post.description}</p>
                    )}
                    {post.tags && post.tags.length > 0 && (
                      <div className="home-insight-tags">
                        {post.tags.slice(0, 3).map((tag) => (
                          <span key={tag} className="home-insight-tag">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
