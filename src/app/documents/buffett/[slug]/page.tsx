import { notFound } from "next/navigation";
import { SiteNav } from "@/components/SiteNav";
import { getDocumentById } from "@/lib/documents";
import PdfViewer from "@/components/PdfViewer";

export function generateStaticParams() {
  return [{ slug: "unscripted" }];
}

const SLUG_TO_ID: Record<string, string> = {
  unscripted: "buffett-annual-meeting-unscripted",
};

export default async function BuffettPdfPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = getDocumentById(SLUG_TO_ID[slug]);
  if (!doc) notFound();

  return (
    <div className="pdf-reader-page">
      <SiteNav />
      <main className="pdf-reader-shell">
        <PdfViewer key={doc.rawHref} url={doc.rawHref} title={doc.title} backHref="/master/buffett#library" />
      </main>
    </div>
  );
}
