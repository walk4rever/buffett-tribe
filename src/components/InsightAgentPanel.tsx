"use client";

import { X } from "lucide-react";
import { AgentChat } from "@/components/AgentChat";
import type { Message } from "@/hooks/useAgentChat";

interface InsightAgentPanelProps {
  insightTitle: string;
  onClose: () => void;
  pendingQuote?: { text: string } | null;
  /** Conversation state — owned by a `useAgentChat()` call in the parent shell that
   *  stays mounted while this panel toggles open/closed. */
  messages: Message[];
  input: string;
  setInput: (value: string) => void;
  streaming: boolean;
  sendMessage: (text: string) => void;
  abort: () => void;
}

export function InsightAgentPanel({
  insightTitle,
  onClose,
  pendingQuote,
  messages,
  input,
  setInput,
  streaming,
  sendMessage,
  abort,
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
          messages={messages}
          input={input}
          setInput={setInput}
          streaming={streaming}
          sendMessage={sendMessage}
          abort={abort}
          emptyTitle={`理解这篇文章`}
          emptySubtitle="选中正文中的段落，或者直接提问"
          placeholder="针对这篇文章提问，或选中正文段落讨论… (Enter 发送，Shift+Enter 换行)"
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
