export const runtime = "nodejs";

import { NextRequest } from "next/server";
import db from "@/lib/prisma";
import { getR2Stream } from "@/lib/r2";

// Proxies FilingArtifact PDFs (e.g. HK annual reports) through the app's own
// origin, same pattern as /api/documents/*/[slug] — R2's public bucket has no
// CORS headers, so pdfjs's cross-origin fetch inside PdfViewer would otherwise
// fail even though the object itself is public.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const { key } = await params;
  const objectKey = key.join("/");

  const artifact = await db.filingArtifact.findUnique({
    where: { objectKey },
    select: { objectKey: true, contentType: true },
  });
  if (!artifact) return new Response("not found", { status: 404 });

  try {
    const { stream, contentType, contentLength } = await getR2Stream(artifact.objectKey);

    return new Response(stream, {
      headers: {
        "Content-Type": contentType || artifact.contentType,
        "Content-Length": String(contentLength),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    console.error(`R2 fetch failed for ${objectKey}:`, err);
    return new Response("artifact not available", { status: 500 });
  }
}
