// Production origin. NEXT_PUBLIC_SITE_URL is not set in Vercel — this literal
// is what actually drives every absolute site URL (share cards, QR codes, OG
// images), so it is the one place a domain migration has to touch.
// Renamed from buffett.air7.fun on 2026-08-30 with the Value Tribe rebrand.
const DEFAULT_SITE_ORIGIN = "https://vt.air7.fun";

export const SITE_ORIGIN = normalizeSiteOrigin(process.env.NEXT_PUBLIC_SITE_URL) ?? DEFAULT_SITE_ORIGIN;

export function toAbsoluteSiteUrl(pathname: string): string {
  if (/^https?:\/\//i.test(pathname)) return pathname;
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${SITE_ORIGIN}${normalizedPath}`;
}

function normalizeSiteOrigin(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, "");
}
