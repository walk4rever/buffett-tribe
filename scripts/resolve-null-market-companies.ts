/**
 * 解决 NULL 市场公司归位问题：
 * 1. 将 299 家已有 CIK 和财务数据的历史美股公司统一补齐 market: 'us'
 * 2. 将 10 家在交易但缺失 CIK/market 的优质美股补齐真实 CIK 和 market: 'us'
 * 3. 将剩余 13 家（私募独角兽、已退市收购、破产重组、SPAC）补齐 ticker 和 market: 'us'，并记录状态元数据
 *
 * 执行后：整个数据库中不再有任何 market: null 的公司（NULL 市场清零）。
 *
 * 用法：
 *   node --env-file=.env.local ./node_modules/.bin/tsx scripts/resolve-null-market-companies.ts --dry-run
 *   node --env-file=.env.local ./node_modules/.bin/tsx scripts/resolve-null-market-companies.ts
 */
import prisma from "@/lib/prisma";

const REAL_US_COMPANIES = [
  { ticker: "WDC", cik: "0000106040", name: "Western Digital Corp", entityId: "cmrpshqkz0038rsmaov7w17xm" },
  { ticker: "BFB", cik: "0000014693", name: "Brown-Forman Corp", entityId: "cmsd8zupx0030rsaj135rc9qi" },
  { ticker: "CPRX", cik: "0001369568", name: "Catalyst Pharmaceuticals, Inc.", entityId: "cmsd8xuod001nrsajrg3hebpp" },
  { ticker: "CEIX", cik: "0001710366", name: "CONSOL Energy Inc.", entityId: "cmsdt2rmu0013rsbk3w23h9a3" },
  { ticker: "CWAN", cik: "0001866368", name: "Clearwater Analytics Holdings, Inc.", entityId: "cmq7j8v9e000grs2xxt98i596" },
  { ticker: "JNPR", cik: "0001043604", name: "JUNIPER NETWORKS INC", entityId: "cmq612qmp0075rsu0ylbk74dc" },
  { ticker: "LBRDK", cik: "0001611983", name: "Liberty Broadband Corp", entityId: "cmscstce5003grs9hxhlj1h70" },
  { ticker: "OLPX", cik: "0001868726", name: "Olaplex Holdings, Inc.", entityId: "cmq6196hz00csrsu0w9s90fwq" },
  { ticker: "RDFN", cik: "0001382821", name: "Redfin Corp", entityId: "cmq619xui00dirsu0oatmtgid" },
  { ticker: "SEGRT", cik: "0002009684", name: "Seaport Entertainment Group Inc.", entityId: "cmsrko9th000arsaew1fd1nzn" },
];

const SPECIAL_NULL_COMPANIES: Record<string, { ticker?: string; companyType: string }> = {
  cmstpvwa5000ursadurdnbbsf: { ticker: "CBRS", companyType: "private_unicorn" }, // CEREBRAS SYSTEMS INC
  cmstpw4qm0016rsadvff9g5sv: { ticker: "INIO", companyType: "private" },         // INNIO NV
  cmstpw6cm0019rsad5andkobf: { ticker: "QNT", companyType: "private_unicorn" },  // QUANTINUUM INC
  cmstq65wj001krs6hg0l5lp74: { ticker: "USDEW", companyType: "private" },       // STABLECOINX INC
  cmq7j4h4z0008rsrf14c76y27: { ticker: "AVLR", companyType: "acquired" },        // AVALARA INC (Vista)
  cmq7j90lc000jrs2xa7td5xzf: { ticker: "ESMT", companyType: "acquired" },        // ENGAGESMART INC (Vista)
  cmq7iwxbu003zrsteeq8gsiwy: { ticker: "KNBE", companyType: "acquired" },        // KNOWBE4 INC (Vista)
  cmsfasbcm002lrsjaleim8jb1: { ticker: "UNVR", companyType: "acquired" },        // UNIVAR SOLUTIONS INC (Apollo)
  cmq7j0z6v006xrstep9h2miq0: { ticker: "RSVA", companyType: "spac" },            // RODGERS SILICON VALLEY AQ CO
  cmq6177mc00b0rsu0rjjxty4f: { ticker: "BRDS", companyType: "bankrupt" },        // BIRD GLOBAL INC
  cmq60sl40004trs9x9f2ont9f: { ticker: "SONDQ", companyType: "bankrupt" },       // SONDER HOLDINGS INC
  cmq61627f00a2rsu0fmolb703: { ticker: "STRYQ", companyType: "bankrupt" },       // STARRY GROUP HOLDINGS INC
  cmq61995o00cvrsu05lzc0rvm: { ticker: "AGCUU", companyType: "spac" },           // ALTIMETER GROWTH CORP
};

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`\n=== 解决 NULL 市场公司归位 ${dryRun ? "(DRY RUN)" : "(LIVE)"} ===\n`);

  // 1. 299 家已有 CIK 但 market 为 NULL 的公司
  const nullWithCik = await prisma.entity.findMany({
    where: {
      type: "company",
      market: null,
      cik: { not: null },
    },
    select: { id: true, ticker: true, canonicalName: true },
  });
  console.log(`1. 发现 ${nullWithCik.length} 家已有 CIK 但 market 为 NULL 的历史美股公司。`);

  if (!dryRun) {
    const res = await prisma.entity.updateMany({
      where: {
        type: "company",
        market: null,
        cik: { not: null },
      },
      data: { market: "us" },
    });
    console.log(`   ✓ 已将这 ${res.count} 家公司的 market 全部更新为 'us'。\n`);
  } else {
    console.log(`   [DRY RUN] 将把这 ${nullWithCik.length} 家公司的 market 设置为 'us'。\n`);
  }

  // 2. 10 家在交易但此前缺失 CIK/market 的美股公司
  console.log(`2. 补齐 10 家真实在交易美股公司的 CIK 与 market:`);
  for (const item of REAL_US_COMPANIES) {
    const existing = await prisma.entity.findUnique({
      where: { id: item.entityId },
      select: { id: true, ticker: true, canonicalName: true, metadata: true },
    });
    if (!existing) {
      console.log(`   ⚠️ 未找到实体: ${item.ticker} (${item.entityId})`);
      continue;
    }
    console.log(`   - [${item.ticker}] ${existing.canonicalName} -> CIK: ${item.cik}, market: 'us'`);

    if (!dryRun) {
      const meta = (existing.metadata as Record<string, unknown> | null) || {};
      await prisma.entity.update({
        where: { id: item.entityId },
        data: {
          ticker: item.ticker,
          market: "us",
          cik: item.cik,
          metadata: {
            ...meta,
            cikVerifiedAt: new Date().toISOString(),
          },
        },
      });
    }
  }
  console.log(`   ${dryRun ? "[DRY RUN] " : "✓ "}10 家真实美股公司 CIK 与 market 处理完毕。\n`);

  // 3. 剩余 13 家特殊 NULL 公司（私募、收购、破产、SPAC）
  console.log(`3. 归位 13 家特殊标的（私募股权、已退市并购、破产、SPAC）:`);
  for (const [entityId, info] of Object.entries(SPECIAL_NULL_COMPANIES)) {
    const existing = await prisma.entity.findUnique({
      where: { id: entityId },
      select: { id: true, ticker: true, canonicalName: true, metadata: true },
    });
    if (!existing) {
      console.log(`   ⚠️ 未找到实体: ${entityId}`);
      continue;
    }
    const finalTicker = existing.ticker || info.ticker || null;
    console.log(`   - [${finalTicker}] ${existing.canonicalName} -> market: 'us', type: ${info.companyType}`);

    if (!dryRun) {
      const meta = (existing.metadata as Record<string, unknown> | null) || {};
      await prisma.entity.update({
        where: { id: entityId },
        data: {
          ticker: finalTicker,
          market: "us",
          metadata: {
            ...meta,
            companyStatus: info.companyType,
            marketClassifiedAt: new Date().toISOString(),
          },
        },
      });
    }
  }
  console.log(`   ${dryRun ? "[DRY RUN] " : "✓ "}13 家特殊标的归位完毕。\n`);

  // 4. 验证更新后市场分布
  if (!dryRun) {
    const after = await prisma.entity.groupBy({
      by: ["market"],
      where: { type: "company" },
      _count: { _all: true },
    });
    console.log("=== 更新后全站公司市场分布 ===");
    for (const group of after) {
      console.log(`  ${group.market ?? "NULL"}: ${group._count._all} 家`);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
