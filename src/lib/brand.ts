/**
 * Brand identity — single source of truth for the product name.
 *
 * Renamed from 巴菲特部落 / Buffett Tribe on 2026-08-30. Keep every
 * user-visible occurrence importing from here so the next rename is one edit.
 *
 * NOT covered here (deliberately — these are internal identifiers, changing
 * them breaks live data or deployment):
 *   - R2 object key prefix `buffett-tribe/...` (src/lib/r2.ts)
 *   - PM2 process / remote dir `pi-gateway-buffett-tribe` (services/pi-gateway/deploy.sh)
 *   - package.json name, repo name
 *
 * The site domain is NOT here either — it lives in src/lib/site-url.ts
 * (vt.air7.fun since 2026-08-30).
 */
export const BRAND_ZH = "价值部落";
export const BRAND_EN = "Value Tribe";
export const BRAND_FULL = `${BRAND_ZH} · ${BRAND_EN}`;

/**
 * Default sender address for transactional & announcement emails.
 * Always resolves to `价值部落 <vt@air7.fun>` unless overridden with a non-legacy address.
 */
export function getEmailSender(): string {
  const fromEnv = process.env.RESEND_FROM?.trim();
  if (fromEnv && !fromEnv.toLowerCase().includes("buffet")) {
    return fromEnv.includes("<") ? fromEnv : `${BRAND_ZH} <${fromEnv}>`;
  }
  return `${BRAND_ZH} <vt@air7.fun>`;
}

/**
 * Default reply-to address for emails.
 * Defaults to `价值部落 <vt@air7.fun>` unless overridden via RESEND_REPLY_TO.
 */
export function getEmailReplyTo(): string {
  const replyEnv = process.env.RESEND_REPLY_TO?.trim();
  if (replyEnv && !replyEnv.toLowerCase().includes("buffet")) {
    return replyEnv.includes("<") ? replyEnv : `${BRAND_ZH} <${replyEnv}>`;
  }
  return `${BRAND_ZH} <vt@air7.fun>`;
}

const BLOCKED_TEST_DOMAINS = new Set([
  "example.com",
  "example.org",
  "example.net",
  "test.com",
  "test.org",
  "sample.com",
  "localhost",
  "invalid",
]);

/**
 * Filter out non-deliverable / RFC 2606 test domain emails (e.g. @example.com)
 * that cause Resend batch API to reject the entire payload.
 */
export function isDeliverableEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const trimmed = email.trim().toLowerCase();
  const atIdx = trimmed.lastIndexOf("@");
  if (atIdx <= 0 || atIdx >= trimmed.length - 1) return false;
  const domain = trimmed.slice(atIdx + 1);
  if (!domain.includes(".") && domain !== "localhost") return false;
  if (BLOCKED_TEST_DOMAINS.has(domain)) return false;
  for (const blocked of BLOCKED_TEST_DOMAINS) {
    if (domain.endsWith(`.${blocked}`)) return false;
  }
  return true;
}
