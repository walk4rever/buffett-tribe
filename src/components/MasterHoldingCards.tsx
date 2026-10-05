"use client";

import Link from "next/link";
import { MasterHolderTrendChart } from "@/components/MasterHolderTrendChart";
import type { ValueLineHolder } from "@/lib/value-line-data";

function formatShortFirmName(raw: string | undefined | null) {
  if (!raw) return "";
  return raw
    .replace(/,\s*(INC|LLC|L\.P\.|LP|CORP|CO\.|PLC|LTD)\.?$/i, "")
    .replace(/\s+(INC|LLC|L\.P\.|LP|CORP|PLC|LTD)\.?$/i, "")
    .trim();
}

function HolderActivity({ holder }: { holder: ValueLineHolder }) {
  if (holder.activity === "SoldOut") {
    return <span className="vl-master-act-badge vl-master-act-badge--soldout">清仓</span>;
  }
  if (holder.activity === "New") {
    return <span className="vl-master-act-badge vl-master-act-badge--new">新进</span>;
  }
  if (holder.activity === "Added") {
    const delta =
      holder.shareDeltaPct != null && Number.isFinite(holder.shareDeltaPct)
        ? `+${Math.abs(holder.shareDeltaPct).toFixed(1)}%`
        : "";
    return (
      <span className="vl-master-act-badge vl-master-act-badge--up" title={`增持 ${delta}`}>
        ↑ {delta || "增持"}
      </span>
    );
  }
  if (holder.activity === "Reduced") {
    const delta =
      holder.shareDeltaPct != null && Number.isFinite(holder.shareDeltaPct)
        ? `-${Math.abs(holder.shareDeltaPct).toFixed(1)}%`
        : "";
    return (
      <span className="vl-master-act-badge vl-master-act-badge--down" title={`减持 ${delta}`}>
        ↓ {delta || "减持"}
      </span>
    );
  }
  if (holder.activity === "Unchanged") {
    return <span className="vl-master-act-badge vl-master-act-badge--flat">持平</span>;
  }
  return <span className="vl-master-act-badge vl-master-act-badge--flat">—</span>;
}

export function MasterHoldingCards({
  holders,
  showTrends = false,
  title = "大师持仓",
  hint = "部落重仓与仓位明细",
}: {
  holders: ValueLineHolder[];
  showTrends?: boolean;
  title?: string;
  hint?: string;
}) {
  if (!holders.length) return null;

  return (
    <section className="vl-master-holdings-section" aria-label={title}>
      <div className="vl-master-section-head">
        <div className="vl-master-title-group">
          <span className="vl-master-section-title">{title}</span>
        </div>
        <span className="vl-master-section-hint">{hint}</span>
      </div>

      <div
        className={`vl-master-cards-grid${showTrends ? " vl-master-cards-grid--trends" : " vl-master-cards-grid--summary"}`}
      >
        {holders.map((holder, index) => {
          const shortFirm = formatShortFirmName(holder.firmName ?? holder.name);
          const displayName = holder.investorName || holder.name;
          const hasDistinctFirm =
            Boolean(shortFirm) && shortFirm.toLowerCase() !== displayName.toLowerCase();

          return (
            <article
              key={`${holder.tribeId ?? holder.name}-${holder.quarterLabel ?? ""}-${index}`}
              className={`vl-master-holder-card${showTrends ? " vl-master-holder-card--trend" : ""}`}
            >
              <div className="vl-master-card-main">
                <div className="vl-master-card-header">
                  <div className="vl-master-card-person">
                    {holder.tribeId ? (
                      <Link href={`/master/${holder.tribeId}`} className="vl-master-person-link">
                        <span className="vl-master-person-name">{displayName}</span>
                      </Link>
                    ) : (
                      <span className="vl-master-person-name">{displayName}</span>
                    )}
                  </div>
                  {holder.quarterLabel ? (
                    <span className="vl-master-quarter-badge">{holder.quarterLabel}</span>
                  ) : null}
                </div>

                <div className="vl-master-card-metrics">
                  <div className="vl-master-metric-cell">
                    <span className="vl-master-metric-label">仓位</span>
                    <div className="vl-master-weight-wrap">
                      <span className="vl-master-metric-val vl-master-metric-weight">
                        {holder.weightPct != null ? `${holder.weightPct}%` : "—"}
                      </span>
                    </div>
                  </div>
                  <div className="vl-master-metric-sep" />
                  <div className="vl-master-metric-cell">
                    <span className="vl-master-metric-label">金额</span>
                    <span className="vl-master-metric-val vl-master-metric-value">
                      {holder.valueLabel ?? "—"}
                    </span>
                  </div>
                  <div className="vl-master-metric-sep" />
                  <div className="vl-master-metric-cell">
                    <span className="vl-master-metric-label">动作</span>
                    <div className="vl-master-act-wrap">
                      <HolderActivity holder={holder} />
                    </div>
                  </div>
                </div>

                {hasDistinctFirm || holder.aumLabel ? (
                  <div className="vl-master-firm-tag" title={holder.name}>
                    {hasDistinctFirm ? (
                      <span className="vl-master-firm-text">{shortFirm}</span>
                    ) : (
                      <span className="vl-master-firm-empty" />
                    )}
                    {holder.aumLabel ? (
                      <span className="vl-master-aum-text" title={`13F 申报组合市值 ${holder.aumLabel}`}>
                        {holder.aumLabel}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {showTrends ? <MasterHolderTrendChart holder={holder} /> : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
