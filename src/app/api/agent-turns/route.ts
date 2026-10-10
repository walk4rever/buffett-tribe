import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { agentContextSchema, deriveContextKey } from "@/lib/agent-context";
import { getLatestCompanyTurnPreviews, getRecentTurns } from "@/lib/agent-history";
import { imageExtensionForMimeType, validateImageAttachments, type ImageAttachment } from "@/lib/image-attachment";
import { buildUserObjectKey, uploadToR2 } from "@/lib/r2";
import { NO_STORE_HEADERS } from "@/lib/http-cache";

async function uploadChatImages(userId: string, images: ImageAttachment[]): Promise<string[]> {
  const urls: string[] = [];
  for (const img of images) {
    const ext = imageExtensionForMimeType(img.mimeType);
    const key = buildUserObjectKey(userId, "chat-images", `${randomUUID()}.${ext}`);
    try {
      const url = await uploadToR2(key, Buffer.from(img.data, "base64"), img.mimeType);
      urls.push(url);
    } catch (err) {
      // Best-effort: the turn's text still gets persisted even if an image upload fails.
      console.error("chat image upload failed", key, err);
    }
  }
  return urls;
}

const postBodySchema = z.object({
  context: agentContextSchema.optional(),
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  images: z.unknown().optional(),
});

const companyTickersSchema = z.array(z.string().trim().min(1).max(64)).max(100);

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "需要登录" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const requestedTickers = searchParams.getAll("companyTicker");
  if (requestedTickers.length > 0) {
    const parsed = companyTickersSchema.safeParse(requestedTickers);
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid company tickers" }, { status: 400 });
    }

    const tickers = [...new Set(parsed.data)];
    const latestByContextKey = await getLatestCompanyTurnPreviews(session.user.id, tickers);
    return NextResponse.json({ latestByContextKey }, { headers: NO_STORE_HEADERS });
  }

  const contextKey = searchParams.get("contextKey") ?? deriveContextKey(undefined);
  const turns = await getRecentTurns(session.user.id, contextKey);

  return NextResponse.json({ turns }, { headers: NO_STORE_HEADERS });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "需要登录" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = postBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request body" }, { status: 400 });
  }

  const { context, role, text } = parsed.data;

  let images: ImageAttachment[] | undefined;
  try {
    images = validateImageAttachments(parsed.data.images);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "invalid images" }, { status: 400 });
  }

  if (!text.trim() && !images?.length) {
    return NextResponse.json({ error: "text or images required" }, { status: 400 });
  }

  const contextKey = deriveContextKey(context);
  const imageUrls = images?.length ? await uploadChatImages(session.user.id, images) : [];

  const turn = await prisma.chatTurn.create({
    data: { userId: session.user.id, contextKey, context, role, text, imageUrls },
  });

  return NextResponse.json({ id: turn.id }, { status: 201 });
}
