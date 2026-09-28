import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { deriveContextKey } from "@/lib/agent-context";
import { getRecentTurns } from "@/lib/agent-history";
import { AgentPageChat } from "@/components/AgentPageChat";
import type { Message } from "@/hooks/useAgentChat";
import { SiteNav } from "@/components/SiteNav";
import { BRAND_ZH } from "@/lib/brand";

export const metadata = {
  title: `对话 — ${BRAND_ZH}`,
  description: "以价值投资大师的视角理解一家公司，买股票就是买公司。",
};

export default async function AgentPage() {
  const session = await getServerSession(authOptions);

  // 2026-09-28: 允许匿名用户访问，使用 IP 级别试用额度
  const initialMessages: Message[] = session
    ? (await getRecentTurns(session.user.id, deriveContextKey(undefined))).map((t) => ({
        role: t.role,
        text: t.text,
        imageUrls: t.imageUrls.length ? t.imageUrls : undefined,
      }))
    : [];

  return (
    <div className="idea-screen">
      <SiteNav />
      <div className="idea-screen-main">
        <AgentPageChat initialMessages={initialMessages} />
      </div>
    </div>
  );
}
