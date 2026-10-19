import { pool } from "../db.js";
import { findEntity, type EntityMatch } from "./find-entity.js";

export type CompanyAnalysisSection = "overview" | "canvas" | "moat";

type AnalysisRow = {
  overview: string | null;
  canvas: unknown;
  profile: unknown;
  business: unknown;
  moat: unknown;
  updated_at: string;
};

export type AnalysisSectionResult = {
  text: string;
  details: {
    found: boolean;
    artifactType: CompanyAnalysisSection;
    source: "canonical" | "legacy" | null;
    truncated: boolean;
  };
};

const MAX_ARTIFACT_CHARS = 20_000;

const SECTION_LABELS: Record<CompanyAnalysisSection, string> = {
  overview: "Company Overview",
  canvas: "Business Model Canvas",
  moat: "Moat / Competitive Advantage",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : null;
}

function textFromProfile(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  const record = asRecord(value);
  if (!record) return null;
  const content = typeof record.content === "string" ? record.content.trim() : "";
  const title = typeof record.title === "string" ? record.title.trim() : "";
  if (content) return [title, content].filter(Boolean).join("\n\n");
  return null;
}

function canvasFromLegacyBusiness(value: unknown): unknown {
  const record = asRecord(value);
  if (!record) return value;
  return record.canvas ?? value;
}

function stringify(value: unknown): string {
  return typeof value === "string" ? value.trim() : JSON.stringify(value, null, 2);
}

function truncate(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_ARTIFACT_CHARS) return { text, truncated: false };
  return {
    text: `${text.slice(0, MAX_ARTIFACT_CHARS)}\n\n[Analysis truncated at ${MAX_ARTIFACT_CHARS.toLocaleString()} characters]`,
    truncated: true,
  };
}

async function queryAnalysis(entityId: string): Promise<AnalysisRow | null> {
  const result = await pool.query<AnalysisRow>(
    `SELECT overview, canvas, profile, business, moat,
            to_char("updatedAt", 'YYYY-MM-DD') AS updated_at
     FROM "CompanyAnalysis"
     WHERE "entityId" = $1
     LIMIT 1`,
    [entityId],
  );
  return result.rows[0] ?? null;
}

function selectSection(
  row: AnalysisRow,
  section: CompanyAnalysisSection,
): { value: unknown; source: "canonical" | "legacy" } | null {
  if (section === "overview") {
    if (typeof row.overview === "string" && row.overview.trim()) {
      return { value: row.overview.trim(), source: "canonical" };
    }
    const legacy = textFromProfile(row.profile);
    return legacy ? { value: legacy, source: "legacy" } : null;
  }

  if (section === "canvas") {
    if (row.canvas != null) return { value: row.canvas, source: "canonical" };
    if (row.business != null) {
      return { value: canvasFromLegacyBusiness(row.business), source: "legacy" };
    }
    return null;
  }

  return row.moat != null ? { value: row.moat, source: "canonical" } : null;
}

function emptyMessage(entity: EntityMatch, section: CompanyAnalysisSection): string {
  const company = entity.ticker
    ? `${entity.name ?? "Unknown company"} (${entity.ticker})`
    : entity.name ?? "This company";
  return `No generated ${SECTION_LABELS[section].toLowerCase()} found for ${company}. The company may not be fully onboarded.`;
}

export async function getCompanyAnalysisSection(
  company: string,
  section: CompanyAnalysisSection,
  signal?: AbortSignal,
): Promise<AnalysisSectionResult> {
  const entity = await findEntity(company);
  if (!entity) {
    return {
      text: `No company found matching "${company}".`,
      details: { found: false, artifactType: section, source: null, truncated: false },
    };
  }
  if (signal?.aborted) {
    return {
      text: "Cancelled.",
      details: { found: false, artifactType: section, source: null, truncated: false },
    };
  }

  let row: AnalysisRow | null;
  try {
    row = await queryAnalysis(entity.id);
  } catch (error) {
    return {
      text: `DB error: ${error instanceof Error ? error.message : String(error)}`,
      details: { found: false, artifactType: section, source: null, truncated: false },
    };
  }
  if (!row) {
    return {
      text: emptyMessage(entity, section),
      details: { found: false, artifactType: section, source: null, truncated: false },
    };
  }

  const selected = selectSection(row, section);
  if (!selected) {
    return {
      text: emptyMessage(entity, section),
      details: { found: false, artifactType: section, source: null, truncated: false },
    };
  }

  const formatted = truncate(stringify(selected.value));
  const companyLabel = entity.ticker
    ? `${entity.name ?? company} (${entity.ticker})`
    : entity.name ?? company;
  const generated = row.updated_at ? ` · generated ${row.updated_at}` : "";
  const legacy = selected.source === "legacy" ? " · legacy fallback" : "";
  return {
    text: `**${companyLabel} — ${SECTION_LABELS[section]}**${generated}${legacy}\n\n${formatted.text}`,
    details: {
      found: true,
      artifactType: section,
      source: selected.source,
      truncated: formatted.truncated,
    },
  };
}
