import fs from "fs/promises";
import path from "path";
import { getDocumentById } from "@/lib/documents";

const doc = getDocumentById("buffett-annual-meeting-unscripted");

export async function GET() {
  if (!doc) {
    return new Response("not found", { status: 404 });
  }

  const file = await fs.readFile(path.join(process.cwd(), doc.rawPath));

  return new Response(file, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="Buffett-and-Munger-Unscripted.pdf"',
      "Cache-Control": "public, max-age=3600",
    },
  });
}
