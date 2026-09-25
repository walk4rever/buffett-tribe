import type { Metadata } from "next";
import prisma from "@/lib/prisma";
import { formatCompanyUrl } from "@/lib/company-data";
import { SiteNav } from "@/components/SiteNav";
import { CompanyDirectory, type CompanyDirectoryItem } from "@/components/CompanyDirectory";
import { BRAND_EN, BRAND_ZH } from "@/lib/brand";

// Company directory changes in slow batches (manual onboarding runs), not
// per-request — ISR caches the query result instead of re-running
// it on every visit. 60s revalidation gives near-instant updates after an
// onboarding run while still serving cached responses to visitors.
export const revalidate = 60;

export const metadata: Metadata = {
  title: `公司库 | ${BRAND_EN}`,
  description: `${BRAND_ZH}覆盖的全部公司，支持搜索与过滤。`,
};

function uniqueTickers(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const ticker = value?.trim().toUpperCase();
    if (!ticker || seen.has(ticker)) continue;
    seen.add(ticker);
    result.push(ticker);
  }
  return result;
}

const ENTITY_DIRECTORY_SELECT = {
  id: true,
  canonicalName: true,
  cik: true,
  market: true,
  code: true,
  ticker: true,
  onboardPhase: true,
  metadata: true,
  securitiesAsCompany: {
    select: { ticker: true, kind: true },
    orderBy: { ticker: "asc" as const },
  },
};

type EntityDirectoryRow = Awaited<ReturnType<typeof prisma.entity.findMany<{ select: typeof ENTITY_DIRECTORY_SELECT }>>>[number];

function toDirectoryItem(row: EntityDirectoryRow): CompanyDirectoryItem {
  const meta = row.metadata as Record<string, unknown> | null;
  const nameZh = (typeof meta?.nameZh === "string" && meta.nameZh.trim()) || row.canonicalName;
  const nameEn = (typeof meta?.nameEnShort === "string" && meta.nameEnShort.trim()) || row.canonicalName;
  const tickers = uniqueTickers([row.ticker, ...row.securitiesAsCompany.map((s) => s.ticker)]);
  const market = (row.market as "hk" | "cn" | null) ?? "us";
  const onboardPhase = typeof row.onboardPhase === "number"
    ? row.onboardPhase
    : (typeof meta?.onboardPhase === "number" ? meta.onboardPhase : 0);
  const isPhase1Complete = onboardPhase >= 1;
  return {
    key: row.cik ?? (row.market && row.code ? `${row.market}-${row.code}` : row.id),
    nameZh,
    nameEn,
    tickers,
    href: isPhase1Complete ? formatCompanyUrl(row) : null,
    market,
    isComplete: isPhase1Complete,
    onboardPhase,
  };
}

async function getMarketUniverseCounts() {
  try {
    const groups = await prisma.entity.groupBy({
      by: ["market"],
      where: { type: "company" },
      _count: { id: true },
    });
    let total = 0;
    let us = 0;
    let cn = 0;
    let hk = 0;
    for (const g of groups) {
      total += g._count.id;
      if (g.market === "us") us = g._count.id;
      else if (g.market === "cn") cn = g._count.id;
      else if (g.market === "hk") hk = g._count.id;
    }
    return { total, us, cn, hk };
  } catch {
    return { total: 16435, us: 8060, cn: 5569, hk: 2806 };
  }
}

// "最近更新" = most recently generated LLM content (profile/business/moat/
// management/valuation), not "most recently created" (misses refreshed old
// companies) or "any DB write" (StockPrice updates daily, which would just
// permanently pin every actively-priced company here and defeat the point).
async function getRecentlyUpdatedCompanies(limit = 18): Promise<CompanyDirectoryItem[]> {
  try {
    const latest = await prisma.companyAnalysis.findMany({
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: { entityId: true },
    });
    if (!latest.length) return [];

    const entityIds = latest.map((row) => row.entityId);
    const rows = await prisma.entity.findMany({
      where: { id: { in: entityIds }, type: "company" },
      select: ENTITY_DIRECTORY_SELECT,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return entityIds
      .map((id) => byId.get(id))
      .filter((row): row is EntityDirectoryRow => row != null)
      .map(toDirectoryItem);
  } catch {
    return [];
  }
}

export default async function CompaniesPage() {
  const [recentlyUpdated, universe] = await Promise.all([
    getRecentlyUpdatedCompanies(),
    getMarketUniverseCounts(),
  ]);

  return (
    <div className="home-v2 companies-page">
      <SiteNav />
      <main className="companies-shell">
        <header className="companies-head">
          <h1>公司库</h1>
          <p className="companies-lede">
            买股票就是买公司 · 覆盖 A股 / 港股 / 美股三大市场共 {universe.total.toLocaleString()} 家上市公司（美股 {universe.us.toLocaleString()} · A股 {universe.cn.toLocaleString()} · 港股 {universe.hk.toLocaleString()}）。
          </p>
        </header>
        <CompanyDirectory recentlyUpdated={recentlyUpdated} totalCount={universe.total} />
      </main>
    </div>
  );
}
