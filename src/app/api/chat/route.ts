import { NextResponse, after } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getClientIp } from "@/lib/ratelimit";
import { buildSystemPrompt } from "@/lib/prompts/buffett";
import type { EvidencePlan, RetrievedChunk } from "@/lib/prompts/buffett";
import { searchChunks } from "@/lib/search";
import { Langfuse } from "langfuse";

function makeLangfuse() {
  return new Langfuse({
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    baseUrl: process.env.LANGFUSE_BASE_URL,
    flushAt: 1,
  });
}

// Allow up to 60s for cross-border API calls to 火山引擎
export const maxDuration = 60;

const AI_API_KEY = process.env.AI_API_KEY!;
const AI_API_BASE_URL = process.env.AI_API_BASE_URL!;
const AI_MODEL = process.env.AI_MODEL!;

const FREE_DAILY_ANON_LIMIT = parseInt(process.env.FREE_DAILY_ANON_LIMIT ?? "100", 10);
const FREE_DAILY_AUTH_LIMIT = parseInt(process.env.FREE_DAILY_AUTH_LIMIT ?? "100", 10);

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((x) => x.length >= 3);
}

function pickEvidenceExcerpt(queryEn: string, contentEn: string): string {
  const text = contentEn.trim();
  if (!text) return "";

  const queryTokens = new Set(tokenize(queryEn));
  if (queryTokens.size === 0) {
    return text.slice(0, 180).trim() + (text.length > 180 ? "…" : "");
  }

  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);

  if (sentences.length === 0) {
    return text.slice(0, 180).trim() + (text.length > 180 ? "…" : "");
  }

  let best = sentences[0];
  let bestScore = -1;

  for (const s of sentences) {
    const tokens = tokenize(s);
    if (tokens.length === 0) continue;
    let overlap = 0;
    for (const t of tokens) {
      if (queryTokens.has(t)) overlap++;
    }
    const score = overlap / Math.sqrt(tokens.length);
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }

  const clipped = best.length > 220 ? `${best.slice(0, 220).trim()}…` : best;
  return clipped;
}

function pickEvidenceExcerptZh(contentZh: string | null): string {
  const text = (contentZh ?? "").trim();
  if (!text) return "";
  const lines = text
    .split(/\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 8);
  const best = lines[0] ?? text;
  return best.length > 140 ? `${best.slice(0, 140).trim()}…` : best;
}

function buildEvidencePlan(params: {
  query: string;
  intent: string;
  answerMode: string;
  entities: string[];
  yearFrom: number | null;
  yearTo: number | null;
  chunks: RetrievedChunk[];
}): EvidencePlan {
  const yearsCovered = [...new Set(params.chunks.map((c) => c.year))].sort((a, b) => a - b);
  const hasYearConstraint = params.yearFrom !== null || params.yearTo !== null;
  const sufficient = params.chunks.length > 0;

  let insufficiencyReason: string | undefined;
  if (!sufficient) {
    const rangeHint = hasYearConstraint
      ? `（时间约束：${params.yearFrom ?? "不限"}-${params.yearTo ?? "不限"}）`
      : "";
    insufficiencyReason = `检索范围内未命中相关段落${rangeHint}`;
  }

  return {
    query: params.query,
    intent: params.intent,
    answerMode: params.answerMode,
    entities: params.entities,
    yearFrom: params.yearFrom,
    yearTo: params.yearTo,
    yearsCovered,
    evidenceCount: params.chunks.length,
    sufficient,
    insufficiencyReason,
  };
}

async function checkAndIncrementUsage(
  ip: string,
  userId: string | undefined,
): Promise<{ allowed: boolean; remaining: number; limit: number }> {
  const date = todayStr();

  let entry;
  if (userId) {
    // Authenticated: count per userId. Use synthetic ip to avoid conflicting
    // with an existing anonymous row that shares the same real ip + date.
    const syntheticIp = `__user__${userId}`;
    entry = await prisma.chatUsage.upsert({
      where: { userId_date: { userId, date } },
      update: { count: { increment: 1 } },
      create: { ip: syntheticIp, userId, date, count: 1 },
    });
  } else {
    // Anonymous: count per IP
    entry = await prisma.chatUsage.upsert({
      where: { ip_date: { ip, date } },
      update: { count: { increment: 1 } },
      create: { ip, date, count: 1 },
    });
  }

  const limit = userId ? FREE_DAILY_AUTH_LIMIT : FREE_DAILY_ANON_LIMIT;
  const allowed = entry.count <= limit;
  const remaining = Math.max(0, limit - entry.count);
  return { allowed, remaining, limit };
}

// ── Route handler (SSE streaming) ─────────────────────────────────────────

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id ?? undefined;

  // Per-request Langfuse instance — ensures shutdownAsync() flushes immediately
  const langfuse = makeLangfuse();
  let langfuseFlushed = false;

  async function flushLangfuse() {
    if (langfuseFlushed) return;
    langfuseFlushed = true;
    await langfuse.shutdownAsync().catch((e) => console.error("[langfuse]", e));
  }

  const body = await req.json().catch(() => null);
  if (!body?.messages || !Array.isArray(body.messages)) {
    await flushLangfuse();
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const person: string = typeof body.person === "string" ? body.person : "buffett";

  const lastUserMsg = [...body.messages].reverse().find(
    (m: { role: string }) => m.role === "user",
  );
  if (!lastUserMsg) {
    await flushLangfuse();
    return NextResponse.json({ error: "No user message" }, { status: 400 });
  }

  // Langfuse trace — spans the full request lifecycle
  const trace = langfuse.trace({
    name: "chat",
    userId: userId ?? ip,
    input: lastUserMsg.content,
    metadata: { person, ip },
  });

  // Parallel: usage check + retrieval search
  const retrievalStart = Date.now();
  const [usage, searchResult] = await Promise.all([
    checkAndIncrementUsage(ip, userId),
    searchChunks(lastUserMsg.content),
  ]);
  const {
    chunks,
    order,
    distinctByYear,
    evidenceQuery,
    taskType,
    intent,
    answerMode,
    entities,
    yearFrom,
    yearTo,
    needsRetrieval,
  } = searchResult;
  console.log(`[search] query="${lastUserMsg.content.slice(0, 60)}" chunks=${chunks.length} order=${order} distinct=${distinctByYear}`);

  trace.span({
    name: "retrieval",
    input: lastUserMsg.content,
    output: { chunks: chunks.length, order, taskType, intent, answerMode, needsRetrieval, yearFrom, yearTo },
    startTime: new Date(retrievalStart),
    endTime: new Date(),
  });

  if (!usage.allowed) {
    const error = userId
      ? `今日免费次数已用完（${FREE_DAILY_AUTH_LIMIT}次/天），请明天再来。`
      : `__LIMIT__今日免费次数已用完（${FREE_DAILY_ANON_LIMIT}次），注册后每天可免费对话 ${FREE_DAILY_AUTH_LIMIT} 次，并可保存对话历史、使用社交分享等更多功能。`;
    trace.update({ output: { error, status: 429 } });
    await flushLangfuse();
    return NextResponse.json({ error }, { status: 429 });
  }

  const evidencePlan = needsRetrieval
    ? buildEvidencePlan({
        query: evidenceQuery,
        intent,
        answerMode,
        entities,
        yearFrom,
        yearTo,
        chunks,
      })
    : null;

  const systemPrompt = buildSystemPrompt(chunks, order, distinctByYear, evidencePlan);

  // Build sources from search results (always shown, independent of AI output)
  const sources = chunks.map((c) => ({
    year: c.year,
    title: c.title,
    sourceType: c.sourceType,
    chunkId: c.id,
    excerpt: pickEvidenceExcerpt(evidenceQuery, c.contentEn),
    excerptZh: pickEvidenceExcerptZh(c.contentZh),
    retrieval: c.retrieval,
    semanticScore: c.semanticScore,
    keywordScore: c.keywordScore,
  }));

  // Create ChatMessage record (answer filled in after streaming completes)
  const chatRecord = await prisma.chatMessage.create({
    data: {
      ip,
      userId,
      question: lastUserMsg.content,
      sourceIds: chunks.map((c) => c.id),
      sourcesJson: sources,
      taskType,
      needsRetrieval,
    },
  });

  // Include last 2 Q&A pairs as context (reduced from 3 for faster AI processing)
  const CONTEXT_TURNS = 2;
  const historyMessages = body.messages
    .filter((m: { role: string }) => m.role === "user" || m.role === "assistant")
    .slice(-(CONTEXT_TURNS * 2 + 1), -1) // last 6 messages before the current one
    .map((m: { role: string; content: string }) => ({ role: m.role, content: m.content }));

  const aiMessages = [
    { role: "system", content: systemPrompt },
    ...historyMessages,
    { role: "user", content: lastUserMsg.content },
  ];

  // Langfuse generation — tracks full prompt + response
  const generation = trace.generation({
    name: "llm",
    model: AI_MODEL,
    input: aiMessages,
    modelParameters: { temperature: 0.7, max_tokens: 1000, stream: true },
  });

  // Call AI with streaming
  const aiRes = await fetch(`${AI_API_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_API_KEY}`,
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: aiMessages,
      temperature: 0.7,
      max_tokens: 1000,
      stream: true,
    }),
    signal: AbortSignal.timeout(55000),
  });

  if (!aiRes.ok) {
    const errText = await aiRes.text();
    console.error("AI API error:", errText);
    generation.end({ level: "ERROR", output: { error: errText, status: aiRes.status } });
    trace.update({ output: { error: "AI 服务暂时不可用，请稍后重试。", status: 502 } });
    await flushLangfuse();
    return NextResponse.json(
      { error: "AI 服务暂时不可用，请稍后重试。" },
      { status: 502 },
    );
  }

  const encoder = new TextEncoder();
  // Shared ref so after() can read the final answer once the stream closes
  const shared = { answerBuffer: "" };

  const stream = new ReadableStream({
    async start(controller) {
      // Send sources + chatMessageId immediately before AI streaming begins.
      controller.enqueue(
        encoder.encode(
          `event: sources\ndata: ${JSON.stringify({ sources, remaining: usage.remaining, chatMessageId: chatRecord.id })}\n\n`,
        ),
      );

      const reader = aiRes.body!.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          sseBuffer += decoder.decode(value, { stream: true });
          const lines = sseBuffer.split("\n");
          sseBuffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;

            const payload = trimmed.slice(5).trim();
            if (payload === "[DONE]") continue;

            try {
              const json = JSON.parse(payload);
              const delta = json.choices?.[0]?.delta?.content;
              if (delta) {
                shared.answerBuffer += delta;
                controller.enqueue(
                  encoder.encode(`event: delta\ndata: ${JSON.stringify(delta)}\n\n`),
                );
              }
            } catch {
              // Skip malformed SSE chunks
            }
          }
        }

        // Persist answer before sending done — fire-and-forget is unreliable in serverless
        // because the function may terminate before the promise resolves.
        if (shared.answerBuffer) {
          await prisma.chatMessage.update({
            where: { id: chatRecord.id },
            data: { answer: shared.answerBuffer },
          }).catch((err) => console.error("[chat] failed to save answer:", err));
        }

        controller.enqueue(encoder.encode(`event: done\ndata: {}\n\n`));
      } catch (err) {
        console.error("Stream processing error:", err);
        controller.enqueue(
          encoder.encode(
            `event: error\ndata: ${JSON.stringify({ error: "Stream interrupted" })}\n\n`,
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  // after() is guaranteed by Next.js to run after the stream closes,
  // so shared.answerBuffer is fully populated at this point.
  after(async () => {
    generation.end({ output: shared.answerBuffer });
    trace.update({ output: shared.answerBuffer });
    await flushLangfuse();
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
