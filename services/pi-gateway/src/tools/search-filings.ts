import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { pool } from "../db.js";

// Friendly alias → one or more exact section keys (ordered by priority)
const SECTION_ALIASES: Record<string, string[]> = {
  business:    ["item_1_business", "item_4_company_information"],
  risk:        ["item_1a_risk_factors"],
  mda:         ["item_7_mda", "item_5_operating_financial_review", "management_discussion_and_analysis"],
  financial:   ["item_8_financial_statements", "item_8_financial_information", "item_17_financial_statements", "item_18_financial_statements_us_gaap"],
  notes:       ["item_8_notes"],
  cybersecurity: ["item_1c_cybersecurity", "item_16k_cybersecurity"],
  compensation: ["item_11_compensation"],
  governance:  ["item_16g_corporate_governance"],
  market_risk: ["item_7a_market_risk", "item_11_market_risk"],
  properties:  ["item_2_properties"],
  legal:       ["item_3_legal"],
};


const MAX_CONTENT_CHARS = 4000;
const EXCERPT_WINDOW = 1800;

type SectionRow = {
  section: string;
  content: string;
  content_text_length: number;
  period_year: number | null;
  company_name: string | null;
  ticker: string | null;
};

type AvailableSection = {
  section: string;
  content_text_length: number;
  period_year: number | null;
};

function resolveSectionKeys(section: string | null): string[] | null {
  if (!section) return null;
  const alias = section.toLowerCase().trim().replace(/[\s-]/g, "_");
  return SECTION_ALIASES[alias] ?? [alias];
}

function extractExcerpt(content: string, keyword: string | null): string {
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

function formatSectionLabel(key: string): string {
  return key
    .replace(/^item_\d+[a-z]?_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

async function getAvailableSections(entityId: string, year: number | null): Promise<AvailableSection[]> {
  const params: unknown[] = [entityId];
  const yearFilter = year != null ? `AND es."periodYear" = $2` : "";
  if (year != null) params.push(year);

  const r = await pool.query<AvailableSection>(
    `SELECT fs.section, fs."contentTextLength" AS content_text_length, es."periodYear" AS period_year
     FROM "FilingSection" fs
     JOIN "ExtSource" es ON es.id = fs."sourceId"
     WHERE fs."entityId" = $1 ${yearFilter}
       AND fs."contentTextLength" > 100
     ORDER BY es."periodYear" DESC, fs.section`,
    params,
  );
  return r.rows;
}

async function findEntity(company: string): Promise<{ id: string; name: string | null; ticker: string | null } | null> {
  const r = await pool.query<{ id: string; name: string | null; ticker: string | null }>(
    `SELECT id, "canonicalName" AS name, ticker
     FROM "Entity"
     WHERE UPPER(ticker) = UPPER($1)
        OR "canonicalName" ILIKE $2
     ORDER BY (UPPER(ticker) = UPPER($1)) DESC
     LIMIT 1`,
    [company, `%${company}%`],
  );
  return r.rows[0] ?? null;
}

async function querySections(
  entityId: string,
  sectionKeys: string[],
  year: number | null,
  limit: number,
): Promise<SectionRow[]> {
  const params: unknown[] = [entityId, sectionKeys];
  const yearClause = year != null ? `AND es."periodYear" = $3` : "";
  if (year != null) params.push(year);
  params.push(limit);

  const r = await pool.query<SectionRow>(
    `SELECT fs.section, fs.content, fs."contentTextLength" AS content_text_length,
            es."periodYear" AS period_year,
            ce."canonicalName" AS company_name, ce.ticker
     FROM "FilingSection" fs
     JOIN "ExtSource" es ON es.id = fs."sourceId"
     JOIN "Entity" ce ON ce.id = fs."entityId"
     WHERE fs."entityId" = $1
       AND fs.section = ANY($2::text[])
       AND fs."contentTextLength" > 100
       ${yearClause}
     ORDER BY es."periodYear" DESC, fs.section
     LIMIT $${params.length}`,
    params,
  );
  return r.rows;
}

export const searchFilingsTool = defineTool({
  name: "search_filings",
  label: "Search Annual Reports",
  description:
    "Search annual report (10-K/20-F) sections for any public company. Returns relevant content from business description, MD&A, risk factors, financial statements, and more. Data covers ~120 companies from 2020–2025.",
  promptSnippet: "search_filings(company, section?, year?, keyword?) → annual report content",
  parameters: Type.Object({
    company: Type.String({
      description: "Company ticker (e.g. AAPL) or partial name (e.g. Apple)",
    }),
    section: Type.Optional(Type.String({
      description: "Section to retrieve: business | mda | risk | financial | notes | cybersecurity | market_risk | compensation | governance | properties | legal — or an exact section key like item_7_mda. Omit to see available sections.",
    })),
    year: Type.Optional(Type.Number({
      description: "Fiscal year of the filing (e.g. 2024). Omit for most recent.",
    })),
    keyword: Type.Optional(Type.String({
      description: "Keyword or phrase to find within the section content. Returns a relevant excerpt around the match.",
    })),
  }),
  async execute(_toolCallId, params, signal) {
    const { company, section, year, keyword } = params;

    let entity: { id: string; name: string | null; ticker: string | null } | null;
    try {
      entity = await findEntity(company);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: `DB error: ${msg}` }], details: null };
    }

    if (!entity) {
      return {
        content: [{ type: "text" as const, text: `No filing data found for "${company}". The database covers ~120 companies (2020–2025). Try a ticker like AAPL or MSFT.` }],
        details: { count: 0 },
      };
    }

    if (signal?.aborted) {
      return { content: [{ type: "text" as const, text: "Search cancelled." }], details: null };
    }

    const sectionKeys = resolveSectionKeys(section ?? null);

    // No section specified → list available sections + return default sections
    if (!sectionKeys) {
      let available: AvailableSection[];
      try {
        available = await getAvailableSections(entity.id, year ?? null);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `DB error: ${msg}` }], details: null };
      }

      if (available.length === 0) {
        return {
          content: [{ type: "text" as const, text: `No filing sections found for ${entity.name ?? company}${year ? ` (${year})` : ""}.` }],
          details: { count: 0 },
        };
      }

      const years = [...new Set(available.map((r) => r.period_year).filter(Boolean))].sort((a, b) => (b ?? 0) - (a ?? 0));
      const sectionList = available.map((r) => `- ${r.section} (${r.content_text_length.toLocaleString()} chars, ${r.period_year})`).join("\n");
      const header = `**${entity.name ?? company} (${entity.ticker ?? "—"})** — Filing sections available\nYears: ${years.join(", ")}\n\n${sectionList}\n\nUse search_filings with a \`section\` parameter to retrieve content.`;

      return { content: [{ type: "text" as const, text: header }], details: { count: available.length } };
    }

    let rows: SectionRow[];
    try {
      rows = await querySections(entity.id, sectionKeys, year ?? null, 3);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: `DB error: ${msg}` }], details: null };
    }

    if (rows.length === 0) {
      return {
        content: [{ type: "text" as const, text: `Section "${section}" not found for ${entity.name ?? company}${year ? ` (${year})` : ""}. Try omitting the section parameter to see what's available.` }],
        details: { count: 0 },
      };
    }

    const parts = rows.map((row) => {
      const label = formatSectionLabel(row.section);
      const excerpt = extractExcerpt(row.content, keyword ?? null);
      return `**${row.company_name ?? company} · ${label} · ${row.period_year}**\n\n${excerpt}`;
    });

    const text = parts.join("\n\n---\n\n");
    return { content: [{ type: "text" as const, text: text }], details: { count: rows.length } };
  },
});
