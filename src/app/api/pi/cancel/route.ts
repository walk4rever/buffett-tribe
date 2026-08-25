import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

const GATEWAY_URL = process.env.PI_GATEWAY_URL;
const AGENT_SECRET = process.env.PI_AGENT_SECRET;

// Explicit cancel signal for the stop button. /api/pi's own request-cancellation
// (aborting the upstream fetch on client disconnect) only works where the route
// actually runs as a long-lived process — on Vercel's Node.js serverless runtime, a
// client disconnect never reaches a running function invocation, so that path alone
// leaves the gateway session locked until the orphaned generation finishes on its own.
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "AI 对话需要登录后使用。" }, { status: 401 });
  }

  if (!GATEWAY_URL || !AGENT_SECRET) {
    return NextResponse.json({ error: "Agent not configured" }, { status: 503 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.userId || typeof body.userId !== "string") {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  await fetch(`${GATEWAY_URL}/cancel`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Agent-Secret": AGENT_SECRET,
    },
    // Forward context exactly as /chat does (raw, unvalidated) — the gateway's
    // session key must be derived from the same shape or this looks up the wrong
    // (or no) session.
    body: JSON.stringify({ userId: body.userId, context: body.context }),
  }).catch(() => {
    // Best-effort — worst case the session stays locked until the orphaned
    // generation finishes naturally, same as before this endpoint existed.
  });

  return NextResponse.json({ ok: true });
}
