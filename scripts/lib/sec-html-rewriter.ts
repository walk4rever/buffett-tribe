const SKIPPABLE_SCHEME = /^(?:https?:|mailto:|javascript:|data:|#|\/\/)/i;

/**
 * Rewrites relative href/src/action/data attributes in SEC HTML to absolute
 * https://www.sec.gov/... URLs, so the document renders correctly when served
 * from R2 without needing a same-origin base URL.
 *
 * documentUrl: the original SEC URL of the primary document (used as base for resolution).
 */
export function rewriteSecHtmlUrls(html: string, documentUrl: string): string {
  const base = new URL(documentUrl);

  return html.replace(
    /\b(href|src|action|data)\s*=\s*(["'])([^"']*)\2/gi,
    (match, attr: string, quote: string, url: string) => {
      const trimmed = url.trim();
      if (!trimmed || SKIPPABLE_SCHEME.test(trimmed)) return match;
      try {
        const absolute = new URL(trimmed, base).toString();
        return `${attr}=${quote}${absolute}${quote}`;
      } catch {
        return match;
      }
    },
  );
}
