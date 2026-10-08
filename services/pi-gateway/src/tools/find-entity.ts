import type { Pool } from "pg";
import { pool } from "../db.js";

export type EntityMatch = {
  id: string;
  name: string | null;
  ticker: string | null;
};

/**
 * Shared entity lookup across pi-gateway tools (get_company_analysis, search_filings).
 *
 * Resolves a company ticker, Chinese/English name, or common alias (e.g. SpaceX -> SPACE EXPLORATION TECHNOLOGIES CORP).
 *
 * Scoring priority:
 * 1. Exact ticker match (UPPER(ticker) = UPPER(query)) -> score 100
 * 2. Exact alias match (UPPER(alias) = UPPER(query)) -> score 90
 * 3. Exact name match (canonicalName, metadata.nameZh, metadata.nameEnShort) -> score 85
 * 4. Prefix match on name/alias -> score 60
 * 5. Substring match on alias -> score 40
 * 6. Substring match on name -> score 30
 *
 * Ties are broken by onboardPhase DESC (onboarded Phase 2 company wins over Phase 0 stub) and id ASC.
 */
export async function findEntity(
  company: string,
  dbPool: Pool = pool,
): Promise<EntityMatch | null> {
  const trimmed = company.trim();
  if (!trimmed) return null;

  const sql = `
    SELECT id, "canonicalName" AS name, ticker
    FROM "Entity"
    WHERE UPPER(ticker) = UPPER($1)
       OR "canonicalName" ILIKE $2
       OR metadata->>'nameZh' ILIKE $2
       OR metadata->>'nameEnShort' ILIKE $2
       OR array_to_string(aliases, ' ') ILIKE $2
    ORDER BY
      CASE
        WHEN UPPER(ticker) = UPPER($1) THEN 100
        WHEN EXISTS (SELECT 1 FROM unnest(aliases) a WHERE UPPER(a) = UPPER($1)) THEN 90
        WHEN UPPER("canonicalName") = UPPER($1)
          OR UPPER(metadata->>'nameZh') = UPPER($1)
          OR UPPER(metadata->>'nameEnShort') = UPPER($1) THEN 85
        WHEN "canonicalName" ILIKE $1 || '%'
          OR metadata->>'nameZh' ILIKE $1 || '%'
          OR metadata->>'nameEnShort' ILIKE $1 || '%' THEN 60
        WHEN EXISTS (SELECT 1 FROM unnest(aliases) a WHERE a ILIKE $2) THEN 40
        ELSE 30
      END DESC,
      "onboardPhase" DESC,
      id ASC
    LIMIT 1
  `;
  const r = await dbPool.query<EntityMatch>(sql, [trimmed, `%${trimmed}%`]);
  return r.rows[0] ?? null;
}
