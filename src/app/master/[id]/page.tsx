import Link from "next/link";
import { notFound } from "next/navigation";
import { CompanyDisplayName } from "@/components/CompanyDisplayName";
import { SiteNav } from "@/components/SiteNav";
import { formatCompanyPathFromCik } from "@/lib/cik";
import { computeHoldingActivity, computeShareDeltaPct } from "@/lib/holding-activity";
import { getTribeMember } from "@/lib/tribe";
import { getDocumentsForOwner } from "@/lib/documents";
import { getMasterProfile } from "@/lib/master-profile";
import {
  formatShares,
  formatValueUsd,
  getHoldingsByQuarter,
  getLatestHoldingChangeSet,
  getMasterClassSummary,
  getPortfolioInsightRecord,
} from "@/lib/master-data";

export const revalidate = 300; // cache 5 min - holdings/letters update infrequently


interface Props {
  params: Promise<{ id: string }>;
}

const PIE_COLORS = [
  "#3b82f6",
  "#ef4444",
  "#f59e0b",
  "#10b981",
  "#8b5cf6",
  "#06b6d4",
  "#f97316",
  "#84cc16",
  "#ec4899",
  "#64748b",
];

type PieDatum = {
  zh: string;
  en: string;
  code: string;
  pct: number;
  color: string;
};

function formatPriceFromValueAndShares(valueUsd: bigint | null, shares: bigint | null) {
  if (valueUsd == null || shares == null) return "-";
  const v = Number(valueUsd);
  const s = Number(shares);
  if (!Number.isFinite(v) || !Number.isFinite(s) || s <= 0) return "-";
  return `$${(v / s).toFixed(2)}`;
}

function formatSignedPct(diffPct: number | null) {
  if (diffPct == null || !Number.isFinite(diffPct)) return "-";
  const sign = diffPct > 0 ? "+" : "";
  return `${sign}${diffPct.toFixed(1)}%`;
}

function buildPieSeries(
  holdings: Awaited<ReturnType<typeof getHoldingsByQuarter>>,
) {
  const merged = new Map<string, PieDatum & { tickers: Set<string> }>();
  let colorIdx = 0;
  for (const h of holdings) {
    const d = getHoldingDisplay(h.security);
    const meta = (h.security.metadata ?? {}) as { companyEntityId?: string };
    const companyEntityId =
      h.securityProfile?.companyEntityId ??
      (typeof meta.companyEntityId === "string" ? meta.companyEntityId : null);
    const key = companyEntityId ? `cmp:${companyEntityId}` : `sec:${h.securityEntityId}`;
    const pct = Math.max(0, h.percentOfPortfolio ?? 0);
    const securityTicker = getHoldingTicker(h)?.toUpperCase() ?? null;
    const existing = merged.get(key);
    if (existing) {
      if (securityTicker) existing.tickers.add(securityTicker);
      merged.set(key, { ...existing, pct: existing.pct + pct });
    } else {
      merged.set(key, {
        zh: d.zh,
        en: d.en,
        code: d.code,
        pct,
        color: PIE_COLORS[colorIdx++ % PIE_COLORS.length],
        tickers: new Set(securityTicker ? [securityTicker] : []),
      });
    }
  }
  const aggregated = Array.from(merged.values())
    .map((x) => {
      const tickerList = [...x.tickers.values()].sort();
      const code = tickerList.length === 0 ? "-" : tickerList.join(", ");
      return { zh: x.zh, en: x.en, code, pct: x.pct, color: x.color };
    })
    .sort((a, b) => b.pct - a.pct);
  const top = aggregated.slice(0, 10);
  const topPct = top.reduce((sum, x) => sum + x.pct, 0);
  const otherPct = Math.max(0, 100 - topPct);
  return [...top, { zh: "其他", en: "Others", code: "-", pct: otherPct, color: "#e5e7eb" }] as PieDatum[];
}

function getHoldingDisplay(security: {
  ticker: string | null;
  canonicalName: string;
  metadata: unknown;
}) {
  const meta = (security.metadata ?? {}) as { cusip?: string; nameZh?: string; nameEnShort?: string };
  const code = security.ticker ?? meta.cusip ?? "-";
  const en = meta.nameEnShort ?? security.canonicalName;
  const zh = meta.nameZh ?? en;
  return { code, zh, en };
}

function getHoldingTicker(h: Awaited<ReturnType<typeof getHoldingsByQuarter>>[number]) {
  return h.security.ticker ?? h.securityProfile?.ticker ?? h.securityProfile?.company?.ticker ?? null;
}

function getHoldingCompanyPath(h: Awaited<ReturnType<typeof getHoldingsByQuarter>>[number]) {
  return formatCompanyPathFromCik(h.securityProfile?.company?.cik);
}

function splitNarrative(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return { lead: "", points: [] as string[] };

  const withEnding = (part: string) =>
    /[。！？.!?]$/.test(part) ? part : `${part}。`;

  const sentences = normalized
    .split(/(?<=[。！？])/)
    .map((part) => part.trim())
    .filter(Boolean);

  return {
    lead: withEnding(sentences[0] ?? normalized),
    points: sentences.slice(1).map(withEnding),
  };
}

// Hardcoded fallback when DB profile is unavailable
const FALLBACK_BRIEF: Record<
  string,
  { intro: string; framework: string[]; tags: string[]; timeline: string[] }
> = {
  buffett: {
    intro:
      "沃伦·巴菲特，伯克希尔·哈撒韦董事长，全球价值投资集大成者，以资本配置纪律和长期持有闻名。",
    framework: [
      "能力圈：坚守自己可理解且可长期跟踪的业务边界",
      "经济护城河：寻找品牌、成本优势、网络效应与定价权",
      "管理层素质：关注卓越的资本配置纪律与股东导向",
      "安全边际：要求买入价格比估算的每股内在价值有显著折扣",
    ],
    tags: ["长期主义", "特许经营权", "高ROE", "资本配置"],
    timeline: [
      "1956：成立巴菲特合伙人公司（Buffett Partnership）",
      "1965：控制伯克希尔·哈撒韦，将其转型为资本配置旗舰",
      "1972：收购喜诗糖果，转向「价格合理的高质量企业」",
      "1988：重仓可口可乐（Coca-Cola），确立经济护城河典范",
      "2016：大举建仓苹果（Apple），成为第一大重仓股",
    ],
  },
  lilu: {
    intro: "李录，喜马拉雅资本创始人，查理·芒格家族资产管理人，将现代价值投资与中国经济全球化深度结合的实践者。",
    framework: [
      "对的生意：寻找能长期产生高自由现金流且可持续增长的公司",
      "对的人：评估管理层企业家精神、诚信和长期视野",
      "安全边际：在商业和管理层正确的基础上，追求内在价值的低估",
      "能力圈：坚守深度研究，追求长期的认知优势",
    ],
    tags: ["Right Business", "深度研究", "中国机遇", "第一性原理"],
    timeline: [
      "1993：在哥伦比亚大学听巴菲特演讲，启发价值投资之路",
      "1996：创纪录获得哥大经济学、法学(JD)、商学(MBA)三学位",
      "1997：创立喜马拉雅资本（Himalaya Capital）",
      "2003：结识查理·芒格，受托管理其家族资产",
      "2008：向伯克希尔推荐并促成比亚迪（BYD）的重仓投资",
      "2020：出版《文明、现代化、价值投资与中国》",
    ],
  },
  duan: {
    intro: "段永平，步步高创始人，著名企业家、投资家，以「本分」、「商业模式优先」和重仓苹果、腾讯闻名。",
    framework: [
      "商业模式优先：好的模式容易赚钱，有很强用户黏性与高壁垒",
      "本分文化：不做不对的事，保持平常心，克制盲目扩张",
      "懂即是简单：对商业模式和确定性有近乎常识性的把握",
      "估值即现金流折现：若不能一眼看出便宜，那就是不够便宜",
    ],
    tags: ["本分", "商业模式优先", "不为清单", "懂即是简单"],
    timeline: [
      "1989：创立「小霸王」品牌，打造电子学习机与游戏机帝国",
      "1995：创立步步高，后分化出 OPPO、vivo 等知名品牌",
      "2001：移居美国并退居幕后，自学价值投资",
      "2002：低位重仓网易，持股超 6%，后获超百倍回报",
      "2006：标得巴菲特慈善午餐，携黄峥一同前往",
      "2011：大举建仓苹果公司，成为其第一大重仓股",
      "2018：建仓并持续买入腾讯，公开分享对微信生态的理解",
    ],
  },
};

export default async function PersonHubPage({ params }: Props) {
  const { id } = await params;
  const member = getTribeMember(id);
  if (!member) notFound();

  const [masterClass, changeSet, profileResult] = await Promise.all([
    getMasterClassSummary(id),
    getLatestHoldingChangeSet(id),
    getMasterProfile(id),
  ]);

  const fallback = FALLBACK_BRIEF[id] ?? FALLBACK_BRIEF.buffett;
  const profile = profileResult?.profile;
  const intro = profile?.intro ?? fallback.intro;
  const framework = profile?.framework ?? fallback.framework;
  const tags = profile?.tags ?? fallback.tags;
  const timeline = profile?.timeline ?? fallback.timeline;
  const style = profile?.style;
  const flagshipCases = profile?.flagshipCases;
  const influences = profile?.influences;
  const quotes = profile?.quotes;
  const trackRecord = profile?.trackRecord;
  const latest = changeSet.latest;
  const portfolioInsight = latest
    ? await getPortfolioInsightRecord(id, latest.year, latest.quarter)
    : null;
  const insights = portfolioInsight?.structured?.items ?? [];
  const summaryInsight = insights.find((item) => item.kind === "summary") ?? null;
  const portfolioInsightNarrative = portfolioInsight?.narrative ?? null;
  const narrativeParts = portfolioInsightNarrative
    ? splitNarrative(portfolioInsightNarrative)
    : { lead: "", points: [] as string[] };
  const latestLabel = latest ? `${latest.year} Q${latest.quarter}` : "暂无数据";
  const baseLabel = changeSet.base ? `${changeSet.base.year} Q${changeSet.base.quarter}` : "无可比季度";
  const fullHoldings = latest
    ? await getHoldingsByQuarter(id, latest.year, latest.quarter)
    : [];
  const pieData = buildPieSeries(fullHoldings);
  const prevHoldings = changeSet.base
    ? await getHoldingsByQuarter(id, changeSet.base.year, changeSet.base.quarter)
    : [];
  const holdingKey = (h: { securityId: string | null; securityEntityId: string }) => h.securityId ?? h.securityEntityId;
  const prevBySecurityId = new Map(prevHoldings.map((h) => [holdingKey(h), h] as const));
  const currentKeySet = new Set(fullHoldings.map((h) => holdingKey(h)));
  const soldOutRows = prevHoldings.filter((h) => !currentKeySet.has(holdingKey(h)));
  const documentOwner = id === "buffett" || id === "duan" || id === "lilu" ? id : null;
  const documents = documentOwner ? getDocumentsForOwner(documentOwner) : [];
  const bookDoc = id === "buffett" ? documents[0] ?? null : null;

  return (
    <div className="person-page">
      <SiteNav />

      <div className="person-wrap">
        <section className="person-hero">
          <div className="person-hero-accent" style={{ background: member.color }} />
          <div className="person-hero-body">
            <span className="person-avatar" style={{ background: member.color }}>
              {member.initials.slice(0, 2)}
            </span>
            <div className="person-hero-info">
              <p className="person-eyebrow">Investor Profile</p>
              <h1 className="person-name">{member.nameZh}</h1>
              <p className="person-firm">{member.firm}</p>
              <p className="person-intro">{intro}</p>
              {timeline.length > 0 && (
                <div className="person-timeline-v2 person-timeline-v2--hero">
                  {timeline.map((line: string, i: number) => {
                    const sepIdx = Math.max(line.indexOf("："), line.indexOf(":"), line.indexOf("-"));
                    const year = sepIdx > -1 ? line.slice(0, sepIdx) : "";
                    const desc = sepIdx > -1 ? line.slice(sepIdx + 1) : line;
                    return (
                      <div key={i} className="person-timeline-node">
                        <div className="person-timeline-marker">
                          <div className="person-timeline-dot" />
                          {i < timeline.length - 1 && <div className="person-timeline-line" />}
                        </div>
                        <div className="person-timeline-body">
                          {year && <span className="person-timeline-year">{year}</span>}
                          <span className="person-timeline-desc">{desc}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="person-section">
            <div className="person-section-head">
              <h2 className="person-section-title">投资理念</h2>
            </div>

            <div className="person-style-tags">
              {tags.map((tag: string) => (
                <span key={tag} className="person-tag">{tag}</span>
              ))}
            </div>

            <div className="person-philosophy">
              {framework.map((line: string) => (
                <div key={line} className="person-philosophy-item">{line}</div>
              ))}
            </div>

            {style && (
            <div className="person-style-grid">
              <div className="person-style-card">
                <div className="person-style-label">组合集中度</div>
                <div className="person-style-value">{style.concentration}</div>
              </div>
              <div className="person-style-card">
                <div className="person-style-label">持仓数量</div>
                <div className="person-style-value">{style.holdingCount}</div>
              </div>
              <div className="person-style-card">
                <div className="person-style-label">重仓行业</div>
                <div className="person-style-value">
                  {style.sectorFocus?.map((s: string) => (
                    <span key={s} className="person-section-tag">{s}</span>
                  ))}
                </div>
              </div>
              <div className="person-style-card">
                <div className="person-style-label">换手特征</div>
                <div className="person-style-value">{style.turnover}</div>
              </div>
              <div className="person-style-card">
                <div className="person-style-label">持有周期</div>
                <div className="person-style-value">{style.avgHoldingPeriod}</div>
              </div>
              <div className="person-style-card">
                <div className="person-style-label">杠杆使用</div>
                <div className="person-style-value">{style.leverageUsage}</div>
              </div>
            </div>
            )}

            {(influences && influences.length > 0 || quotes && quotes.length > 0 || trackRecord) && (
              <div className="person-quotes-block">
                {influences && influences.length > 0 && (
                  <div className="person-influences">
                    <div className="person-quotes-label">受谁影响</div>
                    <div className="person-influence-list">
                      {influences.map((inf: string) => (
                        <span key={inf} className="person-influence-tag">{inf}</span>
                      ))}
                    </div>
                  </div>
                )}
                {quotes && quotes.length > 0 && (
                  <div className="person-quotes-list">
                    <div className="person-quotes-label">代表性观点</div>
                    {quotes.map((q: string, i: number) => (
                      <div key={i} className="person-quote-item">&quot;{q}&quot;</div>
                    ))}
                  </div>
                )}
                {trackRecord && (
                  <div className="person-track-record">
                    <div className="person-quotes-label">历史业绩</div>
                    <div className="person-track-meta">
                      {trackRecord.startYear && (
                        <span>管理起始：{trackRecord.startYear}年</span>
                      )}
                      {trackRecord.cagr && (
                        <span>年化回报：{trackRecord.cagr}</span>
                      )}
                      {trackRecord.benchmarkComparison && (
                        <span>基准对比：{trackRecord.benchmarkComparison}</span>
                      )}
                    </div>
                    <div className="person-track-source">{trackRecord.sourceNote}</div>
                  </div>
                )}
              </div>
            )}
          </section>

        {flagshipCases && flagshipCases.length > 0 && (
          <section className="person-section">
            <div className="person-section-head">
              <h2 className="person-section-title">关键案例</h2>
            </div>

            <>
              <div className="person-cases-head">
                <span className="person-section-subhead">重点持仓案例</span>
                <span className="person-cases-count">{flagshipCases.length} 个案例</span>
              </div>
              <div className="person-cases-grid">
                {flagshipCases.map((c, i) => (
                  <div key={`${c.ticker}-${i}`} className="person-case-card">
                    <div className="person-case-accent" />
                    <div className="person-case-body">
                      <div className="person-case-header">
                        <span className="person-case-ticker">{c.ticker}</span>
                        <span className="person-case-name">{c.nameZh}</span>
                        <span className="person-case-year">{c.entryYear}年建仓</span>
                        {c.stillHolding && <span className="person-case-badge">持仓中</span>}
                      </div>
                      <div className="person-case-thesis">{c.thesis}</div>
                      <div className="person-case-outcome">{c.outcome}</div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          </section>
        )}

        <section className="person-section" id="library">
          <div className="person-section-head">
            <h2 className="person-section-title">资料库</h2>
          </div>

          {id === "buffett" ? (
            <div className="document-grid">
              {[
                {
                  key: "partnership",
                  title: `合伙人信件（${masterClass.find((item) => item.key === "partnership")?.range ?? "1958–1970"}）`,
                  subtitle: "巴菲特合伙人时期致投资者的年度信件。",
                  badge: "信件",
                  href: "/master/buffett/library?category=letter&type=partnership",
                },
                {
                  key: "shareholder",
                  title: `股东信件（${masterClass.find((item) => item.key === "shareholder")?.range ?? "1965–2025"}）`,
                  subtitle: "伯克希尔·哈撒韦历年致股东的信。",
                  badge: "信件",
                  href: "/master/buffett/library?category=letter&type=shareholder",
                },
                {
                  key: "book",
                  title: bookDoc?.title ?? "Buffett & Munger Unscripted",
                  subtitle: "历年股东大会问答实录。",
                  badge: "书籍",
                  href: bookDoc?.readerHref ?? "/documents/buffett/unscripted",
                },
              ].map((card) => (
                <Link key={card.key} href={card.href} className="document-card document-card--link">
                  <div className="document-card-head">
                    <span className="document-card-badge">{card.badge}</span>
                    <h2 className="document-card-title">{card.title}</h2>
                    <p className="document-card-subtitle">{card.subtitle}</p>
                  </div>
                </Link>
              ))}
            </div>
          ) : documents.length > 0 ? (
            <div className="document-grid">
              {documents.map((doc) => (
                <Link key={doc.id} href={doc.readerHref} className="document-card document-card--link">
                  <div className="document-card-head">
                    <span className="document-card-badge">{doc.badge}</span>
                    <h2 className="document-card-title">{doc.title}</h2>
                    <p className="document-card-subtitle">{doc.subtitle}</p>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="person-master-grid">
              {masterClass.filter((item) => item.count > 0).map((item) => (
                <Link
                  key={item.key}
                  href={
                    item.latest
                      ? `/master/${id}/library?type=${encodeURIComponent(item.key)}&year=${item.latest}`
                      : item.href
                  }
                  className="person-master-card"
                >
                  <div className="person-master-title">{item.label}</div>
                  <div className="person-master-meta">
                    <span>{item.count} 篇</span>
                    <span>{item.range}</span>
                  </div>
                  <div className="person-master-latest">
                    最近:{item.latest ?? "-"}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="person-section" id="holdings">
          <div className="person-section-head">
            <div>
              <h2 className="person-section-title">最新持仓({latestLabel})</h2>
              <p className="person-compare-note">对比基准:{baseLabel}</p>
            </div>
            {latest ? (
              <Link href={`/master/${id}/holdings`} className="person-view-all">
                持仓历史
              </Link>
            ) : null}
          </div>
          {latest && changeSet.top.length ? (
            <>
              <div className="person-top-grid">
                <div className="person-top10">
                  <div className="person-pie-svg-wrap">
                    <div className="person-bar-chart" role="img" aria-label="Top10 持仓占比横向柱状图">
                      {pieData.filter((s) => s.pct > 0).map((seg, idx) => (
                        <div key={`${seg.zh}-${seg.code}-${idx}`} className="person-bar-row">
                          <div className="person-bar-head">
                            <span className="person-bar-name">
                              <CompanyDisplayName
                                zhName={seg.zh}
                                enName={seg.en}
                                ticker={seg.code === "-" ? null : seg.code}
                                compact
                              />
                            </span>
                            <span className="person-bar-pct">{seg.pct.toFixed(1)}%</span>
                          </div>
                          <div className="person-bar-track">
                            <div
                              className="person-bar-fill"
                              style={{
                                width: `${Math.max(2, Math.min(100, seg.pct))}%`,
                                background: seg.color,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="person-insights">
                  <h3 className="person-insights-head">持仓洞察</h3>
                  {summaryInsight || portfolioInsightNarrative ? (
                    <div className="person-insight-layout">
                      <div className="person-insight-overview">
                        <div className="person-insight-section-head">
                          <span>组合概况</span>
                          <span>{latestLabel}</span>
                        </div>

                        {summaryInsight && (
                          <>
                            <div className="person-insight-metrics">
                              {summaryInsight.top5Pct != null && (
                                <div className="person-insight-metric">
                                  <span className="person-insight-metric-label">前五集中度</span>
                                  <strong className="person-insight-metric-value">{summaryInsight.top5Pct.toFixed(1)}%</strong>
                                </div>
                              )}
                              {summaryInsight.holdingCount != null && (
                                <div className="person-insight-metric">
                                  <span className="person-insight-metric-label">跟踪持仓</span>
                                  <strong className="person-insight-metric-value">{summaryInsight.holdingCount}</strong>
                                </div>
                              )}
                              {summaryInsight.totalChanged != null && (
                                <div className="person-insight-metric">
                                  <span className="person-insight-metric-label">本季变动</span>
                                  <strong className="person-insight-metric-value">{summaryInsight.totalChanged}</strong>
                                </div>
                              )}
                            </div>

                            <p className="person-insight-overview-text">{summaryInsight.detail}</p>
                          </>
                        )}

                        {portfolioInsightNarrative && (
                          <div className="person-insight-narrative">
                            <div className="person-insight-narrative-head">
                              <span className="person-insight-narrative-kicker">季度点评</span>
                            </div>
                            <p className="person-insight-narrative-lead">{narrativeParts.lead}</p>
                            {narrativeParts.points.length > 0 && (
                              <div className="person-insight-narrative-list">
                                {narrativeParts.points.map((point, idx) => (
                                  <div key={idx} className="person-insight-narrative-item">
                                    <span className="person-insight-narrative-dot" />
                                    <p className="person-insight-narrative-text">{point}</p>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="person-empty">暂无洞察。</p>
                  )}
                </div>
              </div>

              <div className="person-holdings-full">
                <div className="person-section-head">
                  <h2 className="person-section-title">持仓明细({latestLabel})</h2>
                </div>
                <div className="holdings-table-wrap holdings-table-wrap--fit person-holdings-table-wrap">
                  <table className="holdings-table holdings-table--fit person-holdings-table">
                    <thead>
                      <tr>
                        <th className="holdings-th holdings-th--rank">#</th>
                        <th className="holdings-th">股票 Stock</th>
                        <th className="holdings-th holdings-th--num">仓位 % of Portfolio</th>
                        <th className="holdings-th">近期动作 Recent Activity</th>
                        <th className="holdings-th holdings-th--num">持股 Shares</th>
                        <th className="holdings-th holdings-th--num">申报价 Reported Price*</th>
                        <th className="holdings-th holdings-th--num">市值(亿) Value</th>
                        <th className="holdings-th holdings-th--num">现价 Current Price</th>
                        <th className="holdings-th holdings-th--num">较申报价 +/- Reported Price</th>
                        <th className="holdings-th holdings-th--num">52周低点 52 Week Low</th>
                        <th className="holdings-th holdings-th--num">52周高点 52 Week High</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fullHoldings.map((h, i) => {
                        const display = getHoldingDisplay(h.security);
                        const prev = prevBySecurityId.get(holdingKey(h));
                        const shareDeltaPct = computeShareDeltaPct(prev?.shares, h.shares);
                        const activity = computeHoldingActivity(Boolean(changeSet.base), Boolean(prev), shareDeltaPct);
                        const rowClass =
                          activity === "New"
                            ? "holdings-row holdings-row--new"
                            : activity === "Added"
                              ? "holdings-row holdings-row--added"
                              : activity === "Reduced"
                                ? "holdings-row holdings-row--reduced"
                                : "holdings-row";
                        return (
                          <tr key={h.id} className={rowClass}>
                            <td className="holdings-td holdings-td--rank">{i + 1}</td>
                            <td className="holdings-td holdings-td--name">
                              <span className="holdings-company">
                                {getHoldingCompanyPath(h) ? (
                                  <Link href={getHoldingCompanyPath(h)!}>
                                    <CompanyDisplayName
                                      zhName={display.zh}
                                      enName={display.en}
                                      ticker={getHoldingTicker(h)}
                                      compact
                                    />
                                  </Link>
                                ) : (
                                  <CompanyDisplayName
                                    zhName={display.zh}
                                    enName={display.en}
                                    ticker={getHoldingTicker(h)}
                                    compact
                                  />
                                )}
                              </span>
                            </td>
                            <td className="holdings-td holdings-td--num">
                              {h.percentOfPortfolio != null ? `${h.percentOfPortfolio.toFixed(2)}%` : "-"}
                            </td>
                            <td className="holdings-td">
                              {activity === "New" ? (
                                <span className="holdings-activity-new">New</span>
                              ) : activity === "Added" ? (
                                <span className="holdings-activity-delta holdings-activity-delta--up">
                                  ↑ {shareDeltaPct != null ? formatSignedPct(shareDeltaPct) : "-"}
                                </span>
                              ) : activity === "Reduced" ? (
                                <span className="holdings-activity-delta holdings-activity-delta--down">
                                  ↓ {shareDeltaPct != null ? formatSignedPct(shareDeltaPct) : "-"}
                                </span>
                              ) : (
                                <span className="holdings-activity-delta">-</span>
                              )}
                            </td>
                            <td className="holdings-td holdings-td--num">{formatShares(h.shares)}</td>
                            <td className="holdings-td holdings-td--num">{formatPriceFromValueAndShares(h.valueUsd, h.shares)}</td>
                            <td className="holdings-td holdings-td--num">{formatValueUsd(h.valueUsd)}</td>
                            <td className="holdings-td holdings-td--num">-</td>
                            <td className="holdings-td holdings-td--num">-</td>
                            <td className="holdings-td holdings-td--num">-</td>
                            <td className="holdings-td holdings-td--num">-</td>
                          </tr>
                        );
                      })}
                      {soldOutRows.map((h, i) => {
                        const display = getHoldingDisplay(h.security);
                        return (
                          <tr key={`exit-${h.id}`} className="holdings-row holdings-row--soldout">
                            <td className="holdings-td holdings-td--rank">{fullHoldings.length + i + 1}</td>
                            <td className="holdings-td holdings-td--name">
                              <span className="holdings-company">
                                {getHoldingCompanyPath(h) ? (
                                  <Link href={getHoldingCompanyPath(h)!}>
                                    <CompanyDisplayName
                                      zhName={display.zh}
                                      enName={display.en}
                                      ticker={getHoldingTicker(h)}
                                      compact
                                    />
                                  </Link>
                                ) : (
                                  <CompanyDisplayName
                                    zhName={display.zh}
                                    enName={display.en}
                                    ticker={getHoldingTicker(h)}
                                    compact
                                  />
                                )}
                              </span>
                            </td>
                            <td className="holdings-td holdings-td--num">0.00%</td>
                            <td className="holdings-td">
                              <span className="holdings-activity-soldout">Sold Out</span>
                            </td>
                            <td className="holdings-td holdings-td--num">{formatShares(h.shares)}</td>
                            <td className="holdings-td holdings-td--num">{formatPriceFromValueAndShares(h.valueUsd, h.shares)}</td>
                            <td className="holdings-td holdings-td--num">{formatValueUsd(h.valueUsd)}</td>
                            <td className="holdings-td holdings-td--num">-</td>
                            <td className="holdings-td holdings-td--num">-</td>
                            <td className="holdings-td holdings-td--num">-</td>
                            <td className="holdings-td holdings-td--num">-</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <p className="person-empty">暂无持仓数据。</p>
          )}
        </section>
      </div>
    </div>
  );
}
