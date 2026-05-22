import { notFound } from "next/navigation";
import { SiteNav } from "@/components/SiteNav";
import { PdfReader } from "@/components/PdfReader";
import { getDocumentsForOwner } from "@/lib/documents";

const docs = getDocumentsForOwner("lilu");
const slugToDocId: Record<string, string> = {
  "global-value-investing-2024": "lilu-global-value-investing-2024",
  "value-investing-china-2015": "lilu-value-investing-china-2015",
  "modernization-us-china": "lilu-modernization-us-china",
  "modernization-full-2014": "lilu-modernization-full-2014",
};

export default async function LiluPdfPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = docs.find((d) => d.id === slugToDocId[slug]);
  if (!doc) notFound();

  return (
    <div className="pdf-reader-page">
      <SiteNav />
      <main className="pdf-reader-shell">
        <PdfReader src={doc.rawHref} key={doc.rawHref} />
      </main>
    </div>
  );
}
