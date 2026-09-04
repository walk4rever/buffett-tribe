import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";
import { getTribeMemberColor, getTribeMembers, type TribeMember } from "@/lib/tribe";
import { getAvailableQuarters, getLatestPortfolioValueUsd } from "@/lib/master-data";
import { formatUsdInYi } from "@/lib/currency";
import { BRAND_ZH } from "@/lib/brand";

export const dynamic = "force-dynamic";

function logMasterIndexFallback(scope: string, err: unknown) {
  if (process.env.DEBUG_DB_FALLBACK !== "1") return;
  const message = err instanceof Error ? err.message : String(err);
  console.warn(`[master-index:${scope}] DB query failed, fallback to empty result: ${message}`);
}

async function getMasterMemberStates(members: TribeMember[]) {
  try {
    return await Promise.all(
      members.map(async (m) => {
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
    return members.map((m) => ({
      id: m.id,
      latestQuarter: null,
      aum: null,
    }));
  }
}

export default async function MasterIndexPage() {
  const members = await getTribeMembers();
  const coreMembers = members.filter((m) => m.category === "core");
  // A-Z by display name, not onboarding order — unlike the core tribe (fixed
  // small set), Alpha investors are added over time and onboarding order
  // isn't a meaningful sort for readers.
  const alphaMembers = members
    .filter((m) => m.category === "alpha")
    .sort((a, b) => a.nameZh.localeCompare(b.nameZh));
  const memberStates = await getMasterMemberStates(members);
  const stateMap = new Map(memberStates.map((s) => [s.id, s]));

  return (
    <div className="home-v2 master-page">
      <SiteNav />

      {/* Members */}
      <section className="home-members">
        <div className="home-members-in">
          <p className="home-members-hd">{BRAND_ZH}</p>
          <div className="home-member-list">
            {coreMembers.map((m) => {
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
                        <div className="home-member-name" title={m.nameZh}>{m.nameZh}</div>
                        <div className="home-member-firm" title={m.firm}>{m.firm}</div>
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
          {alphaMembers.length > 0 ? (
            <div className="home-alpha-block">
              <p className="home-members-hd home-members-hd--alpha">Alpha部落</p>
              <div className="home-member-list home-member-list--alpha">
                {alphaMembers.map((m) => {
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
                            <div className="home-member-name" title={m.nameZh}>{m.nameZh}</div>
                            <div className="home-member-firm" title={m.firm}>{m.firm}</div>
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
