import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import type { Element } from "domhandler";

export type AnnualReportTocNode = {
  title: string;
  level: number;
  anchor: string | null;
  children: AnnualReportTocNode[];
};

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const BLOCK_CHILD_TAGS = new Set([
  "article",
  "aside",
  "blockquote",
  "div",
  "figure",
  "li",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);

function cleanText(value: string) {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizePlainText(text: string) {
  return cleanText(text)
    .replace(/\n+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isMeaningfulText(text: string) {
  return normalizePlainText(text).length > 0;
}

function getNodeTag(node: Element) {
  return node.tagName?.toLowerCase() ?? "";
}

function getNodeAnchor($: CheerioAPI, node: Element) {
  const attrs = node.attribs ?? {};
  const direct = attrs.id ?? attrs.name;
  if (direct && direct.trim()) return direct.trim();

  const descendantAnchor = $(node).find("a[id],a[name]").first();
  if (descendantAnchor.length) {
    const attr = descendantAnchor.attr("id") ?? descendantAnchor.attr("name");
    if (attr && attr.trim()) return attr.trim();
  }

  return null;
}

function hasBlockDescendant(node: Element) {
  for (const child of node.children ?? []) {
    if (child.type !== "tag") continue;
    const tag = getNodeTag(child);
    if (BLOCK_CHILD_TAGS.has(tag) || HEADING_TAGS.has(tag)) return true;
  }
  return false;
}

function parseStyle(style: string | undefined | null) {
  const result: Record<string, string> = {};
  if (!style) return result;
  for (const part of style.split(";")) {
    const [rawKey, ...rest] = part.split(":");
    if (!rawKey || !rest.length) continue;
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim().toLowerCase();
    if (key) result[key] = value;
  }
  return result;
}

function isLikelyHeadingText(text: string) {
  const normalized = normalizePlainText(text);
  if (!normalized) return false;
  if (normalized.length > 180) return false;
  if (/[:。.!?]$/.test(normalized)) return false;
  if (/^ITEM\s+\d+[A-Z]?\b/i.test(normalized)) return true;
  if (/^NOTE\s+\d+\b/i.test(normalized)) return true;
  if (/^PART\s+[IVXLC]+\b/i.test(normalized)) return true;

  const alphaCount = normalized.replace(/[^A-Za-z]/g, "").length;
  const upperCount = normalized.replace(/[^A-Z]/g, "").length;
  const upperRatio = upperCount / Math.max(alphaCount, 1);
  if (upperRatio > 0.7 && normalized.length < 120) return true;
  if (/^[A-Z][A-Z0-9 ,&()\-/'"]+$/.test(normalized)) return true;
  return false;
}

function isHeadingLikeNode(node: Element, text: string) {
  const tag = getNodeTag(node);
  if (HEADING_TAGS.has(tag)) return true;

  const normalized = normalizePlainText(text);
  if (!normalized) return false;

  const style = parseStyle(node.attribs?.style);
  const fontWeight = style["font-weight"] ?? "";
  const textAlign = style["text-align"] ?? "";
  const fontStyle = style["font-style"] ?? "";
  const isBold = /bold|[6-9]00/.test(fontWeight);
  const isCentered = textAlign === "center";
  const shortText = normalized.length <= 120 && normalized.split(/\s+/).length <= 14;
  const titleCaseLike = /^[A-Z][A-Za-z0-9 ,&()\-/'"]+$/.test(normalized);
  const italicHeading = fontStyle.includes("italic") && shortText && !normalized.endsWith(".");

  if (isBold && shortText) return true;
  if (isCentered && shortText) return true;
  if (italicHeading && shortText) return true;
  if (isLikelyHeadingText(normalized)) return true;
  return titleCaseLike && shortText && !normalized.endsWith(".");
}

function guessHeadingLevel(text: string) {
  const normalized = normalizePlainText(text);
  if (/^ITEM\s+\d+[A-Z]?\b/i.test(normalized)) return 2;
  if (/^PART\s+[IVXLC]+\b/i.test(normalized)) return 2;
  if (/^NOTE\s+\d+\b/i.test(normalized)) return 3;
  if (/^[A-Z][A-Z0-9 ,&()\-/'"]+$/.test(normalized) && normalized.length < 80) return 3;
  if (/^[A-Z][A-Za-z0-9 ,&()\-/'"]+$/.test(normalized) && normalized.length < 90) return 4;
  return 4;
}

function buildAnchor(text: string, index: number) {
  const base = normalizePlainText(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "node"}-${index}`;
}

function visitNode($: CheerioAPI, node: Element, out: Array<{ title: string; level: number; anchor: string | null }>) {
  if (node.type !== "tag") return;
  const tag = getNodeTag(node);
  if (!tag || ["script", "style", "head", "noscript"].includes(tag)) return;

  if (HEADING_TAGS.has(tag)) {
    const text = normalizePlainText($(node).text());
    if (text && isMeaningfulText(text)) {
      out.push({
        title: text,
        level: Number(tag.slice(1)),
        anchor: getNodeAnchor($, node),
      });
    }
    return;
  }

  if (hasBlockDescendant(node)) {
    for (const child of node.children ?? []) {
      visitNode($, child as Element, out);
    }
    return;
  }

  const text = normalizePlainText($(node).text());
  if (!text || !isMeaningfulText(text)) return;
  if (!isHeadingLikeNode(node, text)) return;

  out.push({
    title: text,
    level: guessHeadingLevel(text),
    anchor: getNodeAnchor($, node) ?? buildAnchor(text, out.length),
  });
}

export function buildAnnualReportToc(html: string): AnnualReportTocNode[] {
  const $ = cheerio.load(html);
  $("script,style,head,noscript,ix\\:hidden,ix\\:header").remove();
  const body = $("body").get(0);
  if (!body) return [];

  const flat: Array<{ title: string; level: number; anchor: string | null }> = [];
  for (const child of body.children ?? []) {
    visitNode($, child as Element, flat);
  }

  const stack: AnnualReportTocNode[] = [];
  const roots: AnnualReportTocNode[] = [];
  const seen = new Set<string>();

  for (const item of flat) {
    const key = `${item.title.toLowerCase()}|${item.level}|${item.anchor ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const node: AnnualReportTocNode = {
      title: item.title,
      level: item.level,
      anchor: item.anchor,
      children: [],
    };

    while (stack.length && stack[stack.length - 1].level >= node.level) {
      stack.pop();
    }

    if (!stack.length) {
      roots.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }

    stack.push(node);
  }

  return roots;
}
