const DEFAULT_SITE_ORIGIN = "https://buffett.air7.fun";

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
