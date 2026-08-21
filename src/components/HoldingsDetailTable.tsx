import Link from "next/link";
import { CompanyDisplayName } from "@/components/CompanyDisplayName";
import { formatPriceFromValueAndShares, formatShares, formatValueUsd } from "@/lib/master-data";
import type { HoldingActivity } from "@/lib/holding-activity";

export type HoldingsDetailRow = {
  id: string;
  zhName: string;
  enName: string;
  ticker: string | null;
  companyPath: string | null;
  securityKind: string | null | undefined;
  putCall: string;
  percentOfPortfolio: number | null;
  shares: bigint | null;
  valueUsd: bigint | null;
  activity: HoldingActivity | "SoldOut";
  shareDeltaPct: number | null;
};

function formatSignedPct(diffPct: number | null) {
  if (diffPct == null || !Number.isFinite(diffPct)) return "—";
  const sign = diffPct > 0 ? "+" : "";
  return `${sign}${diffPct.toFixed(1)}%`;
}

function activityRowClass(activity: HoldingsDetailRow["activity"]): string {
  switch (activity) {
    case "New":
      return "holdings-row holdings-row--new";
    case "Added":
      return "holdings-row holdings-row--added";
    case "Reduced":
      return "holdings-row holdings-row--reduced";
    case "SoldOut":
      return "holdings-row holdings-row--soldout";
    default:
      return "holdings-row";
  }
}

// Shared by both the master hub page's inline "持仓明细" table and the
// standalone /master/[id]/holdings by-quarter table — a filer can hold both
// a section of real equity rows and a section of option-leg rows (see
// scripts/lib/13f-import-core.ts on why they're never merged into one row),
// so callers render this component once per section rather than passing a
// putCall filter down into it.
export function HoldingsDetailTable({
  rows,
  accentColor,
  wrapClassName,
  tableClassName,
}: {
  rows: HoldingsDetailRow[];
  // When provided, the % column renders a colored progress bar (the
  // dedicated /holdings page's look); omitted, it's plain text (the master
  // hub page's inline table look) — preserves each surface's existing style.
  accentColor?: string;
  // Extra class appended to the wrapper div — e.g. the master hub page's
  // "person-holdings-table-wrap" no-horizontal-scroll override. Must land on
  // this same div (not a wrapping element) since overflow-x doesn't cascade
  // to descendants.
  wrapClassName?: string;
  // Extra class appended to the <table> — e.g. the master hub page's
  // "person-holdings-table" column-width overrides.
  tableClassName?: string;
}) {
  if (!rows.length) return null;

  return (
    <div className={["holdings-table-wrap", "holdings-table-wrap--fit", wrapClassName].filter(Boolean).join(" ")}>
      <table className={["holdings-table", "holdings-table--fit", tableClassName].filter(Boolean).join(" ")}>
        <thead>
          <tr>
            <th className="holdings-th holdings-th--rank">#</th>
            <th className="holdings-th">股票<br /><span className="holdings-th-en">Stock</span></th>
            <th className="holdings-th holdings-th--num">仓位<br /><span className="holdings-th-en">% of Portfolio</span></th>
            <th className="holdings-th">近期动作<br /><span className="holdings-th-en">Recent Activity</span></th>
            <th className="holdings-th holdings-th--num">持股<br /><span className="holdings-th-en">Shares</span></th>
            <th className="holdings-th holdings-th--num">申报价<br /><span className="holdings-th-en">Reported Price*</span></th>
            <th className="holdings-th holdings-th--num">市值（亿）<br /><span className="holdings-th-en">Value</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((h, i) => {
            const pctDisplay = h.activity === "SoldOut"
              ? "0.00%"
              : h.percentOfPortfolio != null
                ? `${h.percentOfPortfolio.toFixed(2)}%`
                : "—";
            const pctForBar = h.activity === "SoldOut" ? 0 : h.percentOfPortfolio ?? 0;

            return (
              <tr key={h.id} className={activityRowClass(h.activity)}>
                <td className="holdings-td holdings-td--rank">{i + 1}</td>
                <td className="holdings-td holdings-td--name">
                  <span className="holdings-company">
                    {h.companyPath ? (
                      <Link href={h.companyPath}>
                        <CompanyDisplayName
                          zhName={h.zhName}
                          enName={h.enName}
                          ticker={h.ticker}
                          securityKind={h.securityKind}
                          putCall={h.putCall}
                          compact
                        />
                      </Link>
                    ) : (
                      <CompanyDisplayName
                        zhName={h.zhName}
                        enName={h.enName}
                        ticker={h.ticker}
                        securityKind={h.securityKind}
                        putCall={h.putCall}
                        compact
                      />
                    )}
                  </span>
                </td>
                <td className="holdings-td holdings-td--num">
                  {accentColor ? (
                    <div className="holdings-pct-wrap">
                      <span className="holdings-pct">{pctDisplay}</span>
                      <div
                        className="holdings-bar"
                        style={{ width: `${Math.min(pctForBar, 100)}%`, background: accentColor }}
                      />
                    </div>
                  ) : (
                    pctDisplay
                  )}
                </td>
                <td className="holdings-td holdings-td--act">
                  {h.activity === "SoldOut" ? (
                    <span className="holdings-activity-soldout">Sold Out</span>
                  ) : h.activity === "New" ? (
                    <span className="holdings-activity-new">New</span>
                  ) : h.activity === "Added" ? (
                    <span className="holdings-activity-delta holdings-activity-delta--up">
                      ↑ {formatSignedPct(h.shareDeltaPct)}
                    </span>
                  ) : h.activity === "Reduced" ? (
                    <span className="holdings-activity-delta holdings-activity-delta--down">
                      ↓ {formatSignedPct(h.shareDeltaPct)}
                    </span>
                  ) : (
                    <span className="holdings-activity-delta">—</span>
                  )}
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
  );
}
