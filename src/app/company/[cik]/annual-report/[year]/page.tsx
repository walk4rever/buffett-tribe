import { notFound, redirect } from "next/navigation";
import { FilingReader } from "@/components/FilingReader";
import { SiteNav } from "@/components/SiteNav";
import { formatCompanyCikSlug, getCompanyAnnualFiling, getCompanyByCik } from "@/lib/company-data";

interface Props {
  params: Promise<{ cik: string; year: string }>;
}

function getCompanyNameZh(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as { nameZh?: unknown }).nameZh;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export default async function AnnualReportPage({ params }: Props) {
  const { cik: rawCik, year: rawYear } = await params;
  const canonicalSlug = formatCompanyCikSlug(rawCik.trim());
  if (!canonicalSlug) notFound();
  if (rawCik.trim() !== canonicalSlug) redirect(`/company/${canonicalSlug}/annual-report/${rawYear}`);

  const company = await getCompanyByCik(canonicalSlug);
  if (!company) notFound();

  const year = Number.parseInt(rawYear, 10);
  if (!Number.isFinite(year)) notFound();

  const filing = await getCompanyAnnualFiling(company.id, year);
  if (!filing) notFound();

  return (
    <div className="pdf-reader-page">
      <SiteNav />
      <main className="pdf-reader-shell">
        <FilingReader
          company={{
            name: company.canonicalName,
            nameZh: getCompanyNameZh(company.metadata),
            ticker: company.ticker ?? null,
            cik: company.cik ?? null,
          }}
          filing={filing}
        />
      </main>
    </div>
  );
}
