export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getDocumentById } from "@/lib/documents";
import { getR2Stream } from "@/lib/r2";

const slugToDocId: Record<string, string> = {
  unscripted: "buffett-annual-meeting-unscripted",
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const docId = slugToDocId[slug];
  if (!docId) return new Response("not found", { status: 404 });

  const doc = getDocumentById(docId);
  if (!doc) return new Response("not found", { status: 404 });

  const r2Key = "buffett-tribe/" + doc.rawPath.replace(/^data\/documents\/raw\//, "");

  try {
    const { stream, contentType, contentLength } = await getR2Stream(r2Key);

    return new Response(stream, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${doc.title}.pdf"`,
        "Content-Length": String(contentLength),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    console.error(`R2 fetch failed for ${r2Key}:`, err);
    return new Response("document not available", { status: 500 });
  }
}
