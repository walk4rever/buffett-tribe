import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import db from "@/lib/prisma";

async function fetchArtifactText(publicUrl: string | null | undefined) {
  if (!publicUrl) return null;
  const res = await fetch(publicUrl);
  if (!res.ok) {
    throw new Error(`Artifact fetch failed: ${res.status}`);
  }
  return res.text();
}

function parseJsonArtifact(text: string | null) {
  if (!text) return null;
  try {
    return JSON.parse(text) as Prisma.JsonValue;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sourceId = searchParams.get("sourceId");
  const section = searchParams.get("section");
  const includeRaw = searchParams.get("raw") === "1";

  if (!sourceId || !section) {
    return NextResponse.json({ error: "sourceId and section are required" }, { status: 400 });
  }

  const row = await db.filingSection.findUnique({
    where: { sourceId_section: { sourceId, section } },
    select: {
      section: true,
      content: true,
      rawHtml: true,
      outlineJson: true,
      blocksJson: true,
      contentPreview: true,
      contentTextLength: true,
      blockCount: true,
      extractionVersion: true,
      textArtifact: { select: { publicUrl: true } },
      blocksArtifact: { select: { publicUrl: true } },
      htmlArtifact: { select: { publicUrl: true } },
    },
  });

  if (!row) {
    return NextResponse.json({ error: "section not found" }, { status: 404 });
  }

  const [text, blocksText, rawHtml] = await Promise.all([
    fetchArtifactText(row.textArtifact?.publicUrl),
    row.blocksJson ? Promise.resolve(null) : fetchArtifactText(row.blocksArtifact?.publicUrl),
    includeRaw ? fetchArtifactText(row.htmlArtifact?.publicUrl) : Promise.resolve(null),
  ]);

  return NextResponse.json({
    section: row.section,
    content: text ?? row.content,
    rawHtml: includeRaw ? rawHtml ?? row.rawHtml : null,
    outlineJson: row.outlineJson,
    blocksJson: row.blocksJson ?? parseJsonArtifact(blocksText) ?? null,
    contentPreview: row.contentPreview,
    contentTextLength: row.contentTextLength,
    blockCount: row.blockCount,
    extractionVersion: row.extractionVersion,
  });
}
