import { CALLOUT_TAG_PATTERN, calloutBaseType, calloutInlineStyle, getCalloutConfig } from "./callout-types";
import { matchEmbedPlatform, type EmbedPlatformConfig } from "./embed-platforms";
import { BRAND_EN, BRAND_ZH } from "./brand";
import { toAbsoluteSiteUrl } from "./site-url";

export const INSIGHT_FORMATS = ["markdown", "html"] as const;
export type InsightFormat = (typeof INSIGHT_FORMATS)[number];

export interface InsightFrontmatter {
  title?: string;
  source?: string;
  sourceUrl?: string;
  author?: string;
  date?: string;
  tags?: string[];
  description?: string;
}

export interface ParsedInsightContent {
  content: string;
  metadata: InsightFrontmatter;
}

export function isInsightFormat(value: unknown): value is InsightFormat {
  return typeof value === "string" && (INSIGHT_FORMATS as readonly string[]).includes(value);
}

// Established Vault authoring convention for translated podcast/video pieces:
// `source:` holds the episode URL and `author:` holds the show/publication
// name (e.g. "Colossus", "Acquired", "20VC") — the opposite of what those field
// names suggest. Recognize the known shows so the real name survives as
// `source`; genuine personal bylines (an actual person's blog post, e.g.
// author: lilian-weng) are never in this list, so they're untouched.
const KNOWN_SHOW_NAMES = new Set([
  "Colossus",
  "Acquired",
  "No Priors",
  "20VC",
  "Capital Allocators",
  "My First Million",
  "Latent Space",
  "SemiAnalysis",
  "Founders",
  "TWIML AI",
  "Generating Alpha",
  "The a16z Show",
]);

function isHttpUrl(value: string | undefined): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

/** Strips Obsidian/wiki-link bracket syntax ("[[Acquired]]" -> "Acquired"),
 *  a raw-vault-note artifact that should never reach the database. */
export function stripWikiLinkBrackets(value: string): string {
  const match = value.trim().match(/^\[\[(.+)\]\]$/);
  return (match ? match[1] : value).trim();
}

/**
 * Resolves the final `source`/`author` pair for an InsightPost from explicit
 * overrides (CLI flags / API payload) plus raw frontmatter, applying the
 * KNOWN_SHOW_NAMES convention above and bracket-stripping to both.
 *
 * Throws if `source` still ends up empty — a null `source` makes a post
 * invisible under every /insights filter pill while still *looking* filed
 * under the house brand (the list/detail pages' `post.source || BRAND_EN`
 * fallback only affects display, not the filter's exact-match query
 * on the real column) — this silently broke two published posts before it
 * was noticed. Never guess a `source` — reject instead so the importer fixes
 * the frontmatter or passes --source explicitly.
 *
 * `author` is optional and, when absent, defaults to the resolved `source`
 * — the two are the same value for the vast majority of posts; the site no
 * longer displays `author` separately (see PRODUCT.md), so this is mostly
 * about keeping the column's historical meaning intact, not UI.
 */
export function resolveInsightSourceAndAuthor(input: {
  explicitSource?: string;
  explicitAuthor?: string;
  frontmatterSource?: string;
  frontmatterAuthor?: string;
}): { source: string; author: string } {
  const frontmatterSourceIsUrl = isHttpUrl(input.frontmatterSource);
  const authorIsKnownShowName =
    frontmatterSourceIsUrl && !!input.frontmatterAuthor && KNOWN_SHOW_NAMES.has(input.frontmatterAuthor);

  const rawSource =
    input.explicitSource ??
    (authorIsKnownShowName
      ? input.frontmatterAuthor!
      : frontmatterSourceIsUrl
        ? undefined
        : input.frontmatterSource);
  const source = rawSource ? stripWikiLinkBrackets(rawSource) : "";
  if (!source) {
    throw new Error(
      "source 不能为空 — 请在 frontmatter 里设置 `source:`，或传 --source（也可能是 `source:` 写成了链接但 `author:` 不是已知节目名，见 KNOWN_SHOW_NAMES）。",
    );
  }

  const rawAuthor = input.explicitAuthor ?? (authorIsKnownShowName ? undefined : input.frontmatterAuthor);
  const author = rawAuthor ? stripWikiLinkBrackets(rawAuthor) : source;

  return { source, author };
}

export function normalizeInsightSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

export function parseInsightFrontmatter(raw: string): ParsedInsightContent {
  if (!raw.startsWith("---\n")) return { content: raw, metadata: {} };

  const end = raw.indexOf("\n---", 4);
  if (end === -1) return { content: raw, metadata: {} };

  const yaml = raw.slice(4, end).trim();
  const contentStart = raw[end + 4] === "\n" ? end + 5 : end + 4;
  const metadata: InsightFrontmatter = {};
  const lines = yaml.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!match) continue;

    const key = match[1];
    const value = stripYamlQuotes(match[2].trim());

    if (key === "tags") {
      const tags: string[] = [];
      if (value.startsWith("[") && value.endsWith("]")) {
        tags.push(
          ...value
            .slice(1, -1)
            .split(",")
            .map((tag) => stripYamlQuotes(tag.trim()))
            .filter(Boolean),
        );
      } else if (value) {
        tags.push(value);
      }

      while (lines[i + 1] && /^\s*-\s+/.test(lines[i + 1])) {
        i += 1;
        const tag = stripYamlQuotes(lines[i].replace(/^\s*-\s+/, "").trim());
        if (tag) tags.push(tag);
      }
      metadata.tags = tags;
      continue;
    }

    if (key === "title") metadata.title = value;
    if (key === "source") metadata.source = value;
    if (key === "sourceUrl") metadata.sourceUrl = value;
    if (key === "author") metadata.author = value;
    if (key === "date") metadata.date = value;
    if (key === "description") metadata.description = value;
  }

  return { content: raw.slice(contentStart).trimStart(), metadata };
}

export function markdownToHtmlMarkdown(raw: string): string {
  return raw.replace(/^[ \t]*>[ \t]*\[!(\w+)\][ \t]*/gim, (_match, type) => {
    return `> [!${String(type).toUpperCase()}] `;
  });
}

const LEGACY_INSIGHT_CALLOUT_MAPPINGS = [
  {
    match: /^(?:\*\*)?\s*(?:背景说明|背景概览|Background overview)\s*(?:\*\*)?$/iu,
    type: "Overview",
    title: "背景概览",
  },
  {
    match: /^(?:\*\*)?\s*(?:\d{4}\s*)?(?:跨时空复盘|跨时空评注|时空复盘)(?:[（(][^)）\n]*[）)])?\s*(?:\*\*)?$/iu,
    type: "Facts",
    title: "时空复盘",
  },
  {
    // 价值部落视角 is the post-rename heading; the two 巴菲特* forms stay so
    // articles written under the old brand keep parsing.
    match: /^(?:\*\*)?\s*(?:价值部落视角|巴菲特部落视角|巴菲特视角)(?:[（(][^)）\n]*[）)])?\s*(?:\*\*)?$/iu,
    type: "Value",
    title: "价值视角",
  },
  {
    match: /^(?:\*\*)?\s*(?:巴菲特|芒格).*(?:\*\*)?$/iu,
    type: "Value",
    title: "价值视角",
  },
];

export function normalizeInsightLegacyCallouts(raw: string): string {
  const lines = raw.split(/\r?\n/);
  const normalized: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = new RegExp(`^(>\\s*)\\[!(${CALLOUT_TAG_PATTERN})\\]\\s*(.*)$`, "i").exec(line);
    if (!match) {
      normalized.push(line);
      continue;
    }

    const quotePrefix = match[1];
    const sameLineTitle = stripLegacyInsightTitle(match[3]);
    const nextLine = lines[index + 1] ?? "";
    const nextLineTitle = extractQuotedLegacyInsightTitle(nextLine);
    const mapping = resolveLegacyInsightCalloutMapping(sameLineTitle) ?? resolveLegacyInsightCalloutMapping(nextLineTitle);

    if (!mapping) {
      normalized.push(line);
      continue;
    }

    normalized.push(`${quotePrefix}[!${mapping.type}] ${mapping.title}`);
    if (!sameLineTitle && nextLineTitle) {
      index += 1;
    }
  }

  return normalized.join("\n");
}

export function estimateReadingMinutes(content: string): number {
  const cjkChars = content.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const latinWords = content.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g)?.length ?? 0;
  return Math.max(1, Math.ceil((cjkChars / 450) + (latinWords / 220)));
}

export function extractInsightOverviewShareContent(raw: string, fallbackDescription?: string): {
  title: string;
  markdown: string;
} {
  const normalized = normalizeInsightLegacyCallouts(raw);
  const lines = normalized.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const match = /^>\s*\[!OVERVIEW\]\s*(.*)$/i.exec(lines[index]);
    if (!match) continue;

    const title = stripLegacyInsightTitle(match[1]) || "背景概览";
    const bodyLines: string[] = [];

    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const bodyMatch = /^>\s?(.*)$/.exec(lines[cursor]);
      if (!bodyMatch) break;
      bodyLines.push(bodyMatch[1]);
      index = cursor;
    }

    const markdown = trimBlankLines(bodyLines).join("\n").trim();
    if (markdown) {
      return { title, markdown };
    }
    break;
  }

  const fallback = resolveInsightOverviewFallback(normalized, fallbackDescription);
  return {
    title: "背景概览",
    markdown: fallback,
  };
}

export interface InsightHighlightShareParams {
  title: string;
  slug: string;
  quoteText: string;
  source?: string | null;
  siteOrigin?: string;
}

/**
 * Builds a styled, copy-ready text template for insight highlights:
 * 1. Quoted paragraph content
 * 2. Title citation and article original link
 * 3. Brand slogan footer: Value Tribe
 */
export function buildInsightHighlightShareText({
  title,
  slug,
  quoteText,
  source,
  siteOrigin,
}: InsightHighlightShareParams): string {
  const url = siteOrigin
    ? `${siteOrigin.replace(/\/+$/, "")}/insights/${encodeURIComponent(slug)}`
    : toAbsoluteSiteUrl(`/insights/${encodeURIComponent(slug)}`);

  const trimmedTitle = title.trim();
  const safeTitle = trimmedTitle.startsWith("《") && trimmedTitle.endsWith("》") ? trimmedTitle : `《${trimmedTitle}》`;
  const cleanSource = source?.trim();
  const hasDistinctSource = cleanSource && cleanSource !== BRAND_EN && cleanSource !== BRAND_ZH;
  const sourceCiting = hasDistinctSource ? ` · ${cleanSource}` : "";
  const citation = `—— 摘自${safeTitle}${sourceCiting}`;

  const formattedQuote = quoteText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line, index, arr) => line.length > 0 || (index > 0 && arr[index - 1].length > 0))
    .join("\n");

  return [
    `“${formattedQuote}”`,
    ``,
    citation,
    ``,
    `🔗 原文链接：${url}`,
    ``,
    `【${BRAND_EN} · ${BRAND_ZH}】买股票就是买公司。用投资大师的框架深度理解一家公司。`,
  ].join("\n");
}

function resolveLegacyInsightCalloutMapping(value: string): { type: string; title: string } | null {
  const normalized = stripLegacyInsightTitle(value);
  if (!normalized) return null;
  return LEGACY_INSIGHT_CALLOUT_MAPPINGS.find((mapping) => mapping.match.test(normalized)) ?? null;
}

function extractQuotedLegacyInsightTitle(line: string): string {
  const match = /^>\s*(.*)$/.exec(line);
  return stripLegacyInsightTitle(match?.[1] ?? "");
}

function stripLegacyInsightTitle(value: string): string {
  return value
    .replace(/^>\s*/, "")
    .replace(/^\[!\w+\]\s*/i, "")
    .replace(/^[-*]\s+/, "")
    .replace(/^>\s*/, "")
    .replace(/^\s+|\s+$/g, "");
}

function trimBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start]?.trim()) start += 1;
  while (end > start && !lines[end - 1]?.trim()) end -= 1;
  return lines.slice(start, end);
}

function resolveInsightOverviewFallback(raw: string, fallbackDescription?: string): string {
  const description = fallbackDescription?.trim();
  if (description) return description;

  const paragraphs = raw
    .replace(/^---[\s\S]*?\n---\n?/, "")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph
      .split(/\r?\n/)
      .map((line) => line.replace(/^#+\s*/, "").replace(/^>\s*/, "").trim())
      .join(" ")
      .replace(/\s+/g, " ")
      .trim())
    .filter(Boolean);

  return paragraphs[0] ?? "";
}

export function rehypeInsightCallouts() {
  return function transform(tree: unknown) {
    visitParent(tree as HastElement);
  };
}

/** Turns a paragraph containing only a link to a known video/audio platform (a bare
 *  URL or a titled link, alone on its own line) into a sandboxed iframe embed. Any
 *  other <iframe> HTML an author might type stays stripped by rehype-sanitize —
 *  this is the only path that ever produces one, see embed-platforms.ts. */
export function rehypeInsightEmbeds() {
  return function transform(tree: unknown) {
    visitEmbedParent(tree as HastElement);
  };
}

function visitEmbedParent(node: HastElement) {
  if (!node || !Array.isArray(node.children)) return;

  node.children = node.children.map((child) => {
    visitEmbedParent(child);
    if (child.type !== "element" || child.tagName !== "p") return child;
    return tryCreateEmbedFromParagraph(child) ?? child;
  });
}

function tryCreateEmbedFromParagraph(paragraph: HastElement): HastElement | null {
  const meaningful = (paragraph.children ?? []).filter(
    (c) => !(c.type === "text" && typeof c.value === "string" && !c.value.trim()),
  );
  if (meaningful.length !== 1) return null;

  const [only] = meaningful;
  if (only.type !== "element" || only.tagName !== "a") return null;
  const href = only.properties?.href;
  if (typeof href !== "string") return null;

  const matched = matchEmbedPlatform(href);
  return matched ? createEmbedNode(matched.config, matched.embedSrc) : null;
}

function createEmbedNode(config: EmbedPlatformConfig, embedSrc: string): HastElement {
  const isVideo = config.kind === "video";
  return {
    type: "element",
    tagName: "div",
    properties: {
      className: ["insight-embed", `insight-embed--${config.kind}`],
      style: isVideo ? `aspect-ratio: ${config.aspectRatio}` : `height: ${config.height}px`,
    },
    children: [
      {
        type: "element",
        tagName: "iframe",
        properties: {
          src: embedSrc,
          title: config.title,
          loading: "lazy",
          frameBorder: "0",
          allow: isVideo
            ? "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            : "autoplay; clipboard-write; encrypted-media; picture-in-picture",
          allowFullScreen: isVideo,
        },
        children: [],
      },
    ],
  };
}

function visitParent(node: HastElement) {
  if (!node || !Array.isArray(node.children)) return;

  const newChildren: HastElement[] = [];
  let modified = false;

  for (const child of node.children) {
    // Recursively visit child nodes first
    visitParent(child);

    if (child.type === "element" && child.tagName === "blockquote") {
      const groups = splitBlockquoteChildren(child.children || []);
      if (groups.length > 1) {
        modified = true;
        for (const group of groups) {
          if (shouldTransformGroup(group)) {
            newChildren.push(createCalloutFromGroup(group));
          } else if (!hasRenderableContent(group)) {
            // Drop empty blockquote fragments created by blank quoted lines around callouts.
            continue;
          } else {
            // Keep normal blockquote for non-callout group
            newChildren.push({
              type: "element",
              tagName: "blockquote",
              properties: {},
              children: group,
            });
          }
        }
      } else if (groups.length === 1 && shouldTransformGroup(groups[0])) {
        modified = true;
        newChildren.push(createCalloutFromGroup(groups[0]));
      } else {
        newChildren.push(child);
      }
    } else {
      newChildren.push(child);
    }
  }

  if (modified) {
    node.children = newChildren;
  }
}

function splitBlockquoteChildren(children: HastElement[]): HastElement[][] {
  if (!Array.isArray(children)) return [];
  const groups: HastElement[][] = [];
  let currentGroup: HastElement[] = [];

  const calloutRegex = new RegExp(`^\\s*\\[!(${CALLOUT_TAG_PATTERN})\\]`, "i");

  for (const child of children) {
    let isNewCalloutStart = false;
    if (child.type === "element" && child.tagName === "p") {
      const firstText = child.children?.find((c) => c.type === "text");
      if (firstText && typeof firstText.value === "string" && calloutRegex.test(firstText.value)) {
        isNewCalloutStart = true;
      }
    }

    if (isNewCalloutStart && currentGroup.length > 0) {
      groups.push(currentGroup);
      currentGroup = [];
    }

    currentGroup.push(child);
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  return groups;
}

function hasRenderableContent(nodes: HastElement[]): boolean {
  return nodes.some((node) => {
    if (node.type === "text") {
      return typeof node.value === "string" && node.value.trim().length > 0;
    }

    if (Array.isArray(node.children)) {
      return hasRenderableContent(node.children);
    }

    return node.type === "element";
  });
}

function shouldTransformGroup(group: HastElement[]): boolean {
  if (!Array.isArray(group) || group.length === 0) return false;
  const firstParagraph = group[0];
  if (firstParagraph.type !== "element" || firstParagraph.tagName !== "p") return false;
  const firstText = firstParagraph.children?.find((c) => c.type === "text");
  if (!firstText || typeof firstText.value !== "string") return false;
  return new RegExp(`^\\s*\\[!(${CALLOUT_TAG_PATTERN})\\]`, "i").test(firstText.value);
}

function createCalloutFromGroup(group: HastElement[]): HastElement {
  const firstParagraph = group[0];
  const firstText = firstParagraph.children?.find((c) => c.type === "text");
  if (!firstText || typeof firstText.value !== "string") {
    throw new Error("Invalid callout node structure");
  }
  
  const match = new RegExp(`^\\s*\\[!(${CALLOUT_TAG_PATTERN})\\][ \\t]*(.*?)(?:\\r?\\n|$)`, "i").exec(firstText.value);
  const type = match ? match[1].toLowerCase() : "note";
  const title = match ? (match[2].trim() || type.toUpperCase()) : "NOTE";

  // Slice callout prefix from the first text node
  if (match) {
    firstText.value = firstText.value.slice(match[0].length);
  }

  const config = getCalloutConfig(type);
  const baseType = calloutBaseType(config);

  // Clean title: extract text inside parentheses if present (e.g. "（算力重构与资本回报率）" -> "算力重构与资本回报率")
  let displayTitle = title.trim();
  const parenMatch = /[（\(](.*?)[）\)]/.exec(displayTitle);
  if (parenMatch) {
    displayTitle = parenMatch[1].trim();
  }
  
  // If displayTitle matches the default UPPERCASE type string, use the localized defaultTitle
  if (!displayTitle || displayTitle === type.toUpperCase()) {
    displayTitle = config.defaultTitle;
  }

  const headerNode: HastElement = {
    type: "element",
    tagName: "div",
    properties: {
      className: ["insight-callout-header"],
    },
    children: [
      {
        type: "element",
        tagName: "span",
        properties: {
          className: ["insight-callout-label"],
        },
        children: [
          {
            type: "text",
            value: config.label,
          },
        ],
      },
      {
        type: "element",
        tagName: "span",
        properties: {
          className: ["insight-callout-title"],
        },
        children: [
          {
            type: "text",
            value: displayTitle,
          },
        ],
      },
    ],
  };

  const calloutChildren = [headerNode, ...group];

  // Clean up first paragraph if it is now completely empty
  const hasContent = firstParagraph.children?.some((child) => {
    if (child.type === "text") {
      return typeof child.value === "string" && child.value.trim().length > 0;
    }
    return true;
  });

  const finalChildren = hasContent
    ? calloutChildren
    : calloutChildren.filter((child) => child !== firstParagraph);

  return {
    type: "element",
    tagName: "aside",
    properties: {
      className: [
        "insight-callout",
        `insight-callout--${baseType}`,
        `insight-callout--type-${type}`,
      ].filter(Boolean),
      "data-callout": type,
      "data-base-callout": baseType,
      style: calloutInlineStyle(config),
    },
    children: finalChildren,
  };
}

function stripYamlQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

interface HastElement {
  type?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastElement[];
  value?: unknown;
}
