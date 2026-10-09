"use client";

import { AgentChat } from "@/components/AgentChat";
import { useAgentChat } from "@/hooks/useAgentChat";

interface CompanyChatPaneProps {
  companyName: string;
  ticker: string;
  companyUrl?: string | null;
  onSaveAsNote?: (text: string) => void;
}

export function CompanyChatPane({
  companyName,
  ticker,
  onSaveAsNote,
}: CompanyChatPaneProps) {
  const {
    messages,
    input,
    setInput,
    streaming,
    sendMessage,
    abort,
    pendingImages,
    addImage,
    removeImage,
  } = useAgentChat({
    context: { companyName, ticker },
  });

  return (
    <div className="agent-company-chat-pane">
      <div className="agent-company-chat-body">
        <AgentChat
          messages={messages}
          input={input}
          setInput={setInput}
          streaming={streaming}
          sendMessage={sendMessage}
          abort={abort}
          pendingImages={pendingImages}
          onAddImage={addImage}
          onRemoveImage={removeImage}
          onSaveAsNote={onSaveAsNote}
          emptyTitle={`理解 ${companyName}`}
          emptySubtitle="以价值投资框架，看穿公司的本质"
          placeholder={`问 ${companyName} 的护城河、财务表现或持仓… (Enter 发送，Shift+Enter 换行)`}
          suggestions={[
            `${companyName}的护城河是什么？`,
            `${companyName}最近的财务表现如何？`,
            `有哪些大师持有${companyName}？`,
            `${companyName}目前的估值合理吗？`,
          ]}
        />
      </div>
    </div>
  );
}
