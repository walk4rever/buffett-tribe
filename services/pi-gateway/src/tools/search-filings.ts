import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { pool } from "../db.js";
import { extractTargetSections, type FilingKind } from "../shared/extract-10k-sections.js";
import { resolveSectionKeys, extractExcerpt, formatSectionLabel } from "./search-filings-format.js";

type SectionRow = {
  section: string;
  content: string;
  content_text_length: number;
  period_year: number | null;
  company_name: string | null;
  ticker: string | null;
  source_id: string;
  filing_kind: string;
  source_url: string | null;
};

// Primary filing HTML can be several MB; observed R2 fetch+body-read latency
// varies widely (sub-second to 2+ minutes depending on network conditions),
// so this errs generous — a slow fetch still falls back to the content
// preview rather than failing the tool call outright.
const FULL_TEXT_FETCH_TIMEOUT_MS = 45_000;

type AvailableSection = {
  section: string;
  content_text_length: number;
  period_year: number | null;
};

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
            ce."canonicalName" AS company_name, ce.ticker,
            es.id AS source_id, es.kind AS filing_kind, es.url AS source_url
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

async function fetchPrimaryHtmlUrl(sourceId: string): Promise<string | null> {
  const r = await pool.query<{ public_url: string | null }>(
    `SELECT "publicUrl" AS public_url
     FROM "FilingArtifact"
     WHERE "sourceId" = $1 AND kind = 'primary_html'
     ORDER BY "createdAt" ASC
     LIMIT 1`,
    [sourceId],
  );
  return r.rows[0]?.public_url ?? null;
}

// FilingSection.content is a lightweight preview/legacy field, not guaranteed
// to hold the full section text (see incident notes: section-level R2
// artifacts were retired once the reader moved to an iframe over the
// original filing, and `content` was separately truncated for large
// sections). Re-derive full text on demand from the original filing HTML,
// which is never truncated, using the same parser used at import time.
async function fetchFullSectionContent(
  row: Pick<SectionRow, "source_id" | "section" | "filing_kind" | "source_url">,
  signal: AbortSignal | undefined,
): Promise<string | null> {
  try {
    const publicUrl = await fetchPrimaryHtmlUrl(row.source_id);
    if (!publicUrl) return null;

    const timeoutSignal = AbortSignal.timeout(FULL_TEXT_FETCH_TIMEOUT_MS);
    const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

    const res = await fetch(publicUrl, { signal: combinedSignal });
    if (!res.ok) return null;
    const html = await res.text();

    const sections = extractTargetSections(html, row.source_url ?? undefined, row.filing_kind as FilingKind);
    return sections[row.section]?.content ?? null;
  } catch {
    return null;
  }
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

    const parts = await Promise.all(rows.map(async (row) => {
      const label = formatSectionLabel(row.section);
      const fullContent = await fetchFullSectionContent(row, signal);
      const excerpt = extractExcerpt(fullContent ?? row.content, keyword ?? null);
      return `**${row.company_name ?? company} · ${label} · ${row.period_year}**\n\n${excerpt}`;
    }));

    const text = parts.join("\n\n---\n\n");
    return { content: [{ type: "text" as const, text: text }], details: { count: rows.length } };
  },
});
