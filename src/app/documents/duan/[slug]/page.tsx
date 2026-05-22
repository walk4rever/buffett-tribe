import { notFound } from "next/navigation";
import { SiteNav } from "@/components/SiteNav";
import { getDocumentById } from "@/lib/documents";

export function generateStaticParams() {
  return [{ slug: "business" }, { slug: "investment" }];
}

const SLUG_TO_ID: Record<string, string> = {
  business: "duan-business-qa",
  investment: "duan-investment-qa",
};

export default async function DuanPdfPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = getDocumentById(SLUG_TO_ID[slug]);
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
