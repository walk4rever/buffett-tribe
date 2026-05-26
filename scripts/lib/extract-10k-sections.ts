/**
 * Shared 10-K section extraction.
 *
 * Pure functions — no I/O, no DB. Used by:
 *   - scripts/import-10k-xbrl.ts (inline during import, reuses already-fetched HTML)
 *   - scripts/extract-10k-sections.ts (backfill tool for filings imported before this was wired)
 */

export type TargetSection = { key: string; itemNum: string; label: string };

// Sections we care about, mapped from SEC Item numbers
export const TARGET_SECTIONS: TargetSection[] = [
  { key: "item_1_business", itemNum: "1", label: "BUSINESS" },
  { key: "item_1a_risk_factors", itemNum: "1A", label: "RISK FACTORS" },
  { key: "item_1b_staff_comments", itemNum: "1B", label: "UNRESOLVED STAFF COMMENTS" },
  { key: "item_2_properties", itemNum: "2", label: "PROPERTIES" },
  { key: "item_3_legal", itemNum: "3", label: "LEGAL PROCEEDINGS" },
  { key: "item_7_mda", itemNum: "7", label: "MANAGEMENT" },
  { key: "item_7a_market_risk", itemNum: "7A", label: "MARKET RISK" },
  { key: "item_8_notes", itemNum: "8", label: "FINANCIAL STATEMENTS" },
];

export function normalizeHtmlToText(html: string): string {
  return (
    html
      // Remove XBRL metadata that pollutes text (before other stripping)
      .replace(/<ix:hidden[\s\S]*?<\/ix:hidden>/gi, "")
      .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, "")
      // Remove script, style, head, noscript
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<head[\s\S]*?<\/head>/gi, "")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
      // Convert block tags to newlines
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/tr>/gi, "\n")
      .replace(/<td[^\u003e]*>/gi, " ")
      // Strip remaining tags
      .replace(/<[^\u003e]+>/g, "")
      // Decode common entities
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      // Clean whitespace
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n\s*\n+/g, "\n\n")
      .trim()
  );
}

export function findItemBoundaries(text: string): Array<{ itemNum: string; position: number }> {
  const boundaries: Array<{ itemNum: string; position: number }> = [];
  // Match "ITEM 1." / "ITEM 1A." / "ITEM 1 BUSINESS" / "ITEM 1A RISK FACTORS" etc.
  const regex = /\bITEM\s+(\d+[A-Z]?)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    boundaries.push({ itemNum: match[1].toUpperCase(), position: match.index });
  }
  return boundaries;
}

export function extractTargetSections(html: string): Record<string, string> {
  const text = normalizeHtmlToText(html);
  const allBoundaries = findItemBoundaries(text);
  if (allBoundaries.length === 0) return {};

  // Strategy: the real document sections have much more content than TOC entries.
  // Find the occurrence of each itemNum that has the largest distance to the next boundary.
  const bestBoundaries = new Map<string, { position: number; distance: number }>();
  for (let i = 0; i < allBoundaries.length - 1; i++) {
    const b = allBoundaries[i];
    const dist = allBoundaries[i + 1].position - b.position;
    const existing = bestBoundaries.get(b.itemNum);
    if (!existing || dist > existing.distance) {
      bestBoundaries.set(b.itemNum, { position: b.position, distance: dist });
    }
  }
  // Handle last boundary (no next boundary)
  const last = allBoundaries[allBoundaries.length - 1];
  if (!bestBoundaries.has(last.itemNum)) {
    bestBoundaries.set(last.itemNum, { position: last.position, distance: text.length - last.position });
  }

  const sorted = [...bestBoundaries.entries()]
    .map(([num, data]) => ({ num, pos: data.position }))
    .sort((a, b) => a.pos - b.pos);

  const result: Record<string, string> = {};

  for (const target of TARGET_SECTIONS) {
    const idx = sorted.findIndex((s) => s.num === target.itemNum);
    if (idx === -1) continue;

    const start = sorted[idx].pos;
    const end = idx < sorted.length - 1 ? sorted[idx + 1].pos : text.length;
    let content = text.slice(start, end).trim();

    // Strip the leading "ITEM X. TITLE" header line
    const headerRegex = new RegExp(
      `^ITEM\\s+${target.itemNum.replace(".", "\\.")}\\s*[.\\-]?\\s*${target.label.replace(/\s/g, "\\s*")}[^\\n]*`,
      "i",
    );
    content = content.replace(headerRegex, "").trim();

    // Skip if too short (likely a false match)
    if (content.length < 200) continue;

    result[target.key] = content;
  }

  return result;
}
