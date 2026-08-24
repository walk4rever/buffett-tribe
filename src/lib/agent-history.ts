import prisma from "@/lib/prisma";

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
