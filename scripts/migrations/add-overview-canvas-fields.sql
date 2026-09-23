-- 为 CompanyAnalysis 表添加新字段
-- overview: 统一的公司概览（3句话）
-- canvas: 业务画布（从 business.canvas 迁移）

ALTER TABLE "CompanyAnalysis" ADD COLUMN IF NOT EXISTS "overview" TEXT;
ALTER TABLE "CompanyAnalysis" ADD COLUMN IF NOT EXISTS "canvas" JSONB;

-- 注释说明
COMMENT ON COLUMN "CompanyAnalysis"."overview" IS '统一的公司概览（不超过3句话）：公司是什么 + 主打产品 + 主营收入';
COMMENT ON COLUMN "CompanyAnalysis"."canvas" IS '业务画布（9 sections）';
COMMENT ON COLUMN "CompanyAnalysis"."profile" IS 'DEPRECATED: 迁移到 overview';
COMMENT ON COLUMN "CompanyAnalysis"."business" IS 'DEPRECATED: canvas 部分迁移到 canvas 字段，narrative 部分废弃';
