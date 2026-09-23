/**
 * 修复待完善公司的 market 字段和 CIK
 *
 * 问题：324 家公司通过 13F 自动创建，但 market 字段为 null
 * 解决：查询 SEC API 确认是美股并补全 CIK
 *
 * Usage:
 *   npm run fix:market -- --dry-run
 *   npm run fix:market -- --limit 10
 *   npm run fix:market
 */
import prisma from "@/lib/prisma";

// SEC company tickers endpoint
const SEC_COMPANY_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const SEC_HEADERS = {
  "User-Agent": "Buffett Tribe research@buffett-tribe.com",
  "Accept-Encoding": "gzip, deflate",
  "Host": "www.sec.gov",
};

type SecCompanyTicker = {
  cik_str: number;
  ticker: string;
  title: string;
};

function getArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  const index = args.indexOf(flag);
  return index !== -1 && index + 1 < args.length ? args[index + 1] : undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

async function fetchSecCompanyTickers(): Promise<Map<string, SecCompanyTicker>> {
  console.log("Fetching SEC company tickers list...");

  const response = await fetch(SEC_COMPANY_TICKERS_URL, {
    headers: SEC_HEADERS
  });

  if (!response.ok) {
    throw new Error(`SEC API returned ${response.status}: ${response.statusText}`);
  }

  const data = await response.json() as Record<string, SecCompanyTicker>;

  // 转换为 Map，key 为大写 ticker
  const map = new Map<string, SecCompanyTicker>();
  for (const entry of Object.values(data)) {
    map.set(entry.ticker.toUpperCase(), entry);
  }

  console.log(`✓ Loaded ${map.size} SEC company tickers\n`);

  return map;
}

async function main() {
  const dryRun = hasFlag("--dry-run");
  const limit = getArg("--limit") ? parseInt(getArg("--limit")!, 10) : undefined;

  console.log("=== Fix Market Field for Pending Companies ===\n");

  if (dryRun) {
    console.log("🔍 DRY RUN MODE - no changes will be made\n");
  }

  // 1. 查询待完善的公司（market = null 且有 ticker）
  const pending = await prisma.entity.findMany({
    where: {
      type: "company",
      market: null,
      ticker: { not: null },
      financials: { none: {} }  // 确保是待完善的
    },
    select: {
      id: true,
      ticker: true,
      canonicalName: true,
      cik: true
    }
  });

  console.log(`Found ${pending.length} companies with null market field`);

  if (pending.length === 0) {
    console.log("✓ No companies need fixing");
    await prisma.$disconnect();
    return;
  }

  const toProcess = limit ? pending.slice(0, limit) : pending;
  console.log(`Processing ${toProcess.length} companies...\n`);

  // 2. 获取 SEC 公司列表
  const secTickers = await fetchSecCompanyTickers();

  // 3. 匹配并更新
  const results = {
    matched: 0,
    notFound: 0,
    updated: 0,
    errors: 0
  };

  const notFoundList: string[] = [];

  for (const company of toProcess) {
    const ticker = company.ticker!.toUpperCase();
    const secData = secTickers.get(ticker);

    if (!secData) {
      console.log(`❌ ${ticker.padEnd(12)} Not found in SEC database - ${company.canonicalName}`);
      results.notFound++;
      notFoundList.push(ticker);
      continue;
    }

    results.matched++;

    // CIK 格式化为 10 位（左侧补零）
    const cik = String(secData.cik_str).padStart(10, '0');

    console.log(`✓ ${ticker.padEnd(12)} CIK: ${cik} - ${secData.title}`);

    if (!dryRun) {
      try {
        await prisma.entity.update({
          where: { id: company.id },
          data: {
            market: "us",
            cik: cik,
            // 如果 canonicalName 是空的，用 SEC 的名称
            ...(company.canonicalName ? {} : { canonicalName: secData.title })
          }
        });
        results.updated++;
      } catch (err) {
        console.error(`  ⚠️ Failed to update: ${err instanceof Error ? err.message : String(err)}`);
        results.errors++;
      }
    }
  }

  // 4. 输出总结
  console.log("\n=== Summary ===");
  console.log(`Total processed: ${toProcess.length}`);
  console.log(`Matched in SEC: ${results.matched}`);
  console.log(`Not found: ${results.notFound}`);

  if (!dryRun) {
    console.log(`Successfully updated: ${results.updated}`);
    console.log(`Errors: ${results.errors}`);
  }

  if (notFoundList.length > 0) {
    console.log(`\nNot found tickers (${notFoundList.length}):`);
    console.log(notFoundList.join(", "));
    console.log("\n⚠️ These tickers might be:");
    console.log("  - ETFs (not in SEC company database)");
    console.log("  - Delisted companies");
    console.log("  - Foreign companies (ADRs)");
    console.log("  - Invalid/outdated tickers");
  }

  if (dryRun) {
    console.log("\n💡 Run without --dry-run to apply changes");
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Fatal error:", err);
  await prisma.$disconnect();
  process.exit(1);
});
