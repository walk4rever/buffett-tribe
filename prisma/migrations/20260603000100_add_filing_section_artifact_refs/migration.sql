SET statement_timeout = '10min';

ALTER TABLE "FilingSection"
ADD COLUMN IF NOT EXISTS "contentPreview" TEXT,
ADD COLUMN IF NOT EXISTS "contentTextLength" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "blockCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "extractionVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS "textArtifactId" TEXT,
ADD COLUMN IF NOT EXISTS "blocksArtifactId" TEXT,
ADD COLUMN IF NOT EXISTS "htmlArtifactId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'FilingSection_textArtifactId_fkey'
  ) THEN
    ALTER TABLE "FilingSection"
    ADD CONSTRAINT "FilingSection_textArtifactId_fkey"
    FOREIGN KEY ("textArtifactId") REFERENCES "FilingArtifact"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'FilingSection_blocksArtifactId_fkey'
  ) THEN
    ALTER TABLE "FilingSection"
    ADD CONSTRAINT "FilingSection_blocksArtifactId_fkey"
    FOREIGN KEY ("blocksArtifactId") REFERENCES "FilingArtifact"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'FilingSection_htmlArtifactId_fkey'
  ) THEN
    ALTER TABLE "FilingSection"
    ADD CONSTRAINT "FilingSection_htmlArtifactId_fkey"
    FOREIGN KEY ("htmlArtifactId") REFERENCES "FilingArtifact"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "FilingSection_textArtifactId_idx" ON "FilingSection"("textArtifactId");
CREATE INDEX IF NOT EXISTS "FilingSection_blocksArtifactId_idx" ON "FilingSection"("blocksArtifactId");
CREATE INDEX IF NOT EXISTS "FilingSection_htmlArtifactId_idx" ON "FilingSection"("htmlArtifactId");
