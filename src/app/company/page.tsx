import type { Metadata } from "next";
import prisma from "@/lib/prisma";
import { formatCompanyUrl } from "@/lib/company-data";
import { SiteNav } from "@/components/SiteNav";
import { CompanyDirectory, CompanyGrid, type CompanyDirectoryItem } from "@/components/CompanyDirectory";

// Company directory changes in slow batches (manual onboarding runs), not
// per-request — ISR caches the ~1.5-2s query result instead of re-running
// it on every visit. Up to 1h staleness after an onboard run is a non-issue
// here.
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "公司库 | Buffett Tribe",
  description: "巴菲特部落覆盖的全部公司，支持搜索与过滤。",
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
  metadata: true,
  securitiesAsCompany: {
    select: { ticker: true },
    orderBy: { ticker: "asc" as const },
  },
  // Onboarding writes Financial/CompanyAnalysis/BusinessCanvas together
  // as one unit — a company either has all of them or none, so
  // Financial alone is a reliable "fully onboarded" signal. Without
  // it, the row is a bare stub auto-created by 13F import the moment
  // some investor's holdings first mentioned the ticker.
  _count: { select: { financials: true } },
};

type EntityDirectoryRow = Awaited<ReturnType<typeof prisma.entity.findMany<{ select: typeof ENTITY_DIRECTORY_SELECT }>>>[number];

function toDirectoryItem(row: EntityDirectoryRow): CompanyDirectoryItem {
  const meta = row.metadata as Record<string, unknown> | null;
  const nameZh = (typeof meta?.nameZh === "string" && meta.nameZh.trim()) || row.canonicalName;
  const nameEn = (typeof meta?.nameEnShort === "string" && meta.nameEnShort.trim()) || row.canonicalName;
  // Entity.ticker is the display-primary ticker; a company can also have
  // multiple tradeable share classes (e.g. Berkshire BRK-A/BRK-B, Alphabet
  // GOOG/GOOGL) recorded as separate Security rows under the same
  // companyEntityId — merge both sources so search matches any of them.
  const tickers = uniqueTickers([row.ticker, ...row.securitiesAsCompany.map((s) => s.ticker)]);
  // Guaranteed non-null: the query requires cik OR (market AND code).
  const market = (row.market as "hk" | "cn" | null) ?? "us";
  return {
    key: row.cik ?? `${row.market}-${row.code}`,
    nameZh,
    nameEn,
    tickers,
    href: formatCompanyUrl(row),
    market,
    isComplete: row._count.financials > 0,
  };
}

async function getCompanies(): Promise<CompanyDirectoryItem[]> {
  try {
    const rows = await prisma.entity.findMany({
      where: {
        type: "company",
        OR: [{ cik: { not: null } }, { AND: [{ market: { not: null } }, { code: { not: null } }] }],
      },
      select: ENTITY_DIRECTORY_SELECT,
      orderBy: { canonicalName: "asc" },
    });
    return rows.map(toDirectoryItem);
  } catch {
    return [];
  }
}

// "最近更新" = most recently generated LLM content (profile/business/moat/
// management/valuation), not "most recently created" (misses refreshed old
// companies) or "any DB write" (StockPrice updates daily, which would just
// permanently pin every actively-priced company here and defeat the point).
// CompanyAnalysis is one row per entity with all 5 fields, so its updatedAt
// is already the "when did this company's analysis last change" signal —
// no groupBy needed (unlike the old GeneratedContentVersion-per-artifact
// scheme, where the max had to be computed across 5 separate rows).
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
    // findMany doesn't preserve `in` order — reapply the updatedAt-desc order
    // explicitly.
    return entityIds
      .map((id) => byId.get(id))
      .filter((row): row is EntityDirectoryRow => row != null)
      .map(toDirectoryItem);
  } catch {
    return [];
  }
}

export default async function CompaniesPage() {
  const [companies, recentlyUpdated] = await Promise.all([getCompanies(), getRecentlyUpdatedCompanies()]);

  return (
    <div className="home-v2 companies-page">
      <SiteNav />
      <main className="companies-shell">
        <header className="companies-head">
          <h1>公司库</h1>
          <p className="companies-lede">买股票就是买公司 · 部落成员持有或研究过的 {companies.length} 家公司。</p>
        </header>
        {recentlyUpdated.length > 0 ? (
          <section className="companies-section">
            <h2 className="companies-section-title">
              最近更新
              <span className="companies-section-count">({recentlyUpdated.length})</span>
            </h2>
            <CompanyGrid items={recentlyUpdated} />
          </section>
        ) : null}
        <CompanyDirectory companies={companies} />
      </main>
    </div>
  );
}
