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
    body: JSON.stringify({ message: body.message, userId: body.userId, context: body.context }),
    signal: AbortSignal.timeout(85000),
  });

  if (!upstream.ok) {
    const raw = await upstream.text();
    // pi-gateway's error responses are themselves `{ error: "..." }` JSON — parse and
    // re-emit the inner message instead of nesting the whole raw body as a string
    // (previously produced a double-encoded `{"error":"{\"error\":\"...\"}"}` that
    // rendered as literal braces in the chat UI).
    const parsed = (() => {
      try {
        return JSON.parse(raw) as { error?: unknown };
      } catch {
        return null;
      }
    })();
    const message = typeof parsed?.error === "string" ? parsed.error : raw || `Gateway error ${upstream.status}`;
    return NextResponse.json({ error: message }, { status: upstream.status });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
