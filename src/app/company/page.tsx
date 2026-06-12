import type { Metadata } from "next";
import prisma from "@/lib/prisma";
import { formatCompanyPathFromCik } from "@/lib/cik";
import { SiteNav } from "@/components/SiteNav";
import { CompanyDirectory, type CompanyDirectoryItem } from "@/components/CompanyDirectory";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "公司库 | Buffett Tribe",
  description: "巴菲特部落覆盖的全部公司，支持搜索与过滤。",
};

async function getCompanies(): Promise<CompanyDirectoryItem[]> {
  try {
    const rows = await prisma.entity.findMany({
      where: { type: "company", cik: { not: null } },
      select: { canonicalName: true, cik: true, metadata: true },
      orderBy: { canonicalName: "asc" },
    });
    return rows
      .filter((row) => row.cik)
      .map((row) => {
        const meta = row.metadata as Record<string, unknown> | null;
        const nameZh = (typeof meta?.nameZh === "string" && meta.nameZh.trim()) || row.canonicalName;
        const nameEn =
          (typeof meta?.nameEnShort === "string" && meta.nameEnShort.trim()) || row.canonicalName;
        return {
          cik: row.cik as string,
          nameZh,
          nameEn,
          href: formatCompanyPathFromCik(row.cik),
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
