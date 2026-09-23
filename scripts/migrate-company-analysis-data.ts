/**
 * 迁移现有 CompanyAnalysis 数据到新字段
 * - profile.content → overview
 * - business.canvas → canvas
 */
import prisma from "@/lib/prisma";

type BeforeStatsRow = {
  total: bigint | number;
  has_overview: bigint | number;
  has_canvas: bigint | number;
  has_profile_content: bigint | number;
  has_business_canvas: bigint | number;
};

type AfterStatsRow = {
  total: bigint | number;
  has_overview: bigint | number;
  has_canvas: bigint | number;
};

type SampleRow = {
  id: string;
  ticker: string | null;
  canonicalName: string;
  overview: string | null;
  canvas_type: string | null;
};

async function main() {
  console.log("=== Migrate CompanyAnalysis Data ===\n");

  // 1. 查询迁移前的状态
  const beforeStats = await prisma.$queryRawUnsafe<BeforeStatsRow[]>(`
    SELECT
      count(*) as total,
      count(overview) as has_overview,
      count(canvas) as has_canvas,
      count(CASE WHEN profile IS NOT NULL AND profile->>'content' IS NOT NULL THEN 1 END) as has_profile_content,
      count(CASE WHEN business IS NOT NULL AND business->'canvas' IS NOT NULL THEN 1 END) as has_business_canvas
    FROM "CompanyAnalysis";
  `);

  console.log("Before migration:", {
    total: Number(beforeStats[0].total),
    has_overview: Number(beforeStats[0].has_overview),
    has_canvas: Number(beforeStats[0].has_canvas),
    has_profile_content: Number(beforeStats[0].has_profile_content),
    has_business_canvas: Number(beforeStats[0].has_business_canvas),
  });

  // 2. 执行批量数据迁移 (SQL 原生更新，高效且原子化)
  const updatedCount = await prisma.$executeRawUnsafe(`
    UPDATE "CompanyAnalysis"
    SET
      "overview" = COALESCE("overview", "profile"->>'content'),
      "canvas" = COALESCE("canvas", "business"->'canvas')
    WHERE
      ("overview" IS NULL AND "profile" IS NOT NULL AND "profile"->>'content' IS NOT NULL)
      OR ("canvas" IS NULL AND "business" IS NOT NULL AND "business"->'canvas' IS NOT NULL);
  `);

  console.log(`\nUpdated rows: ${updatedCount}`);

  // 3. 验证迁移后的状态
  const afterStats = await prisma.$queryRawUnsafe<AfterStatsRow[]>(`
    SELECT
      count(*) as total,
      count(overview) as has_overview,
      count(canvas) as has_canvas
    FROM "CompanyAnalysis";
  `);

  console.log("\nAfter migration:", {
    total: Number(afterStats[0].total),
    has_overview: Number(afterStats[0].has_overview),
    has_canvas: Number(afterStats[0].has_canvas),
  });

  // 4. 抽取样例检查
  const sample = await prisma.$queryRawUnsafe<SampleRow[]>(`
    SELECT
      ca.id,
      e.ticker,
      e."canonicalName",
      ca.overview,
      jsonb_typeof(ca.canvas) as canvas_type
    FROM "CompanyAnalysis" ca
    JOIN "Entity" e ON e.id = ca."entityId"
    LIMIT 3;
  `);

  console.log("\nSamples:");
  for (const s of sample) {
    console.log(`- [${s.ticker || "N/A"}] ${s.canonicalName}`);
    console.log(`  overview: ${s.overview ? s.overview.slice(0, 60) + "..." : "null"}`);
    console.log(`  canvas type: ${s.canvas_type}`);
  }

  console.log("\n=== Migration Completed Successfully ===");
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Migration failed:", err);
  await prisma.$disconnect();
  process.exit(1);
});

