-- Add structured section payloads for annual report reader
ALTER TABLE "FilingSection"
ADD COLUMN IF NOT EXISTS "outlineJson" JSONB,
ADD COLUMN IF NOT EXISTS "blocksJson" JSONB;
