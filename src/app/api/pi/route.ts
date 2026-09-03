import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { validateImageAttachments } from "@/lib/image-attachment";
import { agentContextSchema, deriveContextKey } from "@/lib/agent-context";
import prisma from "@/lib/prisma";
import { currentPeriod, ensureFreeGrant, getBalance, recordSpend, withinHourlyLimit } from "@/lib/credits";

export const maxDuration = 90;

const GATEWAY_URL = process.env.PI_GATEWAY_URL;
const AGENT_SECRET = process.env.PI_AGENT_SECRET;
const HISTORY_LIMIT = 10;

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "AI 对话需要登录后使用。" }, { status: 401 });
  }

  if (!(await withinHourlyLimit(session.user.id))) {
    return NextResponse.json({ error: "请求过于频繁，请稍后再试。" }, { status: 429 });
  }

  const period = currentPeriod();
  await ensureFreeGrant(session.user.id, period);
  if ((await getBalance(session.user.id, period)) <= 0) {
    return NextResponse.json({ error: "本月额度已用完，下月重置。" }, { status: 429 });
  }

  if (!GATEWAY_URL || !AGENT_SECRET) {
    return NextResponse.json({ error: "Agent not configured" }, { status: 503 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.message || typeof body.message !== "string") {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  let images;
  try {
    images = validateImageAttachments(body.images);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "invalid images" }, { status: 400 });
  }

  // Cheap even though most requests hit an already-warm in-memory pi-gateway session
  // (indexed LIMIT 10) — pi-gateway only actually uses this to seed a session it's
  // creating fresh (cold start: new tab, TTL eviction, or a gateway restart).
  let history: { role: string; text: string; hadImages: boolean }[] = [];
  if (session.user?.id) {
    const parsedContext = agentContextSchema.optional().safeParse(body.context);
    const contextKey = deriveContextKey(parsedContext.success ? parsedContext.data : undefined);
    const turns = await prisma.chatTurn.findMany({
      where: { userId: session.user.id, contextKey },
      orderBy: { createdAt: "desc" },
      take: HISTORY_LIMIT,
    });
    history = turns.reverse().map((t) => ({ role: t.role, text: t.text, hadImages: t.imageUrls.length > 0 }));

    // useAgentChat persists the user's turn via a fire-and-forget request that races
    // this one — if it happened to land first, drop it so the current message doesn't
    // get seeded into the session as "history" and then sent again as the live prompt.
    const last = history[history.length - 1];
    if (last?.role === "user" && last.text === body.message) history = history.slice(0, -1);
  }

  // req.signal alone reflects the browser disconnecting (stop button, tab close);
  // without also wiring it here, this route just keeps running the upstream
  // gateway call to completion in the background even after the client is gone,
  // leaving the gateway session's busy lock held until that orphaned call finishes.
  const upstream = await fetch(`${GATEWAY_URL}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Agent-Secret": AGENT_SECRET,
    },
    body: JSON.stringify({ message: body.message, userId: body.userId, context: body.context, images, history }),
    signal: AbortSignal.any([req.signal, AbortSignal.timeout(85000)]),
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

  await recordSpend(session.user.id, undefined, period);

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
