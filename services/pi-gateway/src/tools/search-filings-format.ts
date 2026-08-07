// Pure formatting/matching helpers for search-filings.ts, split out so they can
// be unit tested without pulling in the DB pool (which throws at import time if
// DIRECT_URL isn't set) or any network/R2 dependency.

// SECTION_ALIASES / resolveSectionKeys live in the synced shared copy — see
// scripts/lib/filing-section-aliases.ts (repo root) for the source of truth
// and services/pi-gateway/scripts/sync-shared-lib.sh for how it gets here.
export { SECTION_ALIASES, resolveSectionKeys } from "../shared/filing-section-aliases.js";

export const MAX_CONTENT_CHARS = 4000;
export const EXCERPT_WINDOW = 1800;

export function extractExcerpt(content: string, keyword: string | null): string {
  if (!keyword) {
    return content.length <= MAX_CONTENT_CHARS
      ? content
      : content.slice(0, MAX_CONTENT_CHARS) + `\n\n[… 内容已截断，共 ${content.length} 字]`;
  }

  const idx = content.toLowerCase().indexOf(keyword.toLowerCase());
  if (idx === -1) {
    return content.slice(0, MAX_CONTENT_CHARS) + (content.length > MAX_CONTENT_CHARS ? `\n\n[… 未找到关键词"${keyword}"，显示开头内容]` : "");
  }

  const start = Math.max(0, idx - EXCERPT_WINDOW / 2);
  const end = Math.min(content.length, idx + EXCERPT_WINDOW / 2);
  const excerpt = content.slice(start, end);
  const prefix = start > 0 ? "[…] " : "";
  const suffix = end < content.length ? " […]" : "";
  return prefix + excerpt + suffix;
}

export function formatSectionLabel(key: string): string {
  return key
    .replace(/^item_\d+[a-z]?_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
