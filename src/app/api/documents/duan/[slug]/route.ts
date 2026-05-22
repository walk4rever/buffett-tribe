import fs from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { getDocumentsForOwner } from "@/lib/documents";

const docs = getDocumentsForOwner("duan");
const slugToDocId: Record<string, string> = {
  business: "duan-business-qa",
  investment: "duan-investment-qa",
};

export async function GET(_: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const meta = docs.find((doc) => doc.id === slugToDocId[slug]);
  if (!meta) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const pdfPath = path.join(process.cwd(), meta.rawPath);
  const file = await fs.readFile(pdfPath);

  return new Response(file, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${path.basename(meta.rawPath)}"`,
      "Cache-Control": "public, max-age=3600",
    },
  });
}
