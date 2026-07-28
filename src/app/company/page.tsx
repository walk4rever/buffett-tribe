import type { Metadata } from "next";
import prisma from "@/lib/prisma";
import { formatCompanyUrl } from "@/lib/company-data";
import { SiteNav } from "@/components/SiteNav";
import { CompanyDirectory, type CompanyDirectoryItem } from "@/components/CompanyDirectory";

export const dynamic = "force-dynamic";

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

async function getCompanies(): Promise<CompanyDirectoryItem[]> {
  try {
    const rows = await prisma.entity.findMany({
      where: {
        type: "company",
        OR: [{ cik: { not: null } }, { AND: [{ market: { not: null } }, { code: { not: null } }] }],
      },
      select: {
        canonicalName: true,
        cik: true,
        market: true,
        code: true,
        ticker: true,
        metadata: true,
        securitiesAsCompany: {
          select: { ticker: true },
          orderBy: { ticker: "asc" },
        },
      },
      orderBy: { canonicalName: "asc" },
    });
    return rows.map((row) => {
      const meta = row.metadata as Record<string, unknown> | null;
      const nameZh = (typeof meta?.nameZh === "string" && meta.nameZh.trim()) || row.canonicalName;
      const nameEn =
        (typeof meta?.nameEnShort === "string" && meta.nameEnShort.trim()) || row.canonicalName;
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
      };
    });
  } catch {
    return [];
  }
}

export default async function CompaniesPage() {
  const companies = await getCompanies();

  return (
    <div className="home-v2 companies-page">
      <SiteNav />
      <main className="companies-shell">
        <header className="companies-head">
          <h1>公司库</h1>
          <p className="companies-lede">买股票就是买公司 · 部落成员持有或研究过的 {companies.length} 家公司。</p>
        </header>
        <CompanyDirectory companies={companies} />
      </main>
    </div>
  );
}
