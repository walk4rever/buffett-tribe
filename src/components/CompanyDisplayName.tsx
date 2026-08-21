import { getSecurityKindBadgeLabel } from "@/lib/security-kind";

type CompanyDisplayNameProps = {
  zhName: string;
  enName: string;
  ticker?: string | null;
  className?: string;
  compact?: boolean;
  securityKind?: string | null;
};

export function CompanyDisplayName({
  zhName,
  enName,
  ticker,
  className,
  compact = false,
  securityKind,
}: CompanyDisplayNameProps) {
  const code = ticker?.trim() ? ticker.trim().toUpperCase() : null;
  const badgeLabel = getSecurityKindBadgeLabel(securityKind);
  const classes = [
    "company-display",
    compact ? "company-display--compact" : "",
    className ?? "",
  ].filter(Boolean).join(" ");

  return (
    <span className={classes}>
      <span className="company-display-zh">
        {code ? `${zhName}（${code}）` : zhName}
        {badgeLabel ? <span className="company-display-kind-badge">{badgeLabel}</span> : null}
      </span>
      <span className="company-display-en">{enName}</span>
    </span>
  );
}
