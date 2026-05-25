-- Add Security table for physical split from Entity(type='security')
CREATE TABLE IF NOT EXISTS "Security" (
  "id" TEXT PRIMARY KEY,
  "entityId" TEXT NOT NULL UNIQUE,
  "companyEntityId" TEXT,
  "ticker" TEXT,
  "cusip" TEXT UNIQUE,
  "shareClass" TEXT,
  "titleOfClass" TEXT,
  "exchange" TEXT,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "metadata" JSONB,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE "Security"
  ADD CONSTRAINT "Security_entityId_fkey"
  FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Security"
  ADD CONSTRAINT "Security_companyEntityId_fkey"
  FOREIGN KEY ("companyEntityId") REFERENCES "Entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "Security_ticker_idx" ON "Security"("ticker");
CREATE INDEX IF NOT EXISTS "Security_companyEntityId_idx" ON "Security"("companyEntityId");

ALTER TABLE "Holding" ADD COLUMN IF NOT EXISTS "securityId" TEXT;
CREATE INDEX IF NOT EXISTS "Holding_securityId_asOfDate_idx" ON "Holding"("securityId", "asOfDate");

ALTER TABLE "Holding"
  ADD CONSTRAINT "Holding_securityId_fkey"
  FOREIGN KEY ("securityId") REFERENCES "Security"("id") ON DELETE SET NULL ON UPDATE CASCADE;
