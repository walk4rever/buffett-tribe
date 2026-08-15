import Link from "next/link";
import { notFound } from "next/navigation";
import { CompanyDisplayName } from "@/components/CompanyDisplayName";
import { MasterAgentDialog } from "@/components/MasterAgentDialog";
import { SiteNav } from "@/components/SiteNav";
import { formatCompanyUrl } from "@/lib/company-data";
import { formatUsdInYi } from "@/lib/currency";
import { computeHoldingActivity, computeShareDeltaPct } from "@/lib/holding-activity";
import { getTribeMember, getTribeMemberColor } from "@/lib/tribe";
import { getMasterProfile } from "@/lib/master-profile";
import {
  formatShares,
  formatValueUsd,
  getHoldingsByQuarter,
  getLatestHoldingChangeSet,
  getLibraryItems,
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
  href: string | null;
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

function formatFiledDate(d: Date | null) {
  if (!d) return "-";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
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
    const companyEntityId = h.security?.companyEntityId ?? null;
    const key = companyEntityId ? `cmp:${companyEntityId}` : `sec:${h.securityId}`;
    const pct = Math.max(0, h.percentOfPortfolio ?? 0);
    const securityTicker = getHoldingTicker(h)?.toUpperCase() ?? null;
    const href = getHoldingCompanyPath(h);
    const existing = merged.get(key);
    if (existing) {
      if (securityTicker) existing.tickers.add(securityTicker);
      merged.set(key, { ...existing, href: existing.href ?? href, pct: existing.pct + pct });
    } else {
      merged.set(key, {
        zh: d.zh,
        en: d.en,
        code: d.code,
        href,
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
      return { zh: x.zh, en: x.en, code, href: x.href, pct: x.pct, color: x.color };
    })
    .sort((a, b) => b.pct - a.pct);
  const top = aggregated.slice(0, 10);
  const rest = aggregated.slice(10);
  const otherPct = rest.reduce((sum, x) => sum + x.pct, 0);
  return [...top, { zh: "其他", en: "Others", code: "-", href: null, pct: otherPct, color: "#e5e7eb" }] as PieDatum[];
}

function getHoldingDisplay(security: {
  ticker: string | null;
  metadata: unknown;
  company?: { canonicalName: string; metadata?: unknown } | null;
}) {
  const meta = (security.metadata ?? {}) as { cusip?: string; nameZh?: string; nameEnShort?: string };
  const companyMeta = (security.company?.metadata ?? {}) as { nameZh?: string };
  const code = security.ticker ?? meta.cusip ?? "-";
  const canonicalName = security.company?.canonicalName ?? "-";
  const en = meta.nameEnShort ?? canonicalName;
  const zh = meta.nameZh ?? companyMeta.nameZh ?? en;
  return { code, zh, en };
}

function getHoldingTicker(h: Awaited<ReturnType<typeof getHoldingsByQuarter>>[number]) {
  return h.security?.ticker ?? h.security?.company?.ticker ?? null;
}

function getHoldingCompanyPath(h: Awaited<ReturnType<typeof getHoldingsByQuarter>>[number]) {
  return formatCompanyUrl(h.security?.company ?? {});
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
const FALLBACK_BRIEF: Record<string, { bio: string; fundOverview: string }> = {
  buffett: {
    bio: "沃伦·巴菲特，1930年出生于美国内布拉斯加州奥马哈，师从本杰明·格雷厄姆学习价值投资。1956年成立巴菲特合伙人公司，1965年取得伯克希尔·哈撒韦控制权。2006年宣布将大部分财富捐赠给比尔及梅琳达·盖茨基金会，被誉为「奥马哈先知」。",
    fundOverview: "伯克希尔·哈撒韦以资本配置纪律和长期持有著称，坚持能力圈、经济护城河、管理层素质与安全边际四大原则。1972年收购喜诗糖果确立「价格合理的高质量企业」理念，1988年重仓可口可乐、2016年建仓苹果均成为经典护城河投资案例。",
  },
  lilu: {
    bio: "李录，1993年在哥伦比亚大学听巴菲特演讲后走上价值投资之路，1996年创纪录获得哥大经济学、法学(JD)、商学(MBA)三学位。2003年结识查理·芒格，受托管理其家族资产，2020年出版《文明、现代化、价值投资与中国》。",
    fundOverview: "喜马拉雅资本由李录于1997年创立，将现代价值投资与中国经济全球化深度结合，寻找能长期产生高自由现金流且可持续增长的公司，重视管理层企业家精神与诚信。2008年向伯克希尔推荐并促成比亚迪的重仓投资是其代表案例。",
  },
  duan: {
    bio: "段永平，1989年创立「小霸王」品牌，1995年创立步步高，后分化出 OPPO、vivo 等知名品牌。2001年移居美国并退居幕后自学价值投资，2006年标得巴菲特慈善午餐。",
    fundOverview: "段永平以「本分」文化和「商业模式优先」著称，强调不做不对的事、保持平常心。2002年低位重仓网易获超百倍回报，2011年建仓苹果、2018年建仓腾讯均长期持有至今，是其集中投资风格的代表案例。",
  },
  "gavin-baker": {
    bio: "Gavin Baker，1999年加入 Fidelity Investments，2009年起管理 Fidelity OTC Portfolio，2013年参与推动 Fidelity 的风险投资和成长投资业务，2019年创立 Atreides Management, LP。",
    fundOverview: "Atreides Management, LP 长期专注科技、消费成长、AI、半导体与 public/private crossover 投资，跟踪算力、半导体、软件平台和消费互联网的长期结构变化，结合公开市场与私募成长投资理解企业生命周期。",
  },
  "alex-sacerdote": {
    bio: "Alex Sacerdote，2006年创立 Whale Rock Capital Management，2006-2022年管理其多空股票策略，2020年疫情期间精准布局远程办公和数字基础设施标的，2022年宣布关闭 Whale Rock，返还投资者资本。",
    fundOverview: "Whale Rock Capital Management 专注科技成长投资，以深度基本面研究和长期持有优质成长企业著称，投资于具备可持续竞争优势和强大单位经济模型的企业，换手率低于多数成长型基金。",
  },
};

// Used only when a master has neither a generated MasterProfile nor a
// hand-written FALLBACK_BRIEF entry yet (e.g. right after onboarding, before
// `generate:master-profile` has run) — must never silently borrow another
// investor's bio.
function genericFallback(member: NonNullable<Awaited<ReturnType<typeof getTribeMember>>>) {
  return {
    bio: `${member.nameZh}的投资档案生成中，完整履历即将上线。`,
    fundOverview: `${member.firm}的基金概述生成中，完整内容即将上线。`,
  };
}

export default async function PersonHubPage({ params }: Props) {
  const { id } = await params;
  const member = await getTribeMember(id);
  if (!member) notFound();

  const [libraryItems, changeSet, profileResult] = await Promise.all([
    getLibraryItems(id),
    getLatestHoldingChangeSet(id),
    getMasterProfile(id),
  ]);

  const fallback = FALLBACK_BRIEF[id] ?? genericFallback(member);
  const profile = profileResult?.profile;
  const bio = profile?.bio ?? fallback.bio;
  const fundOverview = profile?.fundOverview ?? fallback.fundOverview;
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
  const holdingKey = (h: { securityId: string | null }) => h.securityId!;
  const prevBySecurityId = new Map(prevHoldings.map((h) => [holdingKey(h), h] as const));
  const currentKeySet = new Set(fullHoldings.map((h) => holdingKey(h)));
  const soldOutRows = prevHoldings.filter((h) => !currentKeySet.has(holdingKey(h)));
  const isAlphaMaster = member.category === "alpha";

  return (
    <div className="person-page">
      <SiteNav />
      <MasterAgentDialog masterId={id} masterName={member.nameZh} />

      <div className="person-wrap">
        <section className="person-hero">
          <div className="person-hero-accent" style={{ background: getTribeMemberColor(member) }} />
          <div className="person-hero-body">
            <span className="person-avatar" style={{ background: getTribeMemberColor(member) }}>
              {member.initials.slice(0, 2)}
            </span>
            <div className="person-hero-info">
              <p className="person-eyebrow">
                {isAlphaMaster ? "Alpha Investor Profile" : "Investor Profile"}
              </p>
              <h1 className="person-name">{member.nameZh}</h1>
              <p className="person-firm">{member.firm}</p>
              {isAlphaMaster ? (
                <>
                  <div className="person-alpha-note">
                    <span>Alpha 部落</span>
                    <span>SEC 13F</span>
                  </div>
                  <p className="person-alpha-disclaimer">
                    数据历史较短，投资风格与研究覆盖因人而异，与巴菲特部落的经典价值投资框架可能存在方法论差异，仅供参考。
                  </p>
                </>
              ) : null}
              <p className="person-intro">{bio}</p>
              <p className="person-intro">{fundOverview}</p>
            </div>
          </div>
        </section>

        <section className="person-section" id="library">
          <div className="person-section-head">
            <h2 className="person-section-title">资料库</h2>
          </div>

          {libraryItems.length > 0 ? (
            <div className="document-grid document-grid--compact">
              {libraryItems.map((item) => (
                <Link key={item.id} href={item.href} className="document-card document-card--link document-card--compact">
                  <div className="document-card-head">
                    <div className="document-card-meta-row">
                      <span className="document-card-badge">{item.badge}</span>
                      {item.date ? <span className="document-card-date">{formatFiledDate(item.date)}</span> : null}
                    </div>
                    <h2 className="document-card-title">{item.title}</h2>
                    <p className="document-card-subtitle">{item.subtitle}</p>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <p className="person-empty">资料库建设中。</p>
          )}
        </section>

        <section className="person-section" id="holdings">
          <div className="person-section-head">
            <div>
              <h2 className="person-section-title">最新持仓({latestLabel})</h2>
              <p className="person-compare-note">对比基准:{baseLabel}</p>
              {isAlphaMaster ? (
                <p className="person-compare-note">
                  13F 仅覆盖可披露的美国公开市场多头及部分期权仓位，不代表{member.nameZh}全部组合。
                </p>
              ) : null}
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
                              {seg.href ? (
                                <Link href={seg.href} className="person-bar-company-link">
                                  <CompanyDisplayName
                                    zhName={seg.zh}
                                    enName={seg.en}
                                    ticker={seg.code === "-" ? null : seg.code}
                                    compact
                                  />
                                </Link>
                              ) : (
                                <CompanyDisplayName
                                  zhName={seg.zh}
                                  enName={seg.en}
                                  ticker={seg.code === "-" ? null : seg.code}
                                  compact
                                />
                              )}
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
                              {summaryInsight.totalValueUsd != null && (
                                <div className="person-insight-metric" title="13F 可报告持仓市值，不代表基金完整 AUM">
                                  <span className="person-insight-metric-label">组合市值</span>
                                  <strong className="person-insight-metric-value">${formatUsdInYi(summaryInsight.totalValueUsd)}</strong>
                                </div>
                              )}
                              {summaryInsight.holdingCount != null && (
                                <div className="person-insight-metric">
                                  <span className="person-insight-metric-label">持仓数量</span>
                                  <strong className="person-insight-metric-value">{summaryInsight.holdingCount}</strong>
                                </div>
                              )}
                              {summaryInsight.top5Pct != null && (
                                <div className="person-insight-metric">
                                  <span className="person-insight-metric-label">前五集中度</span>
                                  <strong className="person-insight-metric-value">{summaryInsight.top5Pct.toFixed(1)}%</strong>
                                </div>
                              )}
                              {(summaryInsight.newCount != null ||
                                summaryInsight.addCount != null ||
                                summaryInsight.trimCount != null ||
                                summaryInsight.exitCount != null) && (
                                <div className="person-insight-metric person-insight-metric--actions">
                                  {summaryInsight.newCount != null && (
                                    <div className="person-insight-action person-insight-action--new">
                                      <span className="person-insight-metric-label">新进</span>
                                      <strong className="person-insight-metric-value">{summaryInsight.newCount}</strong>
                                    </div>
                                  )}
                                  {summaryInsight.addCount != null && (
                                    <div className="person-insight-action person-insight-action--add">
                                      <span className="person-insight-metric-label">加仓</span>
                                      <strong className="person-insight-metric-value">{summaryInsight.addCount}</strong>
                                    </div>
                                  )}
                                  {summaryInsight.trimCount != null && (
                                    <div className="person-insight-action person-insight-action--trim">
                                      <span className="person-insight-metric-label">减仓</span>
                                      <strong className="person-insight-metric-value">{summaryInsight.trimCount}</strong>
                                    </div>
                                  )}
                                  {summaryInsight.exitCount != null && (
                                    <div className="person-insight-action person-insight-action--exit">
                                      <span className="person-insight-metric-label">清仓</span>
                                      <strong className="person-insight-metric-value">{summaryInsight.exitCount}</strong>
                                    </div>
                                  )}
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
                        <th className="holdings-th">股票<br/><span className="holdings-th-en">Stock</span></th>
                        <th className="holdings-th holdings-th--num">仓位<br/><span className="holdings-th-en">% of Portfolio</span></th>
                        <th className="holdings-th">近期动作<br/><span className="holdings-th-en">Recent Activity</span></th>
                        <th className="holdings-th holdings-th--num">持股<br/><span className="holdings-th-en">Shares</span></th>
                        <th className="holdings-th holdings-th--num">申报价<br/><span className="holdings-th-en">Reported Price*</span></th>
                        <th className="holdings-th holdings-th--num">市值（亿）<br/><span className="holdings-th-en">Value</span></th>
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
                            <td className="holdings-td holdings-td--act">
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
                            <td className="holdings-td holdings-td--act">
                              <span className="holdings-activity-soldout">Sold Out</span>
                            </td>
                            <td className="holdings-td holdings-td--num">{formatShares(h.shares)}</td>
                            <td className="holdings-td holdings-td--num">{formatPriceFromValueAndShares(h.valueUsd, h.shares)}</td>
                            <td className="holdings-td holdings-td--num">{formatValueUsd(h.valueUsd)}</td>
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
