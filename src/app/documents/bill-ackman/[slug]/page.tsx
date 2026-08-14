import { notFound } from "next/navigation";
import { SiteNav } from "@/components/SiteNav";
import { getDocumentById } from "@/lib/documents";
import PdfViewer from "@/components/PdfViewer";

const slugToDocId: Record<string, string> = {
  "2q26-letter": "bill-ackman-2q26-letter",
};

export default async function BillAckmanPdfPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = await getDocumentById(slugToDocId[slug]);
  if (!doc) notFound();

  return (
    <div className="pdf-reader-page">
      <SiteNav />
      <main className="pdf-reader-shell">
        <PdfViewer key={doc.rawHref} url={doc.rawHref} title={doc.title} backHref="/master/bill-ackman#library" />
      </main>
    </div>
  );
}
