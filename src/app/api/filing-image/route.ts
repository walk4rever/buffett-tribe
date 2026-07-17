import { NextResponse } from "next/server";

// Must match SEC_HEADERS in scripts/lib/filing-archive.ts — SEC gates
// Archives access on a compliant identifying User-Agent; without it,
// a real browser's own default UA gets 403'd (surfaces client-side as
// net::ERR_BLOCKED_BY_ORB on <img src="https://www.sec.gov/...">).
const SEC_USER_AGENT = "buffett-tribe research walkklaw@gmail.com";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const target = searchParams.get("url");

  if (!target) {
    return NextResponse.json({ error: "url required" }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }

  // Only ever proxy sec.gov — this route must not become an open fetch proxy.
  if (parsed.protocol !== "https:" || parsed.hostname !== "www.sec.gov") {
    return NextResponse.json({ error: "only https://www.sec.gov URLs are allowed" }, { status: 400 });
  }

  const upstream = await fetch(parsed.toString(), {
    headers: { "User-Agent": SEC_USER_AGENT, Accept: "image/*" },
  });

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: `upstream fetch failed: ${upstream.status}` }, { status: 502 });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
