-- Phase E of retiring the mirrored/split company-analysis storage (see TODO.md
-- 「数据架构：停止 GeneratedContentVersion 镜像」). Follows the additive phase A
-- migration (20260808120000_split_company_analysis_fields) + application-layer
-- backfill (scripts/backfill-company-analysis-fields.ts) + a soak period on the
-- new CompanyAnalysis.{profile,business,moat,management,valuation} fields.
-- Drops the now-fully-superseded BusinessCanvas/BusinessCanvasVersion tables
-- and the old CompanyAnalysis.narrative column. GeneratedContentVersion rows
-- for the 5 retired company-scope artifact types were deleted separately
-- (DML, not part of this migration) — the table itself stays for
-- master_profile/portfolio_insight, which are unaffected.
ALTER TABLE "BusinessCanvasVersion" DROP CONSTRAINT "BusinessCanvasVersion_businessCanvasId_fkey";
ALTER TABLE "BusinessCanvasVersion" DROP CONSTRAINT "BusinessCanvasVersion_entityId_fkey";
ALTER TABLE "BusinessCanvas" DROP CONSTRAINT "BusinessCanvas_entityId_fkey";

DROP TABLE "BusinessCanvasVersion";
DROP TABLE "BusinessCanvas";

ALTER TABLE "CompanyAnalysis" DROP COLUMN "narrative";
