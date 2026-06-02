-- Treat every pre-history current business canvas as the first managed version.
-- The legacy BusinessCanvas.version column may have been incremented by older
-- overwrite runs; versionSeq is the new source of truth and starts at V1.

UPDATE "BusinessCanvas"
SET
  "version" = 1,
  "versionSeq" = 1
WHERE "versionSeq" IS NOT NULL;

UPDATE "BusinessCanvasVersion"
SET "versionSeq" = 1
WHERE "promptVersion" = 'business-canvas-v1'
  AND NOT EXISTS (
    SELECT 1
    FROM "BusinessCanvasVersion" sibling
    WHERE sibling."entityId" = "BusinessCanvasVersion"."entityId"
      AND sibling."id" <> "BusinessCanvasVersion"."id"
  );
