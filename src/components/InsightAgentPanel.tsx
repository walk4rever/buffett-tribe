"use client";

import { X } from "lucide-react";
import { AgentChat } from "@/components/AgentChat";

interface InsightAgentPanelProps {
  insightSlug: string;
  insightTitle: string;
  onClose: () => void;
  pendingQuote?: { text: string } | null;
}

export function InsightAgentPanel({
  insightSlug,
  insightTitle,
  onClose,
  pendingQuote,
}: InsightAgentPanelProps) {
  return (
    <aside className="filing-reader-ai-panel">
      <div className="filing-reader-ai-panel-header">
        <span>AI 解读 · {insightTitle}</span>
        <button type="button" className="filing-reader-ai-panel-close" onClick={onClose} aria-label="关闭">
          <X size={16} strokeWidth={1.9} />
        </button>
      </div>
      <div className="filing-reader-ai-panel-body">
        <AgentChat
          context={{ insightSlug, insightTitle }}
          emptyTitle={`理解这篇文章`}
          emptySubtitle="选中正文中的段落，或者直接提问"
          placeholder=""
          pendingQuote={pendingQuote}
          suggestions={[
            "这篇文章的核心论点是什么？",
            "帮我梳理一下里面提到的关键数据",
            "这篇和其他洞见文章有什么关联？",
          ]}
        />
      </div>
    </aside>
  );
}
