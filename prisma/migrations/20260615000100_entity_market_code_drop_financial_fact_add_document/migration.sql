-- Entity: add market + code for non-US markets; add composite index
ALTER TABLE "Entity" ADD COLUMN IF NOT EXISTS "market" TEXT;
ALTER TABLE "Entity" ADD COLUMN IF NOT EXISTS "code" TEXT;
CREATE INDEX IF NOT EXISTS "Entity_market_code_idx" ON "Entity"("market", "code");

-- Drop FinancialFact (0 rows, blood lineage broken; lineage now stored as R2 artifact objectKeys in Financial.sourceFactIds)
DROP TABLE IF EXISTS "FinancialFact";

-- Document: master PDF/speech/article library (migrated from src/lib/documents.ts hardcoded array)
CREATE TABLE IF NOT EXISTS "Document" (
  "id"         TEXT NOT NULL PRIMARY KEY,
  "ownerId"    TEXT NOT NULL,
  "title"      TEXT NOT NULL,
  "subtitle"   TEXT,
  "badge"      TEXT,
  "rawPath"    TEXT NOT NULL,
  "readerPath" TEXT NOT NULL,
  "apiPath"    TEXT NOT NULL,
  "sortOrder"  INTEGER NOT NULL DEFAULT 0,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "Document_ownerId_idx" ON "Document"("ownerId");
