import { NextResponse } from "next/server";
import db from "@/lib/prisma";
import { getR2ObjectBuffer } from "@/lib/r2";
import { proxySecImageUrls } from "@/lib/filing-html";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sourceId = searchParams.get("sourceId");

  if (!sourceId) {
    return NextResponse.json({ error: "sourceId required" }, { status: 400 });
  }

  const artifact = await db.filingArtifact.findFirst({
    where: { sourceId, kind: "primary_html" },
    select: { objectKey: true },
    orderBy: { createdAt: "asc" },
  });

  if (!artifact) {
    return NextResponse.json({ error: "primary_html not found" }, { status: 404 });
  }

  const rawHtml = await getR2ObjectBuffer(artifact.objectKey);
  const html = Buffer.from(proxySecImageUrls(rawHtml.toString("utf8")), "utf8");

  return new Response(html.buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
      "X-Frame-Options": "SAMEORIGIN",
    },
  });
}
