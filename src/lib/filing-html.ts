const SEC_IMG_SRC = /(<img\b[^>]*\bsrc\s*=\s*)(["'])(https:\/\/www\.sec\.gov\/[^"']*)\2/gi;

/**
 * Real browsers get net::ERR_BLOCKED_BY_ORB hotlinking <img src> straight to
 * sec.gov — SEC gates that path on a compliant User-Agent that only our own
 * server-side fetches send (see SEC_HEADERS in scripts/lib/filing-archive.ts).
 * Route just the image src through our own proxy so the browser only ever
 * talks to our origin; leave href/other attributes pointing at sec.gov
 * directly since those are normal top-level navigation, not a hotlinked
 * subresource fetch.
 */
export function proxySecImageUrls(html: string): string {
  return html.replace(SEC_IMG_SRC, (_match, prefix: string, quote: string, url: string) => {
    return `${prefix}${quote}/api/filing-image?url=${encodeURIComponent(url)}${quote}`;
  });
}
