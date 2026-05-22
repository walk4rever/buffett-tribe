import { notFound } from "next/navigation";
import { SiteNav } from "@/components/SiteNav";
import { getDocumentById } from "@/lib/documents";

export const metadata = {
  title: "Buffett & Munger Unscripted PDF | Buffett Tribe",
  description: "原始 PDF 阅读样例：Buffett & Munger Unscripted",
};

export default function UnscriptedPdfPage() {
  const doc = getDocumentById("buffett-annual-meeting-unscripted");
  if (!doc) notFound();

  return (
    <div className="pdf-reader-page">
      <SiteNav />
      <main className="pdf-reader-shell">
        <iframe
          className="pdf-reader-frame pdf-reader-frame--full"
          src={doc.rawHref}
          title={`${doc.title} PDF`}
        />
      </main>
    </div>
  );
}
