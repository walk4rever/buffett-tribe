import Link from "next/link";
import { notFound } from "next/navigation";
import { HoldingsDetailTable, type HoldingsDetailRow } from "@/components/HoldingsDetailTable";
import { HoldingsHistoryExplorer } from "@/components/HoldingsHistoryExplorer";
import { SiteNav } from "@/components/SiteNav";
import { computeHoldingActivity, computeShareDeltaPct } from "@/lib/holding-activity";
import { getTribeMember, getTribeMemberColor } from "@/lib/tribe";
import {
  formatValueUsd,
  getAvailableQuarters,
  getHoldingCompanyPath,
  getHoldingDisplayNames,
  getHoldingsByQuarter,
  getHoldingsHistoryBySecurity,
  getHoldingTicker,
  holdingSecurityPutCallKey,
  quarterMidDate,
} from "@/lib/master-data";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ year?: string; quarter?: string; view?: string }>;
}

export default async function HoldingsPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { year: yearStr, quarter: quarterStr, view: viewParam } = await searchParams;
  const view = viewParam === "company" ? "company" : "quarter";

  const member = await getTribeMember(id);
  if (!member) notFound();

  const quarters = await getAvailableQuarters(id);
  if (quarters.length === 0) notFound();

  const selectedYear = yearStr ? parseInt(yearStr) : quarters[0].year;
  const selectedQuarter = quarterStr ? parseInt(quarterStr) : quarters[0].quarter;

  if (view === "company") {
    const historyItems = await getHoldingsHistoryBySecurity(id);
    // Ascending, one entry per fund quarter — lets the chart pad with whitespace
    // points so every company's x-axis spans the fund's full history, not just
    // that company's own held-quarters range.
    const allQuarterTimes = [...quarters].reverse().map((q) => quarterMidDate(q.year, q.quarter));
    return (
      <div className="holdings-page">
        <SiteNav />
        <div className="holdings-wrap">
          <Link href={`/master/${id}`} className="holdings-hd">
            <span className="holdings-avatar" style={{ background: getTribeMemberColor(member) }}>
              {member.initials.slice(0, 2)}
            </span>
            <div className="holdings-hd-info">
              <p className="holdings-eyebrow">持仓快照</p>
              <h1 className="holdings-name">{member.nameZh}</h1>
              <p className="holdings-firm">{member.firm}</p>
              {member.category === "alpha" ? (
                <p className="holdings-firm">Alpha 部落 · 13F 仅覆盖公开市场披露仓位</p>
              ) : null}
            </div>
          </Link>

          <div className="holdings-view-toggle">
            <Link
              href={`/master/${id}/holdings?view=quarter&year=${selectedYear}&quarter=${selectedQuarter}`}
              className="holdings-view-toggle-btn"
            >
              按季度
            </Link>
            <Link
              href={`/master/${id}/holdings?view=company`}
              className="holdings-view-toggle-btn holdings-view-toggle-btn--active"
              style={{ borderColor: getTribeMemberColor(member), color: getTribeMemberColor(member) }}
            >
              按公司
            </Link>
          </div>

          <HoldingsHistoryExplorer
            items={historyItems}
            accentColor={getTribeMemberColor(member)}
            allQuarterTimes={allQuarterTimes}
          />

          <p className="holdings-note">
            数据来源：SEC EDGAR 13F-HR · 数值为申报日市值，不构成投资建议
            {member.category === "alpha" ? " · Atreides 可能持有未在 13F 中披露的私募投资、空头或其他非披露资产" : ""}
          </p>
        </div>
      </div>
    );
  }

  const holdings = await getHoldingsByQuarter(id, selectedYear, selectedQuarter);
  const selectedIndex = quarters.findIndex((q) => q.year === selectedYear && q.quarter === selectedQuarter);
  const prevQuarter = selectedIndex >= 0 ? quarters[selectedIndex + 1] : undefined;
  const prevHoldings = prevQuarter
    ? await getHoldingsByQuarter(id, prevQuarter.year, prevQuarter.quarter)
    : [];
  const holdingKey = holdingSecurityPutCallKey;
  const prevBySecurityId = new Map(prevHoldings.map((h) => [holdingKey(h), h] as const));
  const currentKeySet = new Set(holdings.map((h) => holdingKey(h)));
  const soldOutRows = prevHoldings.filter((h) => !currentKeySet.has(holdingKey(h)));

  const totalValue = holdings.reduce(
    (sum, h) => sum + (h.valueUsd ? Number(h.valueUsd) : 0),
    0,
  );

  const toDetailRow = (
    h: (typeof holdings)[number],
    activity: HoldingsDetailRow["activity"],
    shareDeltaPct: number | null,
  ): HoldingsDetailRow => {
    const { zhName, enName } = getHoldingDisplayNames(h);
    return {
      id: activity === "SoldOut" ? `exit-${h.id}` : h.id,
      zhName,
      enName,
      ticker: getHoldingTicker(h),
      companyPath: getHoldingCompanyPath(h),
      securityKind: h.security?.kind,
      putCall: h.putCall,
      percentOfPortfolio: h.percentOfPortfolio,
      shares: h.shares,
      valueUsd: h.valueUsd,
      activity,
      shareDeltaPct,
    };
  };
  const currentDetailRows = holdings.map((h) => {
    const prev = prevBySecurityId.get(holdingKey(h));
    const shareDeltaPct = computeShareDeltaPct(prev?.shares, h.shares);
    const activity = computeHoldingActivity(Boolean(prevQuarter), Boolean(prev), shareDeltaPct);
    return toDetailRow(h, activity, shareDeltaPct);
  });
  const soldOutDetailRows = soldOutRows.map((h) => toDetailRow(h, "SoldOut", null));
  // Real equity holdings and option legs (see scripts/lib/13f-import-core.ts —
  // a 13F option position reuses its underlying stock's CUSIP) render as two
  // separate sections rather than one interleaved-by-size table.
  const equityDetailRows = [...currentDetailRows, ...soldOutDetailRows].filter((r) => r.putCall === "NONE");
  const optionDetailRows = [...currentDetailRows, ...soldOutDetailRows].filter((r) => r.putCall !== "NONE");

  return (
    <div className="holdings-page">
      <SiteNav />

      <div className="holdings-wrap">
        {/* Person header */}
        <Link href={`/master/${id}`} className="holdings-hd">
          <span className="holdings-avatar" style={{ background: getTribeMemberColor(member) }}>
            {member.initials.slice(0, 2)}
          </span>
          <div className="holdings-hd-info">
            <p className="holdings-eyebrow">持仓快照</p>
            <h1 className="holdings-name">{member.nameZh}</h1>
            <p className="holdings-firm">{member.firm}</p>
            {member.category === "alpha" ? (
              <p className="holdings-firm">Alpha 部落 · 13F 仅覆盖公开市场披露仓位</p>
            ) : null}
          </div>
        </Link>

        <div className="holdings-view-toggle">
          <Link
            href={`/master/${id}/holdings?view=quarter&year=${selectedYear}&quarter=${selectedQuarter}`}
            className="holdings-view-toggle-btn holdings-view-toggle-btn--active"
            style={{ borderColor: getTribeMemberColor(member), color: getTribeMemberColor(member) }}
          >
            按季度
          </Link>
          <Link
            href={`/master/${id}/holdings?view=company&year=${selectedYear}&quarter=${selectedQuarter}`}
            className="holdings-view-toggle-btn"
          >
            按公司
          </Link>
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
                      style={active ? { borderColor: getTribeMemberColor(member), color: getTribeMemberColor(member) } : undefined}
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
            <HoldingsDetailTable rows={equityDetailRows} accentColor={getTribeMemberColor(member)} />

            {optionDetailRows.length > 0 ? (
              <>
                <h3 className="holdings-detail-section-title">期权等衍生品操作</h3>
                <HoldingsDetailTable rows={optionDetailRows} accentColor={getTribeMemberColor(member)} />
              </>
            ) : null}
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
