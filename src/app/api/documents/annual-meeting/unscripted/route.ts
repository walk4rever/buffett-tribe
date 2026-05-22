import { getDocumentById } from "@/lib/documents";
import { getR2Stream } from "@/lib/r2";

const doc = getDocumentById("buffett-annual-meeting-unscripted");

export async function GET() {
  if (!doc) {
    return new Response("not found", { status: 404 });
  }

  // Strip data/documents/raw/ prefix, add buffett-tribe/ namespace
  const r2Key = "buffett-tribe/" + doc.rawPath.replace(/^data\/documents\/raw\//, "");

  try {
    const { stream, contentType, contentLength } = await getR2Stream(r2Key);

    return new Response(stream, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": 'inline; filename="Buffett-and-Munger-Unscripted.pdf"',
        "Content-Length": String(contentLength),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    console.error(`R2 fetch failed for ${r2Key}:`, err);
    return new Response("document not available", { status: 500 });
  }
}
