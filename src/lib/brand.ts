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
 *   - package.json name, repo name, buffett-tribe.com domain
 */
export const BRAND_ZH = "价值部落";
export const BRAND_EN = "Value Tribe";
export const BRAND_FULL = `${BRAND_ZH} · ${BRAND_EN}`;
