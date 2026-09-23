/**
 * 添加 overview 和 canvas 字段到 CompanyAnalysis 表
 */
import prisma from "@/lib/prisma";

async function main() {
  console.log("Adding overview and canvas columns to CompanyAnalysis table...\n");

  try {
    // 添加 overview 字段（TEXT）
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "CompanyAnalysis"
      ADD COLUMN IF NOT EXISTS "overview" TEXT;
    `);
    console.log("✓ Added 'overview' column");

    // 添加 canvas 字段（JSONB）
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "CompanyAnalysis"
      ADD COLUMN IF NOT EXISTS "canvas" JSONB;
    `);
    console.log("✓ Added 'canvas' column");

    // 添加注释
    await prisma.$executeRawUnsafe(`
      COMMENT ON COLUMN "CompanyAnalysis"."overview" IS '统一的公司概览（不超过3句话）：公司是什么 + 主打产品 + 主营收入';
    `);
    await prisma.$executeRawUnsafe(`
      COMMENT ON COLUMN "CompanyAnalysis"."canvas" IS '业务画布（9 sections）';
    `);
    await prisma.$executeRawUnsafe(`
      COMMENT ON COLUMN "CompanyAnalysis"."profile" IS 'DEPRECATED: 迁移到 overview';
    `);
    await prisma.$executeRawUnsafe(`
      COMMENT ON COLUMN "CompanyAnalysis"."business" IS 'DEPRECATED: canvas 部分迁移到 canvas 字段，narrative 部分废弃';
    `);
    console.log("✓ Added column comments\n");

    console.log("Migration completed successfully!");
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
