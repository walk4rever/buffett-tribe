"use client";

import { useState } from "react";
import { Sparkles, X } from "lucide-react";
import { AgentChat } from "@/components/AgentChat";
import { useAgentChat } from "@/hooks/useAgentChat";
import { useAgentGate } from "@/hooks/useAgentGate";

interface CompanyAgentDialogProps {
  companyName: string;
  ticker?: string | null;
}

export function CompanyAgentDialog({ companyName, ticker }: CompanyAgentDialogProps) {
  const [open, setOpen] = useState(false);
  const { requireAuth } = useAgentGate(() => setOpen(true));
  // Called here (not inside the conditionally-rendered modal below) so closing the
  // dialog doesn't unmount the conversation state along with it.
  const { messages, input, setInput, streaming, sendMessage, abort } = useAgentChat({
    context: { companyName, ticker: ticker ?? undefined },
  });

  return (
    <>
      <button type="button" className="master-agent-fab" onClick={() => { if (requireAuth()) setOpen(true); }}>
        <Sparkles size={15} strokeWidth={2} />
        <span>AI 解读</span>
      </button>

      {open ? (
        <div className="master-agent-overlay" onClick={() => setOpen(false)}>
          <div className="master-agent-modal" onClick={(e) => e.stopPropagation()}>
            <div className="master-agent-modal-header">
              <span>解读 {companyName}</span>
              <button
                type="button"
                className="master-agent-modal-close"
                onClick={() => setOpen(false)}
                aria-label="关闭"
              >
                <X size={16} strokeWidth={1.9} />
              </button>
            </div>
            <div className="master-agent-modal-body">
              <AgentChat
                messages={messages}
                input={input}
                setInput={setInput}
                streaming={streaming}
                sendMessage={sendMessage}
                abort={abort}
                emptyTitle={`理解${companyName}`}
                emptySubtitle="以价值投资框架，看穿公司的本质"
                placeholder={`问${companyName}的护城河、财务表现或持仓… (Enter 发送，Shift+Enter 换行)`}
                suggestions={[
                  `${companyName}的护城河是什么？`,
                  `${companyName}最近的财务表现如何？`,
                  `有哪些大师持有${companyName}？`,
                  `${companyName}目前的估值合理吗？`,
                ]}
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
