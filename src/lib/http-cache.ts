/** For API routes whose response depends on the caller's session or IP —
 *  the content differs per user, so no shared cache (CDN edge or browser)
 *  may store it. Cloudflare's default doesn't cache cookie'd requests, but a
 *  misconfigured cache rule once served one visitor's quota/notes to another,
 *  so every personalized route sends this explicitly instead of relying on
 *  CDN-side configuration. */
export const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, must-revalidate",
} as const;
