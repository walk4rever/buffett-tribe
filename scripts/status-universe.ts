/**
 * Inspect the progress and distribution of the 16,435 Master Universe
 * across Phase 0 (Stub), Phase 1 (Base Onboarded), and Phase 2 (Deep Analyzed).
 *
 * Usage:
 *   npm run status:universe
 */

import prisma from "@/lib/prisma";

async function main() {
  console.log("\n=======================================================");
  console.log("       BUFFETT TRIBE - MASTER UNIVERSE PIPELINE        ");
  console.log("=======================================================\n");

  const [totalCompanies, phaseCounts, marketPhaseCounts, recentPhase1, failedCount] = await Promise.all([
    prisma.entity.count({ where: { type: "company" } }),
    prisma.$queryRaw<Array<{ onboardPhase: number; count: bigint }>>`
      SELECT "onboardPhase", count(*) as count
      FROM "Entity"
      WHERE type = 'company'
      GROUP BY "onboardPhase"
      ORDER BY "onboardPhase" ASC;
    `,
    prisma.$queryRaw<Array<{ market: string; onboardPhase: number; count: bigint }>>`
      SELECT COALESCE(market, 'unknown') as market, "onboardPhase", count(*) as count
      FROM "Entity"
      WHERE type = 'company'
      GROUP BY market, "onboardPhase"
      ORDER BY market ASC, "onboardPhase" ASC;
    `,
    prisma.entity.findMany({
      where: {
        type: "company",
        onboardPhase: 1,
      },
      select: {
        ticker: true,
        market: true,
        canonicalName: true,
        updatedAt: true,
        metadata: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 8,
    }),
    prisma.entity.count({
      where: {
        type: "company",
        onboardPhase: -1,
      },
    }),
  ]);

  const phaseMap: Record<number, number> = {};
  for (const row of phaseCounts) {
    phaseMap[row.onboardPhase] = Number(row.count);
  }

  const p0 = phaseMap[0] ?? 0;
  const p1 = phaseMap[1] ?? 0;
  const p2 = phaseMap[2] ?? 0;
  const pErr = failedCount;

  const pct = (n: number) => ((n / (totalCompanies || 1)) * 100).toFixed(1) + "%";

  console.log(`Total Universe: ${totalCompanies.toLocaleString()} Companies\n`);
  console.log(`  [Phase 0]  待处理 (Master Universe Stubs):   ${p0.toLocaleString().padStart(6)} (${pct(p0)})`);
  console.log(`  [Phase 1]  已建档 (10-K/财报 + 量价历史):      ${p1.toLocaleString().padStart(6)} (${pct(p1)})`);
  console.log(`  [Phase 2]  深度分析 (完整五维 LLM 研报+画布):  ${p2.toLocaleString().padStart(6)} (${pct(p2)})`);
  if (pErr > 0) {
    console.log(`  [Phase -1] 异常/死信池 (需人工审计):          ${pErr.toLocaleString().padStart(6)} (${pct(pErr)})`);
  }

  console.log("\n--- Market Breakdown ---");
  const markets = ["us", "hk", "cn"];
  const marketNames: Record<string, string> = { us: "美股 (US)", hk: "港股 (HK)", cn: "A股 (CN)" };

  for (const m of markets) {
    const rows = marketPhaseCounts.filter((r) => r.market === m);
    const mP0 = Number(rows.find((r) => r.onboardPhase === 0)?.count ?? 0);
    const mP1 = Number(rows.find((r) => r.onboardPhase === 1)?.count ?? 0);
    const mP2 = Number(rows.find((r) => r.onboardPhase === 2)?.count ?? 0);
    const mTotal = mP0 + mP1 + mP2;
    console.log(
      `  ${(marketNames[m] || m).padEnd(12)} | Total: ${mTotal.toLocaleString().padStart(5)} | P0: ${mP0.toString().padStart(5)} | P1: ${mP1.toString().padStart(4)} | P2: ${mP2.toString().padStart(3)}`
    );
  }

  if (recentPhase1.length > 0) {
    console.log("\n--- Recently Onboarded to Phase 1 ---");
    for (const c of recentPhase1) {
      const meta = c.metadata as Record<string, unknown> | null;
      const zh = (typeof meta?.nameZh === "string" && meta.nameZh) || c.canonicalName;
      const date = c.updatedAt ? c.updatedAt.toISOString().slice(0, 19).replace("T", " ") : "—";
      console.log(`  • [${(c.market ?? "us").toUpperCase()}] ${(c.ticker ?? "—").padEnd(10)} ${zh.slice(0, 16).padEnd(16)} (${date})`);
    }
  }

  console.log("\n=======================================================\n");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("Failed to query status:", e);
  await prisma.$disconnect();
  process.exit(1);
});
