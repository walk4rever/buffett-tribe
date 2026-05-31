-- Promote SEC accession number out of metadata JSON into a first-class column,
-- then enforce uniqueness per (filerEntityId, accessionNumber) so the same
-- filing can never be ingested twice. Postgres unique indexes treat each NULL
-- as distinct, so non-SEC rows (price/13f without accession) are unaffected.

-- 1. Add the column.
ALTER TABLE "ExtSource" ADD COLUMN "accessionNumber" TEXT;

-- 2. Backfill from metadata. Older imports wrote `accession` (10-K/20-F), some
-- wrote `accno` (13-F), newer ones wrote `accessionNumber`. Coalesce all three
-- so every shape is picked up.
UPDATE "ExtSource"
SET "accessionNumber" = COALESCE(
  NULLIF(TRIM(metadata->>'accessionNumber'), ''),
  NULLIF(TRIM(metadata->>'accession'), ''),
  NULLIF(TRIM(metadata->>'accno'), '')
)
WHERE "accessionNumber" IS NULL
  AND metadata IS NOT NULL;

-- 3. Enforce uniqueness. The dedupe script (scripts/dedupe-ext-source-filings.ts)
-- must be applied before this migration runs.
CREATE UNIQUE INDEX "ExtSource_filer_accession_unique"
  ON "ExtSource" ("filerEntityId", "accessionNumber");
