-- Phase A of retiring the mirrored/split company-analysis storage (see TODO.md
-- 「数据架构：停止 GeneratedContentVersion 镜像」). Purely additive: new nullable
-- columns for the 5-field CompanyAnalysis shape, old "narrative" column relaxed
-- to nullable (kept as a safety net, not written to going forward) rather than
-- dropped. BusinessCanvas/BusinessCanvasVersion tables and the "narrative"
-- column itself are dropped in a later follow-up migration once the new
-- columns have been backfilled and verified in production.
ALTER TABLE "CompanyAnalysis"
  ADD COLUMN "profile" JSONB,
  ADD COLUMN "business" JSONB,
  ADD COLUMN "management" JSONB,
  ADD COLUMN "valuation" JSONB,
  ALTER COLUMN "moat" DROP NOT NULL,
  ALTER COLUMN "narrative" DROP NOT NULL;
