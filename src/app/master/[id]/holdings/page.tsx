import Link from "next/link";
import { notFound } from "next/navigation";
import { CompanyDisplayName } from "@/components/CompanyDisplayName";
import { SiteNav } from "@/components/SiteNav";
import { formatCompanyPathFromCik } from "@/lib/cik";
import { computeHoldingActivity, computeShareDeltaPct } from "@/lib/holding-activity";
import { getTribeMember } from "@/lib/tribe";
import {
  formatShares,
  formatValueUsd,
  getAvailableQuarters,
  getHoldingsByQuarter,
} from "@/lib/master-data";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ year?: string; quarter?: string }>;
}

function formatPriceFromValueAndShares(valueUsd: bigint | null, shares: bigint | null) {
  if (valueUsd == null || shares == null) return "—";
  const v = Number(valueUsd);
  const s = Number(shares);
  if (!Number.isFinite(v) || !Number.isFinite(s) || s <= 0) return "—";
  return `$${(v / s).toFixed(2)}`;
}

function formatSignedPct(diffPct: number | null) {
  if (diffPct == null || !Number.isFinite(diffPct)) return "—";
  const sign = diffPct > 0 ? "+" : "";
  return `${sign}${diffPct.toFixed(1)}%`;
}

function getHoldingTicker(h: Awaited<ReturnType<typeof getHoldingsByQuarter>>[number]) {
  return h.security?.ticker ?? h.security?.company?.ticker ?? null;
}

function getHoldingCompanyPath(h: Awaited<ReturnType<typeof getHoldingsByQuarter>>[number]) {
  return formatCompanyPathFromCik(h.security?.company?.cik);
}

export default async function HoldingsPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { year: yearStr, quarter: quarterStr } = await searchParams;

  const member = getTribeMember(id);
  if (!member) notFound();

  const quarters = await getAvailableQuarters(id);
  if (quarters.length === 0) notFound();

  const selectedYear = yearStr ? parseInt(yearStr) : quarters[0].year;
  const selectedQuarter = quarterStr ? parseInt(quarterStr) : quarters[0].quarter;

  const holdings = await getHoldingsByQuarter(id, selectedYear, selectedQuarter);
  const selectedIndex = quarters.findIndex((q) => q.year === selectedYear && q.quarter === selectedQuarter);
  const prevQuarter = selectedIndex >= 0 ? quarters[selectedIndex + 1] : undefined;
  const prevHoldings = prevQuarter
    ? await getHoldingsByQuarter(id, prevQuarter.year, prevQuarter.quarter)
    : [];
  const holdingKey = (h: { securityId: string | null }) => h.securityId!;
  const prevBySecurityId = new Map(prevHoldings.map((h) => [holdingKey(h), h] as const));
  const currentKeySet = new Set(holdings.map((h) => holdingKey(h)));
  const soldOutRows = prevHoldings.filter((h) => !currentKeySet.has(holdingKey(h)));

  const totalValue = holdings.reduce(
    (sum, h) => sum + (h.valueUsd ? Number(h.valueUsd) : 0),
    0,
  );

  return (
    <div className="holdings-page">
      <SiteNav />

      <div className="holdings-wrap">
        {/* Person header */}
        <div className="holdings-hd">
          <span className="holdings-avatar" style={{ background: member.color }}>
            {member.initials.slice(0, 2)}
          </span>
          <div className="holdings-hd-info">
            <p className="holdings-eyebrow">持仓快照</p>
            <h1 className="holdings-name">{member.nameZh}</h1>
            <p className="holdings-firm">{member.firm}</p>
            {member.category === "alpha" ? (
              <p className="holdings-firm">Alpha 投资人 · 13F 仅覆盖公开市场披露仓位</p>
            ) : null}
          </div>
        </div>

        <div className="holdings-layout">
          {/* Quarter selector timeline */}
          <aside className="holdings-sidebar">
            <div className="holdings-timeline-wrap">
              <div className="holdings-timeline-line" />
              <div className="holdings-timeline">
                {quarters.map((q) => {
                  const active = q.year === selectedYear && q.quarter === selectedQuarter;
                  return (
                    <Link
                      key={`${q.year}-${q.quarter}`}
                      href={`/master/${id}/holdings?year=${q.year}&quarter=${q.quarter}`}
                      className={`holdings-timeline-node${active ? " holdings-timeline-node--active" : ""}`}
                      style={active ? { borderColor: member.color, color: member.color } : undefined}
                    >
                      <span className="holdings-timeline-dot" />
                      <span className="holdings-timeline-label">{q.year} Q{q.quarter}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          </aside>

          <section className="holdings-main">
            {/* Summary bar */}
            <div className="holdings-summary">
              <span className="holdings-summary-item">
                <em>{holdings.length}</em> 持仓
              </span>
              <span className="holdings-summary-sep">·</span>
              <span className="holdings-summary-item">
                <em>{soldOutRows.length}</em> 已清仓
              </span>
              <span className="holdings-summary-sep">·</span>
              <span className="holdings-summary-item">
                总计 <em>{formatValueUsd(BigInt(Math.round(totalValue)))}</em>
              </span>
              <span className="holdings-summary-sep">·</span>
              <span className="holdings-summary-item">
                {selectedYear} Q{selectedQuarter} · 数据来源 SEC 13F
              </span>
            </div>

            {/* Holdings table */}
            <div className="holdings-table-wrap holdings-table-wrap--fit">
              <table className="holdings-table holdings-table--fit">
            <thead>
              <tr>
                <th className="holdings-th holdings-th--rank">#</th>
                <th className="holdings-th">股票<br/><span className="holdings-th-en">Stock</span></th>
                <th className="holdings-th holdings-th--num">仓位<br/><span className="holdings-th-en">% of Portfolio</span></th>
                <th className="holdings-th">近期动作<br/><span className="holdings-th-en">Recent Activity</span></th>
                <th className="holdings-th holdings-th--num">持股<br/><span className="holdings-th-en">Shares</span></th>
                <th className="holdings-th holdings-th--num">申报价<br/><span className="holdings-th-en">Reported Price*</span></th>
                <th className="holdings-th holdings-th--num">市值（亿）<br/><span className="holdings-th-en">Value</span></th>
                <th className="holdings-th holdings-th--num">现价<br/><span className="holdings-th-en">Current Price</span></th>
                <th className="holdings-th holdings-th--num">较申报价<br/><span className="holdings-th-en">+/- Reported Price</span></th>
                <th className="holdings-th holdings-th--num">52周低点<br/><span className="holdings-th-en">52 Week Low</span></th>
                <th className="holdings-th holdings-th--num">52周高点<br/><span className="holdings-th-en">52 Week High</span></th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((h, i) => {
                const prev = prevBySecurityId.get(holdingKey(h));
                const shareDeltaPct = computeShareDeltaPct(prev?.shares, h.shares);
                const activity = computeHoldingActivity(Boolean(prevQuarter), Boolean(prev), shareDeltaPct);
                const rowClass =
                  activity === "New"
                    ? "holdings-row holdings-row--new"
                    : activity === "Added"
                      ? "holdings-row holdings-row--added"
                      : activity === "Reduced"
                        ? "holdings-row holdings-row--reduced"
                        : "holdings-row";

                const reportedPrice = formatPriceFromValueAndShares(h.valueUsd, h.shares);
                const currentPrice = "—";
                const pctVsReported = "—";
                const low52 = "—";
                const high52 = "—";
                const meta = (h.security?.metadata ?? {}) as { nameZh?: string; nameEnShort?: string };
                const company = h.security?.company;
                const zhName = meta.nameZh ?? company?.canonicalName ?? h.security?.ticker ?? "-";
                const enName = meta.nameEnShort ?? company?.canonicalName ?? h.security?.ticker ?? "-";

                return (
                  <tr key={h.id} className={rowClass}>
                    <td className="holdings-td holdings-td--rank">{i + 1}</td>
                    <td className="holdings-td holdings-td--name">
                      <span className="holdings-company">
                        {getHoldingCompanyPath(h) ? (
                          <Link href={getHoldingCompanyPath(h)!}>
                            <CompanyDisplayName
                              zhName={zhName}
                              enName={enName}
                              ticker={getHoldingTicker(h)}
                              compact
                            />
                          </Link>
                        ) : (
                          <CompanyDisplayName
                            zhName={zhName}
                            enName={enName}
                            ticker={getHoldingTicker(h)}
                            compact
                          />
                        )}
                      </span>
                    </td>
                    <td className="holdings-td holdings-td--num">
                      <div className="holdings-pct-wrap">
                        <span className="holdings-pct">
                          {h.percentOfPortfolio != null
                            ? `${h.percentOfPortfolio.toFixed(2)}%`
                            : "—"}
                        </span>
                        <div
                          className="holdings-bar"
                          style={{
                            width: `${Math.min(h.percentOfPortfolio ?? 0, 100)}%`,
                            background: member.color,
                          }}
                        />
                      </div>
                    </td>
                    <td className="holdings-td holdings-td--act">
                      {activity === "New" ? (
                        <span className="holdings-activity-new">New</span>
                      ) : activity === "Added" ? (
                        <span className="holdings-activity-delta holdings-activity-delta--up">
                          ↑ {shareDeltaPct != null ? formatSignedPct(shareDeltaPct) : "—"}
                        </span>
                      ) : activity === "Reduced" ? (
                        <span className="holdings-activity-delta holdings-activity-delta--down">
                          ↓ {shareDeltaPct != null ? formatSignedPct(shareDeltaPct) : "—"}
                        </span>
                      ) : (
                        <span className="holdings-activity-delta">—</span>
                      )}
                    </td>
                    <td className="holdings-td holdings-td--num">{formatShares(h.shares)}</td>
                    <td className="holdings-td holdings-td--num">{reportedPrice}</td>
                    <td className="holdings-td holdings-td--num">{formatValueUsd(h.valueUsd)}</td>
                    <td className="holdings-td holdings-td--num">{currentPrice}</td>
                    <td className="holdings-td holdings-td--num">{pctVsReported}</td>
                    <td className="holdings-td holdings-td--num">{low52}</td>
                    <td className="holdings-td holdings-td--num">{high52}</td>
                  </tr>
                );
              })}
              {soldOutRows.map((h, i) => {
                const meta = (h.security?.metadata ?? {}) as { nameZh?: string; nameEnShort?: string };
                const company = h.security?.company;
                const zhName = meta.nameZh ?? company?.canonicalName ?? h.security?.ticker ?? "-";
                const enName = meta.nameEnShort ?? company?.canonicalName ?? h.security?.ticker ?? "-";
                const reportedPrice = formatPriceFromValueAndShares(h.valueUsd, h.shares);
                return (
                  <tr key={`exit-${h.id}`} className="holdings-row holdings-row--soldout">
                    <td className="holdings-td holdings-td--rank">{holdings.length + i + 1}</td>
                    <td className="holdings-td holdings-td--name">
                      <span className="holdings-company">
                        {getHoldingCompanyPath(h) ? (
                          <Link href={getHoldingCompanyPath(h)!}>
                            <CompanyDisplayName
                              zhName={zhName}
                              enName={enName}
                              ticker={getHoldingTicker(h)}
                              compact
                            />
                          </Link>
                        ) : (
                          <CompanyDisplayName
                            zhName={zhName}
                            enName={enName}
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
                    <td className="holdings-td holdings-td--num">{reportedPrice}</td>
                    <td className="holdings-td holdings-td--num">{formatValueUsd(h.valueUsd)}</td>
                    <td className="holdings-td holdings-td--num">—</td>
                    <td className="holdings-td holdings-td--num">—</td>
                    <td className="holdings-td holdings-td--num">—</td>
                    <td className="holdings-td holdings-td--num">—</td>
                  </tr>
                );
              })}
            </tbody>
              </table>
            </div>
          </section>
        </div>

        <p className="holdings-note">
          数据来源：SEC EDGAR 13F-HR · 数值为申报日市值，不构成投资建议
          {member.category === "alpha" ? " · Atreides 可能持有未在 13F 中披露的私募投资、空头或其他非披露资产" : ""}
        </p>
      </div>
    </div>
  );
}
