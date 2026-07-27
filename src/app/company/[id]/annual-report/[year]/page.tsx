import { notFound, redirect } from "next/navigation";
import { FilingReader } from "@/components/FilingReader";
import { SiteNav } from "@/components/SiteNav";
import { formatCompanyUrl, getCompanyAnnualFiling, getCompanyByIdentifier, parseCompanyIdentifier } from "@/lib/company-data";

interface Props {
  params: Promise<{ id: string; year: string }>;
}

function getCompanyNameZh(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as { nameZh?: unknown }).nameZh;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export default async function AnnualReportPage({ params }: Props) {
  const { id: rawId, year: rawYear } = await params;
  const trimmedId = rawId.trim();
  const parsed = parseCompanyIdentifier(trimmedId);
  if (!parsed) notFound();

  const canonicalUrl = formatCompanyUrl(parsed);
  if (!canonicalUrl) notFound();
  if (`/company/${trimmedId}` !== canonicalUrl) redirect(`${canonicalUrl}/annual-report/${rawYear}`);

  const company = await getCompanyByIdentifier(trimmedId);
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
            market: company.market ?? null,
            code: company.code ?? null,
          }}
          filing={filing}
        />
      </main>
    </div>
  );
}
