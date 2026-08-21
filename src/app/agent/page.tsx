import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { AgentPageChat } from "@/components/AgentPageChat";
import { SiteNav } from "@/components/SiteNav";

export const metadata = {
  title: "对话 — 巴菲特部落",
  description: "以价值投资大师的视角理解一家公司，买股票就是买公司。",
};

export default async function AgentPage() {
  const session = await getServerSession(authOptions);
  if (!session) {
    redirect("/login?callbackUrl=%2Fagent");
  }

  return (
    <div className="idea-screen">
      <SiteNav />
      <div className="idea-screen-main">
        <AgentPageChat />
      </div>
    </div>
  );
}
