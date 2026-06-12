import Link from "next/link";
import { formatCompanyPathFromCik } from "@/lib/cik";
import { SiteNav } from "@/components/SiteNav";
import { HeroSearch } from "@/components/HeroSearch";
import { ALPHA_TRIBE_MEMBERS, CORE_TRIBE_MEMBERS, formatAumForHome, TRIBE_MEMBERS } from "@/lib/tribe";
import { getLatestHomeSignalCards } from "@/lib/home-signals";
import { getAvailableQuarters } from "@/lib/master-data";

export const dynamic = "force-dynamic";

function logHomeFallback(scope: string, err: unknown) {
  if (process.env.DEBUG_DB_FALLBACK !== "1") return;
  const message = err instanceof Error ? err.message : String(err);
  console.warn(`[home:${scope}] DB query failed, fallback to empty result: ${message}`);
}

async function getHomeMemberStates() {
  try {
    return await Promise.all(
      TRIBE_MEMBERS.map(async (m) => {
        const quarters = await getAvailableQuarters(m.id);
        return {
          id: m.id,
          latestQuarter: quarters[0] ?? null,
        };
      })
    );
  } catch (err) {
    logHomeFallback("memberStates", err);
    return TRIBE_MEMBERS.map((m) => ({
      id: m.id,
      latestQuarter: null,
    }));
  }
}

export default async function Home() {
  const [signals, memberStates] = await Promise.all([
    getLatestHomeSignalCards(),
    getHomeMemberStates(),
  ]);

  const stateMap = new Map(memberStates.map((s) => [s.id, s]));

  return (
    <div className="home-v2">
      <SiteNav />

      {/* Signals */}
      <section className="home-signals">
        <div className="home-signals-in">
          {signals.map((s) => (
            <div key={s.ticker} className={`home-sig home-sig--${s.type}`}>
              <span className="home-sig-tag">{s.tag}</span>
              <Link href={formatCompanyPathFromCik(s.cik) ?? "#"} className="home-sig-ticker">
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
        </div>
      </section>

      {/* Hero search */}
      <section className="home-hero">
        <Link href="/idea" className="home-hero-hitbox" aria-label="进入对话研究室" />
        <h1 className="home-hero-brand">买股票就是买公司</h1>
        <p className="home-hero-sub home-hero-sub--compact">
          用大师的框架，看懂一家公司
        </p>
        <HeroSearch />
      </section>

      {/* Members */}
      <section className="home-members">
        <div className="home-members-in">
          <p className="home-members-hd">巴菲特部落</p>
          <div className="home-member-list">
            {CORE_TRIBE_MEMBERS.map((m) => {
              const state = stateMap.get(m.id)!;
              return (
                <div key={m.id} className="home-member-card">
                  <Link href={`/master/${m.id}`} className="home-member-main">
                    <div className="home-member-top">
                      <span
                        className="home-member-avatar"
                        style={{ background: m.color }}
                      >
                        {m.initials.slice(0, 2)}
                      </span>
                      <div className="home-member-info">
                        <div className="home-member-name">{m.nameZh}</div>
                        <div className="home-member-firm">{m.firm}</div>
                      </div>
                      {m.aum && <span className="home-member-aum">{formatAumForHome(m.aum) ?? m.aum}</span>}
                    </div>
                  </Link>
                  <div className="home-member-links">
                    <Link href={`/master/${m.id}#library`} className="home-member-link">
                      <span className="home-member-link-icon">{m.icon}</span>
                      <span className="home-member-link-text">
                        资料库
                        <em>{m.materialSub}</em>
                      </span>
                    </Link>
                    {state.latestQuarter ? (
                      <Link href={`/master/${m.id}#holdings`} className="home-member-link">
                        <span className="home-member-link-icon">📊</span>
                        <span className="home-member-link-text">
                          最新持仓
                          <em>{state.latestQuarter.year} Q{state.latestQuarter.quarter}</em>
                        </span>
                      </Link>
                    ) : (
                      <span className="home-member-link home-member-link--disabled">
                        <span className="home-member-link-icon">📊</span>
                        <span className="home-member-link-text">
                          最新持仓
                          <em>暂无数据</em>
                        </span>
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {ALPHA_TRIBE_MEMBERS.length > 0 ? (
            <div className="home-alpha-block">
              <p className="home-members-hd home-members-hd--alpha">Alpha投资人</p>
              <div className="home-member-list home-member-list--alpha">
                {ALPHA_TRIBE_MEMBERS.map((m) => {
                  const state = stateMap.get(m.id);
                  return (
                    <div key={m.id} className="home-member-card home-member-card--alpha">
                      <Link href={`/master/${m.id}`} className="home-member-main">
                        <div className="home-member-top">
                          <span
                            className="home-member-avatar"
                            style={{ background: m.color }}
                          >
                            {m.initials.slice(0, 2)}
                          </span>
                          <div className="home-member-info">
                            <div className="home-member-name">{m.nameZh}</div>
                            <div className="home-member-firm">{m.firm}</div>
                          </div>
                          {m.aum && <span className="home-member-aum">{formatAumForHome(m.aum) ?? m.aum}</span>}
                        </div>
                      </Link>
                      <div className="home-member-links">
                        {state?.latestQuarter ? (
                          <Link href={`/master/${m.id}#holdings`} className="home-member-link">
                            <span className="home-member-link-icon">A</span>
                            <span className="home-member-link-text">
                              最新 13F
                              <em>{state.latestQuarter.year} Q{state.latestQuarter.quarter}</em>
                            </span>
                          </Link>
                        ) : (
                          <span className="home-member-link home-member-link--disabled">
                            <span className="home-member-link-icon">A</span>
                            <span className="home-member-link-text">
                              最新 13F
                              <em>暂无数据</em>
                            </span>
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </section>

    </div>
  );
}
