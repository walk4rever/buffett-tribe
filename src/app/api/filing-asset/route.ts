import { NextResponse } from "next/server";
import db from "@/lib/prisma";

const ASSET_FETCH_TIMEOUT_MS = 60_000;

function cleanAssetName(value: string | null) {
  const name = (value ?? "").split(/[?#]/)[0]?.split("/").filter(Boolean).pop() ?? "";
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) return null;
  return name;
}

function getArchiveBaseUrl(sourceUrl: string | null) {
  if (!sourceUrl) return null;
  try {
    return new URL(".", sourceUrl).toString();
  } catch {
    return null;
  }
}

async function fetchAsset(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ASSET_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "buffett-tribe research walkklaw@gmail.com",
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      },
    });
    if (!res.ok) throw new Error(`SEC asset fetch failed: ${res.status}`);
    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    return {
      body: Buffer.from(await res.arrayBuffer()),
      contentType,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sourceId = searchParams.get("sourceId");
  const name = cleanAssetName(searchParams.get("name"));

  if (!sourceId || !name) {
    return NextResponse.json({ error: "sourceId and valid name are required" }, { status: 400 });
  }

  const source = await db.extSource.findUnique({
    where: { id: sourceId },
    select: {
      artifacts: {
        where: { kind: "primary_html" },
        select: { sourceUrl: true },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
      attachments: {
        where: { documentName: { equals: name, mode: "insensitive" } },
        select: { url: true },
        take: 1,
      },
    },
  });

  if (!source) {
    return NextResponse.json({ error: "filing source not found" }, { status: 404 });
  }

  const attachmentUrl = source.attachments[0]?.url ?? null;
  const archiveBaseUrl = getArchiveBaseUrl(source.artifacts[0]?.sourceUrl ?? null);
  const fallbackUrl = archiveBaseUrl ? new URL(name, archiveBaseUrl).toString() : null;
  const assetUrl = attachmentUrl ?? fallbackUrl;

  if (!assetUrl || !assetUrl.startsWith("https://www.sec.gov/Archives/")) {
    return NextResponse.json({ error: "asset URL not found" }, { status: 404 });
  }

  const asset = await fetchAsset(assetUrl);

  return new NextResponse(asset.body, {
    headers: {
      "Content-Type": asset.contentType,
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
