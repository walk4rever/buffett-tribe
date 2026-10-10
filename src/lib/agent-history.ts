import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  summarizeConversationPreview,
  type AgentTurnPreview,
} from "@/lib/agent-workspace-ui";

const HISTORY_LIMIT = 10;

export interface RecentTurn {
  role: "user" | "assistant";
  text: string;
  imageUrls: string[];
}

/** Shared by the SSR initial load (`/agent` page) and the client-side history
 *  fetch (`/api/agent-turns` GET) so both read the same recent-turns window. */
export async function getRecentTurns(userId: string, contextKey: string): Promise<RecentTurn[]> {
  const turns = await prisma.chatTurn.findMany({
    where: { userId, contextKey },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
    select: { role: true, text: true, imageUrls: true },
  });

  return turns.reverse().map((t) => ({
    role: t.role === "assistant" ? "assistant" : "user",
    text: t.text,
    imageUrls: t.imageUrls,
  }));
}

export async function getLatestCompanyTurnPreviews(
  userId: string,
  tickers: string[],
): Promise<Record<string, AgentTurnPreview>> {
  const contextKeys = [...new Set(tickers.map((ticker) => `company:${ticker}`))];
  if (contextKeys.length === 0) return {};

  const rows = await prisma.$queryRaw<
    Array<{ contextKey: string; role: string; text: string; hasImages: boolean }>
  >(Prisma.sql`
    SELECT DISTINCT ON ("contextKey")
      "contextKey",
      role,
      LEFT("text", 512) AS text,
      COALESCE(cardinality("imageUrls"), 0) > 0 AS "hasImages"
    FROM "ChatTurn"
    WHERE "userId" = ${userId}
      AND "contextKey" IN (${Prisma.join(contextKeys)})
    ORDER BY "contextKey", "createdAt" DESC, id DESC
  `);

  const previews: Record<string, AgentTurnPreview> = {};
  for (const row of rows) {
    if (row.role !== "user" && row.role !== "assistant") continue;
    const text = summarizeConversationPreview(row.text) || (row.hasImages ? "发送了图片" : "");
    if (text) {
      previews[row.contextKey] = { role: row.role, text };
    }
  }
  return previews;
}
