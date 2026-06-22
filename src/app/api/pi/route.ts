import { NextResponse } from "next/server";

export const maxDuration = 90;

const GATEWAY_URL = process.env.PI_GATEWAY_URL;
const AGENT_SECRET = process.env.PI_AGENT_SECRET;

export async function POST(req: Request) {
  if (!GATEWAY_URL || !AGENT_SECRET) {
    return NextResponse.json({ error: "Agent not configured" }, { status: 503 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.message || typeof body.message !== "string") {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const upstream = await fetch(`${GATEWAY_URL}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Agent-Secret": AGENT_SECRET,
    },
    body: JSON.stringify({ message: body.message, userId: body.userId }),
    signal: AbortSignal.timeout(85000),
  });

  if (!upstream.ok) {
    const err = await upstream.text();
    return NextResponse.json({ error: err || `Gateway error ${upstream.status}` }, { status: upstream.status });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
