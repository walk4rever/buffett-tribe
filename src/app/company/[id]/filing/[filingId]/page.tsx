import { notFound, redirect } from "next/navigation";
import { FilingReader } from "@/components/FilingReader";
import { PdfFilingReader } from "@/components/PdfFilingReader";
import { SiteNav } from "@/components/SiteNav";
import {
  formatCompanyUrl,
  getCompanyByIdentifier,
  getCompanyFilingById,
  parseCompanyIdentifier,
} from "@/lib/company-data";

interface Props {
  params: Promise<{ id: string; filingId: string }>;
}

function getCompanyNameZh(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as { nameZh?: unknown }).nameZh;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatFilingTitle(filing: {
  kind: string;
  periodYear: number | null;
  periodQuarter: number | null;
  metadata: unknown;
}) {
  const meta = (filing.metadata && typeof filing.metadata === "object" && !Array.isArray(filing.metadata)
    ? filing.metadata
    : {}) as Record<string, unknown>;
  const form = typeof meta.form === "string" && meta.form.trim() ? meta.form.trim() : filing.kind.toUpperCase();

  const periodLabel = filing.periodYear
    ? `${filing.periodYear}${filing.periodQuarter ? (filing.periodQuarter === 2 && filing.kind.includes("interim") ? " H1" : ` Q${filing.periodQuarter}`) : ""}`
    : "";

  return [periodLabel, form].filter(Boolean).join(" · ");
}

export default async function FilingReaderPage({ params }: Props) {
  const { id: rawId, filingId } = await params;
  const trimmedId = rawId.trim();
  const parsed = parseCompanyIdentifier(trimmedId);
  if (!parsed) notFound();

  const canonicalUrl = formatCompanyUrl(parsed);
  if (!canonicalUrl) notFound();
  if (`/company/${trimmedId}` !== canonicalUrl) {
    redirect(`${canonicalUrl}/filing/${filingId}`);
  }

  const company = await getCompanyByIdentifier(trimmedId);
  if (!company) notFound();

  const filing = await getCompanyFilingById(company.id, filingId);
  if (!filing) notFound();

  const zhName = getCompanyNameZh(company.metadata);
  const displayCompany = zhName ?? company.canonicalName;
  const backHref = `${canonicalUrl}?tab=references`;

  // 1. PDF filings (HK annual/interim/quarterly, CN annual/interim/quarterly)
  const pdfArtifact = filing.artifacts.find((artifact) => artifact.kind === "primary_pdf");
  if (pdfArtifact?.objectKey) {
    const pdfUrl = `/api/filing-pdf/${pdfArtifact.objectKey}`;
    const title = `${displayCompany} ${formatFilingTitle(filing)}`;

    return (
      <div className="pdf-reader-page">
        <SiteNav />
        <main className="pdf-reader-shell">
          <PdfFilingReader
            pdfUrl={pdfUrl}
            title={title}
            backHref={backHref}
            companyName={displayCompany}
            ticker={company.ticker ?? company.code ?? null}
            periodYear={filing.periodYear}
          />
        </main>
      </div>
    );
  }

  // 2. HTML filings (US 10-K, 10-Q, 20-F, 40-F)
  const htmlArtifact = filing.artifacts.find((artifact) => artifact.kind === "primary_html");
  if (htmlArtifact?.objectKey) {
    return (
      <div className="pdf-reader-page">
        <SiteNav />
        <main className="pdf-reader-shell">
          <FilingReader
            company={{
              name: company.canonicalName,
              nameZh: zhName,
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

  // 3. Fallback: if external URL exists, redirect to it; otherwise not found
  if (filing.url) {
    redirect(filing.url);
  }

  notFound();
}
