CREATE TABLE IF NOT EXISTS "FilingSectionExtractionJob" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "extractionVersion" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 1,
  "sectionCount" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "lastErrorCode" TEXT,
  "workerId" TEXT,
  "lockedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "nextRunAt" TIMESTAMP(3),
  "lastDurationMs" INTEGER,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "FilingSectionExtractionJob_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'FilingSectionExtractionJob_sourceId_fkey'
  ) THEN
    ALTER TABLE "FilingSectionExtractionJob"
    ADD CONSTRAINT "FilingSectionExtractionJob_sourceId_fkey"
    FOREIGN KEY ("sourceId") REFERENCES "ExtSource"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "FilingSectionExtractionJob_sourceId_extractionVersion_key"
  ON "FilingSectionExtractionJob"("sourceId", "extractionVersion");

CREATE INDEX IF NOT EXISTS "FilingSectionExtractionJob_status_nextRunAt_idx"
  ON "FilingSectionExtractionJob"("status", "nextRunAt");

CREATE INDEX IF NOT EXISTS "FilingSectionExtractionJob_sourceId_idx"
  ON "FilingSectionExtractionJob"("sourceId");

CREATE INDEX IF NOT EXISTS "FilingSectionExtractionJob_updatedAt_idx"
  ON "FilingSectionExtractionJob"("updatedAt");
