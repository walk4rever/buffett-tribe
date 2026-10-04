#!/usr/bin/env tsx
import prisma from "../src/lib/prisma";

async function main() {
  const total = await prisma.entity.count({ where: { type: "company" } });
  const hasClassification = await prisma.entity.count({
    where: { type: "company", sectorModelType: { not: null } },
  });
  const unknown = await prisma.entity.count({
    where: { type: "company", sectorModelType: "unknown" },
  });

  console.log("总公司数:", total);
  console.log("已分类:", hasClassification);
  console.log("未分类:", total - hasClassification);
  console.log("Unknown:", unknown);

  // 检查 Phase > 0 的公司分类情况（排除 Phase 0 和 Phase -1）
  const activeTotal = await prisma.entity.count({
    where: {
      type: "company",
      onboardPhase: { gt: 0 },
    },
  });

  const activeHasClassification = await prisma.entity.count({
    where: {
      type: "company",
      onboardPhase: { gt: 0 },
      sectorModelType: { not: null },
    },
  });

  const activeNoClassification = activeTotal - activeHasClassification;

  console.log("\nPhase > 0 公司（排除 Phase 0 和 Phase -1）:");
  console.log("  总数:", activeTotal);
  console.log("  已分类:", activeHasClassification);
  console.log("  未分类:", activeNoClassification);
  console.log("  覆盖率:", ((activeHasClassification / activeTotal) * 100).toFixed(1) + "%");

  if (activeNoClassification > 0) {
    console.log("\n未分类的 Phase > 0 公司（全部 " + activeNoClassification + " 家）:");
    const samples = await prisma.entity.findMany({
      where: {
        type: "company",
        onboardPhase: { gt: 0 },
        sectorModelType: null,
      },
      select: {
        ticker: true,
        canonicalName: true,
        onboardPhase: true,
        market: true,
      },
      orderBy: { onboardPhase: "desc" },
    });
    samples.forEach((s) =>
      console.log(`  ${s.ticker || "N/A"} - ${s.canonicalName} (Phase ${s.onboardPhase}, ${s.market})`)
    );
  }

  const distribution = await prisma.$queryRaw<Array<{ sectorModelType: string; count: bigint }>>`
    SELECT "sectorModelType", COUNT(*) as count
    FROM "Entity"
    WHERE type = 'company' AND "sectorModelType" IS NOT NULL
    GROUP BY "sectorModelType"
    ORDER BY count DESC
    LIMIT 20
  `;

  console.log("\n分类分布:");
  distribution.forEach((r) => console.log("  " + r.sectorModelType + ":", Number(r.count)));

  await prisma.$disconnect();
}

main();
