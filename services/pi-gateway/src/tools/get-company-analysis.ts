import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { pool } from "../db.js";

// The 5 fields on CompanyAnalysis written by scripts/generate-*.ts during
// onboarding (see scripts/onboard-company.ts) — the same content rendered on
// the company page tabs. master_profile / portfolio_insight are a different
// scope (master, not company) and out of scope for this tool.
const ARTIFACT_TYPES = [
  "profile",
  "business",
  "moat",
  "management",
  "valuation",
] as const;
type ArtifactType = (typeof ARTIFACT_TYPES)[number];

const ARTIFACT_LABELS: Record<ArtifactType, string> = {
  profile: "Company Profile",
  business: "Business Overview & Model",
  moat: "Moat / Value Analysis",
  management: "Management Analysis (capital allocation, alignment)",
  valuation: "Valuation Analysis (scenarios, multiples)",
};

function isArtifactType(value: string): value is ArtifactType {
  return (ARTIFACT_TYPES as readonly string[]).includes(value);
}

type EntityRow = { id: string; name: string | null; ticker: string | null };

// Same resolution as search_filings' findEntity: canonicalName is always the
// English legal name, CN/HK entities' Chinese name lives in metadata.nameZh.
async function findEntity(company: string): Promise<EntityRow | null> {
  const r = await pool.query<EntityRow>(
    `SELECT id, "canonicalName" AS name, ticker
     FROM "Entity"
     WHERE UPPER(ticker) = UPPER($1)
        OR "canonicalName" ILIKE $2
        OR metadata->>'nameZh' ILIKE $2
        OR metadata->>'nameEnShort' ILIKE $2
     ORDER BY (UPPER(ticker) = UPPER($1)) DESC
     LIMIT 1`,
    [company, `%${company}%`],
  );
  return r.rows[0] ?? null;
}

type ArtifactRow = { artifact_type: string; payload: unknown; generated_at: string };

async function queryArtifacts(entityId: string, types: readonly string[]): Promise<ArtifactRow[]> {
  const r = await pool.query<Record<string, unknown>>(
    `SELECT profile, business, moat, management, valuation, "updatedAt"::text AS updated_at
     FROM "CompanyAnalysis"
     WHERE "entityId" = $1`,
    [entityId],
  );
  const row = r.rows[0];
  if (!row) return [];
  const updatedAt = row.updated_at as string;
  return types
    .filter((type) => row[type] != null)
    .map((type) => ({ artifact_type: type, payload: row[type], generated_at: updatedAt }));
}

export const getCompanyAnalysisTool = defineTool({
  name: "get_company_analysis",
  label: "Get Buffett Tribe Company Analysis",
  description:
    "Fetch Buffett Tribe's own generated analysis for a company — the same synthesized content shown on the company page tabs: profile (company basics), business (business model & canvas), moat (competitive advantage), management (capital allocation, alignment), valuation (scenarios, multiples). Prefer this over search_filings when the question is about a conclusion or assessment (moat strength, valuation scenarios, management capital allocation) — it's already synthesized from filings and financials. Use search_filings instead when the question needs exact filing quotes or raw text.",
  promptSnippet: "get_company_analysis(company, artifactType?) → generated profile/business/moat/management/valuation analysis",
  parameters: Type.Object({
    company: Type.String({
      description: "Company ticker (e.g. AAPL, 9992.HK, or 600519.SS) or partial name in English or Chinese (e.g. Apple, 泡泡玛特)",
    }),
    artifactType: Type.Optional(Type.String({
      description: `Which analysis to fetch: ${ARTIFACT_TYPES.join(" | ")}. Omit to get all available for this company.`,
    })),
  }),
  async execute(_toolCallId, params, signal) {
    const { company, artifactType } = params;

    let entity: EntityRow | null;
    try {
      entity = await findEntity(company);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: `DB error: ${msg}` }], details: null };
    }

    if (!entity) {
      return {
        content: [{ type: "text" as const, text: `No company found matching "${company}".` }],
        details: { count: 0 },
      };
    }

    if (signal?.aborted) {
      return { content: [{ type: "text" as const, text: "Cancelled." }], details: null };
    }

    const types = artifactType && isArtifactType(artifactType) ? [artifactType] : ARTIFACT_TYPES;

    let rows: ArtifactRow[];
    try {
      rows = await queryArtifacts(entity.id, types);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: `DB error: ${msg}` }], details: null };
    }

    if (rows.length === 0) {
      return {
        content: [{
          type: "text" as const,
          text: `No generated analysis found for ${entity.name ?? company}${artifactType ? ` (${artifactType})` : ""}. This company may not have been fully onboarded yet.`,
        }],
        details: { count: 0 },
      };
    }

    const label = entity.ticker ? `${entity.name ?? company} (${entity.ticker})` : entity.name ?? company;
    const parts = rows.map((row) => {
      const typeLabel = isArtifactType(row.artifact_type) ? ARTIFACT_LABELS[row.artifact_type] : row.artifact_type;
      return `**${label} — ${typeLabel}** (generated ${row.generated_at.slice(0, 10)})\n\n${JSON.stringify(row.payload, null, 2)}`;
    });

    return { content: [{ type: "text" as const, text: parts.join("\n\n---\n\n") }], details: { count: rows.length } };
  },
});
