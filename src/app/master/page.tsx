import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";
import { ALPHA_TRIBE_MEMBERS, CORE_TRIBE_MEMBERS, getTribeMemberColor, TRIBE_MEMBERS } from "@/lib/tribe";
import { getAvailableQuarters, getLatestPortfolioValueUsd } from "@/lib/master-data";
import { formatUsdInYi } from "@/lib/currency";

export const dynamic = "force-dynamic";

function logMasterIndexFallback(scope: string, err: unknown) {
  if (process.env.DEBUG_DB_FALLBACK !== "1") return;
  const message = err instanceof Error ? err.message : String(err);
  console.warn(`[master-index:${scope}] DB query failed, fallback to empty result: ${message}`);
}

async function getMasterMemberStates() {
  try {
    return await Promise.all(
      TRIBE_MEMBERS.map(async (m) => {
        const [quarters, portfolioValueUsd] = await Promise.all([
          getAvailableQuarters(m.id),
          getLatestPortfolioValueUsd(m.id),
        ]);
        return {
          id: m.id,
          latestQuarter: quarters[0] ?? null,
          aum: portfolioValueUsd != null ? `$${formatUsdInYi(portfolioValueUsd)}` : null,
        };
      })
    );
  } catch (err) {
    logMasterIndexFallback("memberStates", err);
    return TRIBE_MEMBERS.map((m) => ({
      id: m.id,
      latestQuarter: null,
      aum: null,
    }));
  }
}

export default async function MasterIndexPage() {
  const memberStates = await getMasterMemberStates();
  const stateMap = new Map(memberStates.map((s) => [s.id, s]));

  return (
    <div className="home-v2 master-page">
      <SiteNav />

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
                        style={{ background: getTribeMemberColor(m) }}
                      >
                        {m.initials.slice(0, 2)}
                      </span>
                      <div className="home-member-info">
                        <div className="home-member-name">{m.nameZh}</div>
                        <div className="home-member-firm">{m.firm}</div>
                      </div>
                      {state.aum && <span className="home-member-aum">{state.aum}</span>}
                    </div>
                  </Link>
                  <div className="home-member-links">
                    <Link href={`/master/${m.id}#library`} className="home-member-link">
                      <span className="home-member-link-icon">🧠</span>
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
              <p className="home-members-hd home-members-hd--alpha">Alpha部落</p>
              <div className="home-member-list home-member-list--alpha">
                {ALPHA_TRIBE_MEMBERS.map((m) => {
                  const state = stateMap.get(m.id);
                  return (
                    <div key={m.id} className="home-member-card home-member-card--alpha">
                      <Link href={`/master/${m.id}`} className="home-member-main">
                        <div className="home-member-top">
                          <span
                            className="home-member-avatar"
                            style={{ background: getTribeMemberColor(m) }}
                          >
                            {m.initials.slice(0, 2)}
                          </span>
                          <div className="home-member-info">
                            <div className="home-member-name">{m.nameZh}</div>
                            <div className="home-member-firm">{m.firm}</div>
                          </div>
                          {state?.aum && <span className="home-member-aum">{state.aum}</span>}
                        </div>
                      </Link>
                      <div className="home-member-links">
                        <Link href={`/master/${m.id}#library`} className="home-member-link">
                          <span className="home-member-link-icon">🧠</span>
                          <span className="home-member-link-text">
                            资料库
                            <em>{m.materialSub}</em>
                          </span>
                        </Link>
                        {state?.latestQuarter ? (
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
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
