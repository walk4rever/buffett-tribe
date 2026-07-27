import { notFound, redirect } from "next/navigation";
import { FilingReader } from "@/components/FilingReader";
import PdfViewer from "@/components/PdfViewer";
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

  // HK/CN annual reports were imported as PDF-extracted text, not HTML —
  // there's no primary_html artifact for FilingReader's iframe to point at.
  // They get their own PDF (kind: "primary_pdf", archived to R2 by
  // import-hk-annual-report-from-file.ts / import-cn-annual-report-from-file.ts)
  // rendered through the same generic PdfViewer already used for the
  // 大师资料库 documents — no new reader UI.
  if (filing.kind === "hk-annual-report" || filing.kind === "cn-annual-report") {
    const pdfArtifact = filing.artifacts.find((artifact) => artifact.kind === "primary_pdf");
    if (!pdfArtifact?.objectKey) notFound();

    // Proxied through /api/filing-pdf rather than pdfArtifact.publicUrl directly —
    // R2's public bucket has no CORS headers, which breaks pdfjs's cross-origin fetch.
    const pdfUrl = `/api/filing-pdf/${pdfArtifact.objectKey}`;
    const zhName = getCompanyNameZh(company.metadata);
    return (
      <div className="pdf-reader-page">
        <SiteNav />
        <main className="pdf-reader-shell">
          <PdfViewer
            key={pdfUrl}
            url={pdfUrl}
            title={`${zhName ?? company.canonicalName} ${year} 年报`}
            backHref={canonicalUrl}
          />
        </main>
      </div>
    );
  }

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
