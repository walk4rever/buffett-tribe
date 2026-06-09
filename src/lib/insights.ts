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

const CALLOUT_LABELS: Record<string, string> = {
  note: "NOTE",
  tip: "TIP",
  important: "IMPORTANT",
  warning: "WARNING",
  caution: "CAUTION",
};

export function isInsightFormat(value: unknown): value is InsightFormat {
  return typeof value === "string" && (INSIGHT_FORMATS as readonly string[]).includes(value);
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

export function estimateReadingMinutes(content: string): number {
  const cjkChars = content.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const latinWords = content.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g)?.length ?? 0;
  return Math.max(1, Math.ceil((cjkChars / 450) + (latinWords / 220)));
}

export function rehypeInsightCallouts() {
  return function transform(tree: unknown) {
    visitParent(tree as HastElement);
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

  const calloutRegex = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i;

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
  return /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.test(firstText.value);
}

function createCalloutFromGroup(group: HastElement[]): HastElement {
  const firstParagraph = group[0];
  const firstText = firstParagraph.children?.find((c) => c.type === "text");
  if (!firstText || typeof firstText.value !== "string") {
    throw new Error("Invalid callout node structure");
  }
  
  const match = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(.*?)(?:\r?\n|$)/i.exec(firstText.value);
  const type = match ? match[1].toLowerCase() : "note";
  const title = match ? (match[2].trim() || CALLOUT_LABELS[type] || type.toUpperCase()) : "NOTE";
  const semanticClass = getInsightCalloutSemanticClass(title);

  // Slice callout prefix from the first text node
  if (match) {
    firstText.value = firstText.value.slice(match[0].length);
  }

  const titleNode: HastElement = {
    type: "element",
    tagName: "div",
    properties: {
      className: ["insight-callout-title"],
    },
    children: [
      {
        type: "text",
        value: title,
      },
    ],
  };

  const calloutChildren = [titleNode, ...group];

  // Clean up first paragraph if it is now completely empty
  const hasContent = firstParagraph.children?.some((child) => {
    if (child.type === "text") {
      return typeof child.value === "string" && child.value.trim().length > 0;
    }
    return true;
  });

  const finalChildren = hasContent ? calloutChildren : calloutChildren.filter((child) => child !== firstParagraph);

  return {
    type: "element",
    tagName: "aside",
    properties: {
      className: ["insight-callout", `insight-callout--${type}`, semanticClass].filter(Boolean),
      "data-callout": type,
      ...(semanticClass ? { "data-insight-callout": semanticClass.replace("insight-callout--", "") } : {}),
    },
    children: finalChildren,
  };
}

function getInsightCalloutSemanticClass(title: string): string | null {
  const normalizedTitle = title.replace(/\s+/g, "");

  if (/跨时空复盘/.test(normalizedTitle)) {
    return "insight-callout--retrospective";
  }

  if (/巴菲特部落视角/.test(normalizedTitle)) {
    return "insight-callout--tribe-view";
  }

  return null;
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
