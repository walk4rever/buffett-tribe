import { notFound } from "next/navigation";
import { SiteNav } from "@/components/SiteNav";
import { getDocumentById } from "@/lib/documents";
import PdfViewer from "@/components/PdfViewer";

export function generateStaticParams() {
  return [{ slug: "business" }, { slug: "investment" }];
}

const SLUG_TO_ID: Record<string, string> = {
  business: "duan-business",
  investment: "duan-investment",
};

export default async function DuanPdfPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = getDocumentById(SLUG_TO_ID[slug]);
  if (!doc) notFound();

  return (
    <div className="pdf-reader-page">
      <SiteNav />
      <main className="pdf-reader-shell">
        <PdfViewer key={doc.rawHref} url={doc.rawHref} title={doc.title} backHref="/master/duan#library" />
      </main>
    </div>
  );
}
