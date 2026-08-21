import { getPutCallBadgeLabel, getSecurityKindBadgeLabel } from "@/lib/security-kind";

type CompanyDisplayNameProps = {
  zhName: string;
  enName: string;
  ticker?: string | null;
  className?: string;
  compact?: boolean;
  securityKind?: string | null;
  putCall?: string | null;
};

export function CompanyDisplayName({
  zhName,
  enName,
  ticker,
  className,
  compact = false,
  securityKind,
  putCall,
}: CompanyDisplayNameProps) {
  const code = ticker?.trim() ? ticker.trim().toUpperCase() : null;
  const kindBadgeLabel = getSecurityKindBadgeLabel(securityKind);
  const putCallBadgeLabel = getPutCallBadgeLabel(putCall);
  const classes = [
    "company-display",
    compact ? "company-display--compact" : "",
    className ?? "",
  ].filter(Boolean).join(" ");

  return (
    <span className={classes}>
      <span className="company-display-zh">
        {code ? `${zhName}（${code}）` : zhName}
        {putCallBadgeLabel ? <span className="company-display-kind-badge">{putCallBadgeLabel}</span> : null}
        {kindBadgeLabel ? <span className="company-display-kind-badge">{kindBadgeLabel}</span> : null}
      </span>
      <span className="company-display-en">{enName}</span>
    </span>
  );
}
