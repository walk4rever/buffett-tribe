/**
 * Structured annual filing section extraction.
 *
 * Pure functions — no I/O, no DB. Used by:
 *   - scripts/import-10k-xbrl.ts (inline during import, reuses already-fetched HTML)
 *   - scripts/extract-10k-sections.ts (backfill tool for filings imported before this was wired)
 */

import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import type { Element } from "domhandler";

export type FilingKind = "10k" | "20f" | "40f";

export type TargetSection = {
  key: string;
  itemNum?: string;
  label: string;
  patterns?: RegExp[];
  pageWindow?: number;
};

type FilingTemplate = {
  kind: FilingKind;
  sections: TargetSection[];
  preferTocAnchors?: boolean;
};

const TARGET_SECTIONS_10K: TargetSection[] = [
  { key: "item_1_business", itemNum: "1", label: "BUSINESS" },
  { key: "item_1a_risk_factors", itemNum: "1A", label: "RISK FACTORS" },
  { key: "item_1b_staff_comments", itemNum: "1B", label: "UNRESOLVED STAFF COMMENTS" },
  { key: "item_1c_cybersecurity", itemNum: "1C", label: "CYBERSECURITY" },
  { key: "item_2_properties", itemNum: "2", label: "PROPERTIES" },
  { key: "item_3_legal", itemNum: "3", label: "LEGAL PROCEEDINGS" },
  { key: "item_4_mine_safety", itemNum: "4", label: "MINE SAFETY DISCLOSURES" },
  { key: "item_5_market", itemNum: "5", label: "MARKET FOR REGISTRANT'S COMMON EQUITY" },
  { key: "item_6_selected_data", itemNum: "6", label: "SELECTED FINANCIAL DATA" },
  { key: "item_7_mda", itemNum: "7", label: "MANAGEMENT'S DISCUSSION AND ANALYSIS" },
  { key: "item_7a_market_risk", itemNum: "7A", label: "MARKET RISK" },
  { key: "item_8_financial_statements", itemNum: "8", label: "FINANCIAL STATEMENTS" },
  { key: "item_9_accountants", itemNum: "9", label: "CHANGES IN AND DISAGREEMENTS WITH ACCOUNTANTS" },
  { key: "item_9a_controls", itemNum: "9A", label: "CONTROLS AND PROCEDURES" },
  { key: "item_9b_other", itemNum: "9B", label: "OTHER INFORMATION" },
  { key: "item_9c_foreign", itemNum: "9C", label: "DISCLOSURE REGARDING FOREIGN JURISDICTIONS" },
  { key: "item_10_directors", itemNum: "10", label: "DIRECTORS, EXECUTIVE OFFICERS AND CORPORATE GOVERNANCE" },
  { key: "item_11_compensation", itemNum: "11", label: "EXECUTIVE COMPENSATION" },
  { key: "item_12_ownership", itemNum: "12", label: "SECURITY OWNERSHIP OF CERTAIN BENEFICIAL OWNERS" },
  { key: "item_13_relationships", itemNum: "13", label: "CERTAIN RELATIONSHIPS AND RELATED TRANSACTIONS" },
  { key: "item_14_accountant_fees", itemNum: "14", label: "PRINCIPAL ACCOUNTANT FEES AND SERVICES" },
  { key: "item_15_exhibits", itemNum: "15", label: "EXHIBITS, FINANCIAL STATEMENT SCHEDULES" },
  { key: "item_16_summary", itemNum: "16", label: "FORM 10-K SUMMARY" },
];

const TARGET_SECTIONS_20F: TargetSection[] = [
  { key: "item_1_identity_directors", itemNum: "1", label: "IDENTITY OF DIRECTORS, SENIOR MANAGEMENT AND ADVISERS", patterns: [/identity of directors.*senior management.*advis/i] },
  { key: "item_2_offer_statistics", itemNum: "2", label: "OFFER STATISTICS AND EXPECTED TIMETABLE", patterns: [/offer statistics and expected timetable/i] },
  { key: "item_3_key_information", itemNum: "3", label: "KEY INFORMATION", patterns: [/key information/i] },
  { key: "item_4_company_information", itemNum: "4", label: "INFORMATION ON THE COMPANY", patterns: [/information on the company/i] },
  { key: "item_4a_unresolved_comments", itemNum: "4A", label: "UNRESOLVED STAFF COMMENTS", patterns: [/unresolved staff comments/i] },
  { key: "item_5_operating_financial_review", itemNum: "5", label: "OPERATING AND FINANCIAL REVIEW AND PROSPECTS", patterns: [/operating and financial review and prospects/i] },
  { key: "item_6_directors_management_employees", itemNum: "6", label: "DIRECTORS, SENIOR MANAGEMENT AND EMPLOYEES", patterns: [/directors.*senior management.*employees/i] },
  { key: "item_7_major_shareholders_related_party", itemNum: "7", label: "MAJOR SHAREHOLDERS AND RELATED PARTY TRANSACTIONS", patterns: [/major shareholders and related party transactions/i] },
  { key: "item_8_financial_information", itemNum: "8", label: "FINANCIAL INFORMATION", patterns: [/financial information/i], pageWindow: 3 },
  { key: "item_9_offer_listing", itemNum: "9", label: "THE OFFER AND LISTING", patterns: [/the offer and listing/i] },
  { key: "item_10_additional_information", itemNum: "10", label: "ADDITIONAL INFORMATION", patterns: [/additional information/i] },
  { key: "item_11_market_risk", itemNum: "11", label: "QUANTITATIVE AND QUALITATIVE DISCLOSURES ABOUT MARKET RISK", patterns: [/quantitative and qualitative disclosures about market risk/i] },
  { key: "item_12_equity_securities", itemNum: "12", label: "DESCRIPTION OF SECURITIES OTHER THAN EQUITY SECURITIES", patterns: [/description of securities other than equity securities/i] },
  { key: "item_13_defaults_dividends", itemNum: "13", label: "DEFAULTS, DIVIDEND ARREARAGES AND DELINQUENCIES", patterns: [/defaults.*dividend arrearages.*delinquencies/i] },
  { key: "item_14_material_modifications", itemNum: "14", label: "MATERIAL MODIFICATIONS TO THE RIGHTS OF SECURITY HOLDERS", patterns: [/material modifications to the rights of security holders/i] },
  { key: "item_15_controls_procedures", itemNum: "15", label: "CONTROLS AND PROCEDURES", patterns: [/controls and procedures/i] },
  { key: "item_16a_audit_committee_expert", itemNum: "16A", label: "AUDIT COMMITTEE FINANCIAL EXPERT", patterns: [/audit committee financial expert/i] },
  { key: "item_16b_code_of_ethics", itemNum: "16B", label: "CODE OF ETHICS", patterns: [/code of ethics/i] },
  { key: "item_16c_principal_accountant_fees", itemNum: "16C", label: "PRINCIPAL ACCOUNTANT FEES AND SERVICES", patterns: [/principal accountant fees and services/i] },
  { key: "item_16d_exemptions_audit_committee", itemNum: "16D", label: "EXEMPTIONS FROM THE LISTING STANDARDS FOR AUDIT COMMITTEES", patterns: [/exemptions from the listing standards.*audit committees?/i] },
  { key: "item_16e_purchases_by_issuer", itemNum: "16E", label: "PURCHASES OF EQUITY SECURITIES BY THE ISSUER AND AFFILIATED PURCHASERS", patterns: [/purchases of equity securities by the issuer/i] },
  { key: "item_16f_change_registrant_certifying_accountant", itemNum: "16F", label: "CHANGE IN REGISTRANT'S CERTIFYING ACCOUNTANT", patterns: [/change in registrant'?s certifying accountant/i] },
  { key: "item_16g_corporate_governance", itemNum: "16G", label: "CORPORATE GOVERNANCE", patterns: [/corporate governance/i] },
  { key: "item_16h_mine_safety", itemNum: "16H", label: "MINE SAFETY DISCLOSURE", patterns: [/mine safety disclosure/i] },
  { key: "item_16i_disclosure_foreign_jurisdictions", itemNum: "16I", label: "DISCLOSURE REGARDING FOREIGN JURISDICTIONS THAT PREVENT INSPECTIONS", patterns: [/disclosure regarding foreign jurisdictions/i] },
  { key: "item_16j_insider_trading_policies", itemNum: "16J", label: "INSIDER TRADING POLICIES", patterns: [/insider trading policies/i] },
  { key: "item_16k_cybersecurity", itemNum: "16K", label: "CYBERSECURITY", patterns: [/cybersecurity/i] },
  { key: "item_17_financial_statements", itemNum: "17", label: "FINANCIAL STATEMENTS", patterns: [/financial statements/i], pageWindow: 2 },
  { key: "item_18_financial_statements_us_gaap", itemNum: "18", label: "FINANCIAL STATEMENTS", patterns: [/financial statements/i], pageWindow: 12 },
  { key: "item_19_exhibits", itemNum: "19", label: "EXHIBITS", patterns: [/exhibits?/i] },
];

const TARGET_SECTIONS_40F: TargetSection[] = [
  { key: "annual_information_form", label: "ANNUAL INFORMATION FORM", patterns: [/^annual information form$/i] },
  {
    key: "audited_annual_financial_statements",
    label: "AUDITED ANNUAL FINANCIAL STATEMENTS",
    patterns: [/^(audited )?(annual )?financial statements$/i, /^consolidated financial statements$/i],
  },
  {
    key: "management_discussion_and_analysis",
    label: "MANAGEMENT'S DISCUSSION AND ANALYSIS",
    patterns: [/^management'?s discussion and analysis/i, /^md&a$/i],
  },
  {
    key: "disclosure_controls_procedures",
    label: "DISCLOSURE CONTROLS AND PROCEDURES",
    patterns: [/^disclosure controls and procedures$/i],
  },
  {
    key: "management_internal_control_report",
    label: "MANAGEMENT REPORT ON INTERNAL CONTROL",
    patterns: [/^management('?s)? (annual )?report on internal control/i, /^management report on internal control over financial reporting$/i],
  },
  {
    key: "auditor_attestation_internal_control",
    label: "AUDITOR ATTESTATION ON INTERNAL CONTROL",
    patterns: [/^attestation report.*internal control/i, /^report of independent registered public accounting firm.*internal control/i],
  },
  {
    key: "changes_internal_control",
    label: "CHANGES IN INTERNAL CONTROL",
    patterns: [/^changes in internal control over financial reporting$/i],
  },
  {
    key: "audit_committee_financial_expert",
    label: "AUDIT COMMITTEE FINANCIAL EXPERT",
    patterns: [/^audit committee financial expert$/i],
  },
  { key: "code_of_ethics", label: "CODE OF ETHICS", patterns: [/^code of ethics$/i] },
  {
    key: "principal_accountant_fees_services",
    label: "PRINCIPAL ACCOUNTANT FEES AND SERVICES",
    patterns: [/^principal accountant fees and services$/i],
  },
  { key: "certifications", label: "CERTIFICATIONS", patterns: [/^certifications$/i] },
  { key: "exhibits", label: "EXHIBITS", patterns: [/^exhibits?$/i] },
];

const FILING_TEMPLATES: Record<FilingKind, FilingTemplate> = {
  "10k": { kind: "10k", sections: TARGET_SECTIONS_10K },
  "20f": { kind: "20f", sections: TARGET_SECTIONS_20F, preferTocAnchors: true },
  "40f": { kind: "40f", sections: TARGET_SECTIONS_40F },
};

export type FilingOutlineNode = {
  title: string;
  level: number;
  anchor: string | null;
  children: FilingOutlineNode[];
};

export type FilingBlock =
  | {
      id: string;
      anchor: string | null;
      type: "heading";
      text: string;
      level: number;
      sourceTag: string;
      html: string;
    }
  | {
      id: string;
      anchor: string | null;
      type: "paragraph";
      text: string;
      html: string;
    }
  | {
      id: string;
      anchor: string | null;
      type: "list";
      ordered: boolean;
      items: string[];
      text: string;
      html: string;
    }
  | {
      id: string;
      anchor: string | null;
      type: "table";
      caption: string | null;
      headers: string[];
      rows: string[][];
      text: string;
      html: string;
    }
  | {
      id: string;
      anchor: string | null;
      type: "note";
      text: string;
      html: string;
    };

export type ExtractedSection = {
  content: string;
  rawHtml: string;
  blocks: FilingBlock[];
  outline: FilingOutlineNode[];
};

const IGNORED_TAGS = new Set(["script", "style", "head", "noscript"]);
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

function normalizeHeadingText(text: string) {
  return normalizePlainText(text)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function foldComparableText(text: string) {
  return normalizeHeadingText(text).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function isMeaningfulText(text: string) {
  return normalizePlainText(text).length > 0;
}

function isBoilerplateText(text: string) {
  const normalized = normalizePlainText(text);
  if (!normalized) return true;
  if (/^\d+$/.test(normalized)) return true;
  if (/^\$[0-9a-z]+$/i.test(normalized)) return true;
  if (/^Apple Inc\. \| \d{4} Form 10-K \| \d+$/i.test(normalized)) return true;
  if (/^Apple Inc\.$/i.test(normalized)) return true;
  if (/^Form 10-K$/i.test(normalized)) return true;
  if (/^Table of Contents$/i.test(normalized)) return true;
  return false;
}

function getNodeAnchor(node: Element) {
  const attrs = node.attribs ?? {};
  const anchor = attrs.id ?? attrs.name;
  return anchor ? anchor.trim() || null : null;
}

function getNodeTag(node: Element) {
  return node.tagName?.toLowerCase() ?? "";
}

function hasBlockDescendant(node: Element) {
  for (const child of node.children ?? []) {
    if (child.type !== "tag") continue;
    const tag = getNodeTag(child);
    if (BLOCK_CHILD_TAGS.has(tag) || HEADING_TAGS.has(tag)) return true;
  }
  return false;
}

function isLikelyHeadingText(text: string) {
  const normalized = normalizePlainText(text);
  if (!normalized) return false;
  if (normalized.length > 140) return false;
  if (/[:。.!?]$/.test(normalized)) return false;
  if (/^ITEM\s+\d+[A-Z]?\b/i.test(normalized)) return true;
  if (/^NOTE\s+\d+\b/i.test(normalized)) return true;

  const alphaCount = normalized.replace(/[^A-Za-z]/g, "").length;
  const upperCount = normalized.replace(/[^A-Z]/g, "").length;
  const upperRatio = upperCount / Math.max(alphaCount, 1);
  if (upperRatio > 0.7 && normalized.length < 120) return true;
  return /^[A-Z][A-Z0-9 ,&()\-/'"]+$/.test(normalized);
}

function isLikelyItemHeadingTable(text: string) {
  const normalized = normalizeHeadingText(text);
  if (!normalized) return false;
  if (normalized.length > 240) return false;
  if (!/^item\s+\d+[a-z]?\s*\./i.test(normalized)) return false;
  if (/\b(table of contents|page)\b/i.test(normalized)) return false;

  // TOC rows often collapse to "Item 1.Business1"; actual inline section
  // headings usually end with punctuation or a bracketed reserved marker.
  if (/\d{1,3}$/.test(normalized) && !/[.!?\]]$/.test(normalized)) return false;

  return true;
}

function guessHeadingLevel(text: string) {
  const normalized = normalizePlainText(text);
  if (/^ITEM\s+\d+[A-Z]?\b/i.test(normalized)) return 2;
  if (/^NOTE\s+\d+\b/i.test(normalized)) return 3;
  if (/^[A-Z][A-Z0-9 ,&()\-/'"]+$/.test(normalized) && normalized.length < 80) return 3;
  return 4;
}

function makeAnchor(text: string, index: number) {
  const base = normalizePlainText(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "block"}-${index}`;
}

function textFromCells($: CheerioAPI, row: Element) {
  const cells = $(row).children("th,td").toArray();
  return cells.map((cell) => normalizePlainText($(cell).text())).filter(Boolean);
}

function parseTable($: CheerioAPI, table: Element, blockId: string): FilingBlock | null {
  const caption = normalizePlainText($(table).children("caption").text()) || null;
  const directRows = $(table)
    .children("thead,tbody,tfoot")
    .children("tr")
    .toArray();
  const rows = directRows.length ? directRows : $(table).find("tr").toArray();
  if (!rows.length) return null;

  const parsedRows = rows
    .map((row) => textFromCells($, row))
    .filter((row) => row.length > 0);
  if (!parsedRows.length) return null;

  const headerCandidate = rows[0];
  const hasHeaderCells = $(headerCandidate).children("th").length > 0;
  const headers = hasHeaderCells ? parsedRows[0] ?? [] : [];
  const bodyRows = hasHeaderCells ? parsedRows.slice(1) : parsedRows;

  const text = [
    caption ? caption : null,
    headers.length ? headers.join(" | ") : null,
    ...bodyRows.map((row) => row.join(" | ")),
  ]
    .filter(Boolean)
    .join("\n");

  if (!isMeaningfulText(text)) return null;

  const tableHtml = $(table).clone();
  const existingClass = tableHtml.attr("class") ?? "";
  tableHtml.attr("class", `${existingClass} filing-reader-table`.trim());

  return {
    id: blockId,
    anchor: getNodeAnchor(table),
    type: "table",
    caption,
    headers,
    rows: bodyRows,
    text: normalizePlainText(text),
    html: `<div class="filing-reader-table-wrap">${$.html(tableHtml.get(0) as Element) ?? ""}</div>`,
  };
}

function parseList($: CheerioAPI, list: Element, blockId: string): FilingBlock | null {
  const ordered = getNodeTag(list) === "ol";
  const items = $(list)
    .children("li")
    .toArray()
    .map((li) => normalizePlainText($(li).text()))
    .filter(Boolean);
  if (!items.length) return null;

  return {
    id: blockId,
    anchor: getNodeAnchor(list),
    type: "list",
    ordered,
    items,
    text: items.map((item) => `- ${item}`).join("\n"),
    html: $.html(list) ?? "",
  };
}

function pushTextBlock(blocks: FilingBlock[], text: string, sourceTag: string, html: string, anchor: string | null) {
  const normalized = normalizePlainText(text);
  if (!normalized) return;
  if (isLikelyHeadingText(normalized)) {
    blocks.push({
      id: "",
      anchor,
      type: "heading",
      text: normalized,
      level: guessHeadingLevel(normalized),
      sourceTag,
      html,
    });
    return;
  }
  blocks.push({
    id: "",
    anchor,
    type: normalized.length < 120 && /(^NOTE\s+\d+\b|^[A-Z][A-Z0-9 ,&()\-/'"]+$)/i.test(normalized) ? "note" : "paragraph",
    text: normalized,
    html,
  } as FilingBlock);
}

function collectRenderableBlocks($: CheerioAPI, root: Element) {
  const blocks: FilingBlock[] = [];

  const visit = (node: Element) => {
    if (node.type !== "tag") return;
    const tag = getNodeTag(node);
    if (!tag || IGNORED_TAGS.has(tag)) return;
    if (tag === "li") return; // handled by the parent list

    const blockId = "";
    if (HEADING_TAGS.has(tag)) {
      const text = normalizePlainText($(node).text());
      if (text) {
        blocks.push({
          id: blockId,
          anchor: getNodeAnchor(node),
          type: "heading",
          text,
          level: Number(tag.slice(1)),
          sourceTag: tag,
          html: $.html(node) ?? "",
        });
      }
      return;
    }

    if (tag === "table") {
      const table = parseTable($, node, blockId);
      if (table) blocks.push(table);
      return;
    }

    if (tag === "ul" || tag === "ol") {
      const list = parseList($, node, blockId);
      if (list) blocks.push(list);
      return;
    }

    if (hasBlockDescendant(node)) {
      for (const child of node.children ?? []) {
        visit(child as Element);
      }
      return;
    }

    const text = normalizePlainText($(node).text());
    if (!text) return;
    pushTextBlock(blocks, text, tag, $.html(node) ?? "", getNodeAnchor(node));
  };

  visit(root);
  return blocks.filter((block) => normalizePlainText(block.text).length > 0);
}

function renderBlockText(block: FilingBlock) {
  switch (block.type) {
    case "heading":
    case "paragraph":
    case "note":
      return block.text;
    case "list":
      return block.items.map((item) => `- ${item}`).join("\n");
    case "table": {
      const rows = [] as string[];
      if (block.caption) rows.push(block.caption);
      if (block.headers.length) rows.push(block.headers.join(" | "));
      rows.push(...block.rows.map((row) => row.join(" | ")));
      return rows.join("\n");
    }
    default:
      return "";
  }
}

function buildOutline(blocks: FilingBlock[]) {
  const outline: FilingOutlineNode[] = [];
  const stack: FilingOutlineNode[] = [];

  blocks.forEach((block, index) => {
    const isHeadingBlock =
      block.type === "heading" ||
      (block.type === "paragraph" && isLikelyHeadingText(block.text)) ||
      (block.type === "note" && isLikelyHeadingText(block.text));
    if (!isHeadingBlock) return;

    const title = normalizePlainText(block.text);
    if (!title) return;

    const level = block.type === "heading" ? block.level : guessHeadingLevel(title);
    const node: FilingOutlineNode = {
      title,
      level,
      anchor: block.id || makeAnchor(title, index),
      children: [],
    };

    while (stack.length && stack[stack.length - 1].level >= node.level) {
      stack.pop();
    }
    if (!stack.length) {
      outline.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }
    stack.push(node);
  });

  return outline;
}

export function normalizeHtmlToText(html: string): string {
  const $ = cheerio.load(html);
  $("script,style,head,noscript,ix\\:hidden,ix\\:header").remove();
  const body = $("body").get(0);
  if (!body) return normalizePlainText($.root().text());
  const blocks = collectRenderableBlocks($, body);
  return blocks.map((block) => renderBlockText(block)).filter(Boolean).join("\n\n").trim();
}

export function findItemBoundaries(text: string): Array<{ itemNum: string; position: number }> {
  const boundaries: Array<{ itemNum: string; position: number }> = [];
  // Match true section headings like "Item 1. Business" / "Item 1A. Risk Factors" /
  // "Item 6. [Reserved]". Require a dot followed by a capital letter or '[' to
  // avoid matching inline references like "in Item 8 of this Form 10-K".
  const regex = /\bITEM\s+(\d+[A-Z]?)\b\.[ \t]*[A-Z\[]/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    boundaries.push({ itemNum: match[1].toUpperCase(), position: match.index });
  }
  return boundaries;
}

function getTemplate(kind: string): FilingTemplate {
  return FILING_TEMPLATES[kind as FilingKind] ?? FILING_TEMPLATES["10k"];
}

function matchSectionByHeading(
  text: string,
  template: FilingTemplate,
): TargetSection | null {
  const normalized = normalizeHeadingText(text);
  if (!normalized) return null;

  if (template.kind === "10k" || template.kind === "20f") {
    const itemMatch = normalized.match(/^item\s+(\d+[a-z]?)\b/i);
    if (!itemMatch) return null;
    const itemNum = itemMatch[1].toUpperCase();
    return template.sections.find((section) => section.itemNum === itemNum) ?? null;
  }

  return template.sections.find((section) =>
    (section.patterns ?? []).some((pattern) => pattern.test(normalized))
  ) ?? null;
}

function assignBlockIds(blocks: FilingBlock[], sectionKey: string) {
  return blocks.map((block, index) => ({
    ...block,
    id: block.anchor ?? `${sectionKey}-${index}-${makeAnchor(block.text, index)}`,
  }));
}

function extractSectionFromFragment(
  htmlFragment: string,
  sectionKey: string,
  sourceUrl?: string,
): ExtractedSection | null {
  const $ = cheerio.load(`<body>${htmlFragment}</body>`);
  $("script,style,head,noscript,ix\\:hidden,ix\\:header").remove();
  const body = $("body").get(0);
  if (!body) return null;

  const blocks = collectRenderableBlocks($, body);
  const filtered = blocks.filter((b) => b.type === "table" || !isBoilerplateText(b.text));
  if (!filtered.length) return null;

  const withIds = assignBlockIds(filtered, sectionKey);
  const content = withIds.map((b) => renderBlockText(b)).filter(Boolean).join("\n\n").trim();
  if (!content) return null;

  let rawHtml = withIds
    .map((b) => `<section id="${b.id}" class="filing-reader-html-block filing-reader-html-block--${b.type}">${b.html}</section>`)
    .join("\n");
  if (sourceUrl) rawHtml = resolveRelativeUrls(rawHtml, sourceUrl);

  return {
    content,
    rawHtml,
    blocks: withIds,
    outline: buildOutline(withIds),
  };
}

function escapeRegex(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type TocReference = {
  caption: string;
  location: string;
  page: number | null;
};

type PageFragment = {
  index: number;
  pageNumber: number | null;
  text: string;
  html: string;
};

function parsePageNumber(text: string) {
  const normalized = normalizeHeadingText(text);
  if (!normalized) return null;

  const annualReportMatch = normalized.match(/annual report\s*20\d{2}\s*(\d{1,3})(?!\d)/i);
  if (annualReportMatch) return Number(annualReportMatch[1]);

  const pageMatch = normalized.match(/\bpage\s+(\d{1,3})(?!\d)/i);
  if (pageMatch) return Number(pageMatch[1]);

  if (/^united statessecurities and exchange commission/i.test(normalized) && /form 20-f/i.test(normalized)) {
    return 1;
  }

  return null;
}

function fillInterpolatedPageNumbers(pages: PageFragment[]) {
  for (let i = 0; i < pages.length; i++) {
    if (pages[i]!.pageNumber !== null) continue;

    let prevIndex = i - 1;
    while (prevIndex >= 0 && pages[prevIndex]!.pageNumber === null) prevIndex--;

    let nextIndex = i + 1;
    while (nextIndex < pages.length && pages[nextIndex]!.pageNumber === null) nextIndex++;

    const prevPage = prevIndex >= 0 ? pages[prevIndex]!.pageNumber : null;
    const nextPage = nextIndex < pages.length ? pages[nextIndex]!.pageNumber : null;
    if (prevPage === null || nextPage === null) continue;

    const gap = nextIndex - prevIndex;
    if (nextPage - prevPage !== gap) continue;

    for (let j = prevIndex + 1; j < nextIndex; j++) {
      pages[j]!.pageNumber = prevPage + (j - prevIndex);
    }
    i = nextIndex;
  }
}

function collectPageFragments($: CheerioAPI) {
  const pages = $("body")
    .children("div")
    .toArray()
    .map((node, index) => {
      const style = ($(node).attr("style") ?? "").toLowerCase();
      if (style.includes("display:none")) return null;

      const text = normalizePlainText($(node).text());
      const html = $.html(node) ?? "";
      if (!text && !html) return null;

      return {
        index,
        pageNumber: parsePageNumber(text),
        text,
        html,
      } satisfies PageFragment;
    })
    .filter((page): page is PageFragment => page !== null);

  fillInterpolatedPageNumbers(pages);
  return pages;
}

function isUnavailableReference(text: string) {
  const normalized = normalizeHeadingText(text);
  return !normalized || /^(not applicable|none)$/i.test(normalized);
}

function is20FTocTable(tableText: string) {
  const normalized = normalizeHeadingText(tableText);
  return (
    normalized.includes("Form 20-F caption") &&
    normalized.includes("Location in this document") &&
    normalized.includes("Page")
  );
}

function parse20FTocReferences(
  $: CheerioAPI,
  template: FilingTemplate,
): Map<string, TocReference[]> {
  const references = new Map<string, TocReference[]>();
  const sectionsByItem = new Map(
    template.sections
      .filter((section) => section.itemNum)
      .map((section) => [section.itemNum!, section])
  );

  $("table").each((_, table) => {
    if (!is20FTocTable($(table).text())) return;

    let currentSection: TargetSection | null = null;

    $(table)
      .find("tr")
      .each((rowIndex, row) => {
        const cells = $(row)
          .children("th,td")
          .toArray()
          .map((cell) => normalizeHeadingText($(cell).text()));
        if (!cells.some(Boolean)) return;
        if (rowIndex === 0 && cells.some((cell) => cell === "Item")) return;

        const [itemCell = "", captionCell = "", locationCell = "", pageCell = ""] = cells;
        if (/^part\b/i.test(itemCell)) {
          currentSection = null;
          return;
        }

        if (itemCell) {
          currentSection = sectionsByItem.get(itemCell.toUpperCase()) ?? null;
        }
        if (!currentSection) return;

        const page = pageCell && /^\d{1,3}$/.test(pageCell) ? Number(pageCell) : null;
        const location = locationCell && !isUnavailableReference(locationCell) ? locationCell : "";
        const caption = captionCell && !isUnavailableReference(captionCell) ? captionCell : "";
        if (!location && !caption && page === null) return;

        if (!references.has(currentSection.key)) references.set(currentSection.key, []);
        const items = references.get(currentSection.key)!;
        const duplicate = items.some(
          (item) => item.caption === caption && item.location === location && item.page === page
        );
        if (!duplicate) {
          items.push({ caption, location, page });
        }
      });
  });

  return references;
}

function collectReferencedPageNumbers(
  section: TargetSection,
  references: TocReference[],
): number[] {
  const directPages = references
    .map((reference) => reference.page)
    .filter((page): page is number => page !== null)
    .sort((a, b) => a - b);

  if (!directPages.length) return [];

  const pages = new Set<number>();
  for (let i = 0; i < directPages.length; i++) {
    const current = directPages[i]!;
    const next = directPages[i + 1] ?? null;
    pages.add(current);

    if (next !== null) {
      const gap = next - current;
      if (gap > 1 && gap <= 3) {
        for (let page = current + 1; page < next; page++) {
          pages.add(page);
        }
      }
    }
  }

  const pageWindow = section.pageWindow ?? 0;
  if (pageWindow > 0) {
    const lastPage = directPages[directPages.length - 1]!;
    for (let offset = 1; offset <= pageWindow; offset++) {
      pages.add(lastPage + offset);
    }
  }

  return [...pages].sort((a, b) => a - b);
}

function extractVia20FCrossReferenceTables(
  $: CheerioAPI,
  template: FilingTemplate,
  sourceUrl?: string,
): Record<string, ExtractedSection> {
  const referencesBySection = parse20FTocReferences($, template);
  if (!referencesBySection.size) return {};

  const pages = collectPageFragments($);
  const pagesByNumber = new Map(
    pages
      .filter((page) => page.pageNumber !== null)
      .map((page) => [page.pageNumber!, page])
  );

  const result: Record<string, ExtractedSection> = {};

  for (const section of template.sections) {
    const references = referencesBySection.get(section.key) ?? [];
    const pageNumbers = collectReferencedPageNumbers(section, references);
    if (!pageNumbers.length) continue;

    const fragments = pageNumbers
      .map((pageNumber) => pagesByNumber.get(pageNumber)?.html ?? null)
      .filter((fragment): fragment is string => Boolean(fragment));
    if (!fragments.length) continue;

    const extracted = extractSectionFromFragment(fragments.join("\n"), section.key, sourceUrl);
    if (extracted) result[section.key] = extracted;
  }

  return result;
}

function findAnchorPosition(html: string, anchorId: string) {
  const regex = new RegExp(`(?:id|name)=["']${escapeRegex(anchorId)}["']`, "i");
  return html.search(regex);
}

function extractViaTocAnchors(
  $: CheerioAPI,
  html: string,
  template: FilingTemplate,
  sourceUrl?: string,
): Record<string, ExtractedSection> {
  const candidates = new Map<string, Map<string, number>>();
  const sectionsByKey = new Map(template.sections.map((section) => [section.key, section]));

  $("a[href^='#']").each((_, link) => {
    const href = ($(link).attr("href") ?? "").trim();
    const anchorId = href.replace(/^#/, "").trim();
    if (!anchorId) return;

    const text = normalizeHeadingText($(link).text());
    if (!text) return;
    const foldedText = foldComparableText(text);

    for (const section of template.sections) {
      const itemMatch = section.itemNum
        ? new RegExp(`^item${section.itemNum.toLowerCase()}$|^item${section.itemNum.toLowerCase()}\\.?$`)
        : null;
      const labelFolded = foldComparableText(section.label);
      const matchesItem = itemMatch ? itemMatch.test(foldedText) : false;
      const matchesLabel = labelFolded ? foldedText.includes(labelFolded) || labelFolded.includes(foldedText) : false;
      if (!matchesItem && !matchesLabel) continue;

      if (!candidates.has(section.key)) candidates.set(section.key, new Map());
      const counts = candidates.get(section.key)!;
      counts.set(anchorId, (counts.get(anchorId) ?? 0) + 1);
    }
  });

  const boundaries: Array<{ key: string; anchorId: string; position: number }> = [];

  for (const [key, counts] of candidates.entries()) {
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!best) continue;
    const [anchorId] = best;
    const position = findAnchorPosition(html, anchorId);
    if (position < 0) continue;
    boundaries.push({ key, anchorId, position });
  }

  boundaries.sort((a, b) => a.position - b.position);
  const deduped = boundaries.filter((boundary, index, arr) => index === arr.findIndex((item) => item.key === boundary.key));
  if (!deduped.length) return {};

  const result: Record<string, ExtractedSection> = {};
  for (let i = 0; i < deduped.length; i++) {
    const current = deduped[i];
    const next = deduped[i + 1];
    const fragment = html.slice(current.position, next ? next.position : html.length);
    const section = sectionsByKey.get(current.key);
    if (!section) continue;
    const extracted = extractSectionFromFragment(fragment, current.key, sourceUrl);
    if (extracted) result[current.key] = extracted;
  }

  return result;
}

function resolveRelativeUrls(html: string, sourceUrl: string): string {
  try {
    const base = new URL(sourceUrl);
    return html.replace(/(src|href)=['"]([^'"]+)['"]/g, (match, attr, url) => {
      if (/^(https?:|data:|#|mailto:|javascript:)/i.test(url)) return match;
      const absolute = new URL(url, base).href;
      return `${attr}="${absolute}"`;
    });
  } catch {
    return html;
  }
}

export function extractTargetSections(
  html: string,
  sourceUrl?: string,
  filingKind: FilingKind = "10k",
): Record<string, ExtractedSection> {
  const template = getTemplate(filingKind);
  const $ = cheerio.load(html);
  $("script,style,head,noscript,ix\\:hidden,ix\\:header").remove();
  const body = $("body").get(0);
  if (!body) return {};

  if (template.preferTocAnchors) {
    const tocResult = extractViaTocAnchors($, html, template, sourceUrl);
    if (Object.keys(tocResult).length >= Math.max(3, Math.floor(template.sections.length * 0.2))) {
      return tocResult;
    }
  }

  if (template.kind === "20f") {
    const crossReferenceResult = extractVia20FCrossReferenceTables($, template, sourceUrl);
    if (Object.keys(crossReferenceResult).length >= Math.max(6, Math.floor(template.sections.length * 0.3))) {
      return crossReferenceResult;
    }
  }

  const blocks = collectRenderableBlocks($, body);
  if (!blocks.length) return {};

  // Find all Item heading blocks by index. Use block-level identity so
  // inline references like "see Item 8" are never treated as boundaries.
  const itemBoundaries: Array<{ key: string; blockIndex: number }> = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const text = normalizeHeadingText(block.text);

    const isHeading =
      block.type === "heading" ||
      (block.type === "paragraph" && isLikelyHeadingText(text)) ||
      (block.type === "table" && isLikelyItemHeadingTable(text));
    if (!isHeading) continue;

    const target = matchSectionByHeading(text, template);
    if (!target) continue;

    itemBoundaries.push({ key: target.key, blockIndex: i });
  }

  // Deduplicate: keep only the first occurrence of each Item
  const seen = new Set<string>();
  const unique = itemBoundaries
    .filter((b) => {
      if (seen.has(b.key)) return false;
      seen.add(b.key);
      return true;
    })
    .sort((a, b) => a.blockIndex - b.blockIndex);

  if (!unique.length) return {};

  const result: Record<string, ExtractedSection> = {};

  for (let i = 0; i < unique.length; i++) {
    const { key } = unique[i];
    const start = unique[i].blockIndex;
    const end = i + 1 < unique.length ? unique[i + 1].blockIndex : blocks.length;

    const sectionBlocks = blocks.slice(start, end);
    const filtered = sectionBlocks.filter(
      (b) => b.type === "table" || !isBoilerplateText(b.text)
    );
    if (!filtered.length) continue;

    const withIds = assignBlockIds(filtered, key);
    const content = withIds.map((b) => renderBlockText(b)).filter(Boolean).join("\n\n").trim();

    let rawHtml = withIds
      .map((b) => `<section id="${b.id}" class="filing-reader-html-block filing-reader-html-block--${b.type}">${b.html}</section>`)
      .join("\n");

    if (sourceUrl) rawHtml = resolveRelativeUrls(rawHtml, sourceUrl);

    if (!content) continue;

    result[key] = { content, rawHtml, blocks: withIds, outline: buildOutline(withIds) };
  }

  return result;
}
