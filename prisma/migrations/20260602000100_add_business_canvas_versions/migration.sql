-- Add current-version metadata and immutable history for company business canvases.
-- Existing current canvases are initialized as V1 and snapshotted into history.

ALTER TABLE "BusinessCanvas" ADD COLUMN "versionSeq" INTEGER;
ALTER TABLE "BusinessCanvas" ADD COLUMN "promptVersion" TEXT NOT NULL DEFAULT 'business-canvas-v1';
ALTER TABLE "BusinessCanvas" ADD COLUMN "generatedAt" TIMESTAMP(3);

UPDATE "BusinessCanvas"
SET
  "versionSeq" = COALESCE("version", 1),
  "generatedAt" = COALESCE("updatedAt", "createdAt", CURRENT_TIMESTAMP)
WHERE "versionSeq" IS NULL
   OR "generatedAt" IS NULL;

ALTER TABLE "BusinessCanvas" ALTER COLUMN "versionSeq" SET DEFAULT 1;
ALTER TABLE "BusinessCanvas" ALTER COLUMN "versionSeq" SET NOT NULL;
ALTER TABLE "BusinessCanvas" ALTER COLUMN "generatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "BusinessCanvas" ALTER COLUMN "generatedAt" SET NOT NULL;

CREATE TABLE "BusinessCanvasVersion" (
    "id" TEXT NOT NULL,
    "businessCanvasId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "versionSeq" INTEGER NOT NULL,
    "canvas" JSONB NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'llm',
    "promptVersion" TEXT NOT NULL DEFAULT 'business-canvas-v1',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "filingLabel" TEXT,
    "filingAccession" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessCanvasVersion_pkey" PRIMARY KEY ("id")
);

INSERT INTO "BusinessCanvasVersion" (
  "id",
  "businessCanvasId",
  "entityId",
  "versionSeq",
  "canvas",
  "source",
  "promptVersion",
  "generatedAt",
  "createdAt"
)
SELECT
  'bcv_' || md5("id" || ':' || "versionSeq"::text),
  "id",
  "entityId",
  "versionSeq",
  "canvas",
  "source",
  "promptVersion",
  "generatedAt",
  CURRENT_TIMESTAMP
FROM "BusinessCanvas"
ON CONFLICT DO NOTHING;

CREATE UNIQUE INDEX "BusinessCanvasVersion_entityId_versionSeq_key"
  ON "BusinessCanvasVersion" ("entityId", "versionSeq");

CREATE INDEX "BusinessCanvasVersion_businessCanvasId_idx"
  ON "BusinessCanvasVersion" ("businessCanvasId");

CREATE INDEX "BusinessCanvasVersion_entityId_idx"
  ON "BusinessCanvasVersion" ("entityId");

ALTER TABLE "BusinessCanvasVersion"
  ADD CONSTRAINT "BusinessCanvasVersion_businessCanvasId_fkey"
  FOREIGN KEY ("businessCanvasId") REFERENCES "BusinessCanvas"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BusinessCanvasVersion"
  ADD CONSTRAINT "BusinessCanvasVersion_entityId_fkey"
  FOREIGN KEY ("entityId") REFERENCES "Entity"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
