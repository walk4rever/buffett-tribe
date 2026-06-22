import { AgentChat } from "@/components/AgentChat";
import { SiteNav } from "@/components/SiteNav";

export const metadata = {
  title: "对话 — 巴菲特部落",
  description: "以价值投资大师的视角理解一家公司，买股票就是买公司。",
};

export default function AgentPage() {
  return (
    <div className="idea-screen">
      <SiteNav />
      <div className="idea-screen-main">
        <AgentChat />
      </div>
    </div>
  );
}
