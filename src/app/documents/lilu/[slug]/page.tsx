import { notFound } from "next/navigation";
import { SiteNav } from "@/components/SiteNav";
import { getDocumentById } from "@/lib/documents";
import PdfViewer from "@/components/PdfViewer";

const slugToDocId: Record<string, string> = {
  "global-value-investing-2024": "lilu-global-value-investing-2024",
  "value-investing-china-2015": "lilu-value-investing-china-2015",
  "modernization-us-china": "lilu-modernization-us-china",
  "modernization-full-2014": "lilu-modernization-full-2014",
  "civilization-modernization-value-investing-china": "lilu-civilization-modernization-value",
};

export default async function LiluPdfPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = await getDocumentById(slugToDocId[slug]);
  if (!doc) notFound();

  return (
    <div className="pdf-reader-page">
      <SiteNav />
      <main className="pdf-reader-shell">
        <PdfViewer key={doc.rawHref} url={doc.rawHref} title={doc.title} backHref="/master/lilu#library" />
      </main>
    </div>
  );
}
