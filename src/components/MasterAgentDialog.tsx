"use client";

import { useState } from "react";
import { Maximize2, Minimize2, Sparkles, X } from "lucide-react";
import { AgentChat } from "@/components/AgentChat";
import { useAgentChat } from "@/hooks/useAgentChat";
import { useAgentGate } from "@/hooks/useAgentGate";

interface MasterAgentDialogProps {
  masterId: string;
  masterName: string;
}

export function MasterAgentDialog({ masterId, masterName }: MasterAgentDialogProps) {
  const [open, setOpen] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const { requireAuth } = useAgentGate(() => setOpen(true));
  // Called here (not inside the conditionally-rendered modal below) so closing the
  // dialog doesn't unmount the conversation state along with it.
  const { messages, input, setInput, streaming, sendMessage, abort, pendingImages, addImage, removeImage } =
    useAgentChat({
      context: { masterId, masterName },
    });

  return (
    <>
      <button type="button" className="master-agent-fab" onClick={() => { if (requireAuth()) setOpen(true); }}>
        <Sparkles size={15} strokeWidth={2} />
        <span>AI 解读</span>
      </button>

      {open ? (
        <div className={`master-agent-overlay${maximized ? " is-maximized" : ""}`} onClick={() => setOpen(false)}>
          <div
            className={`master-agent-modal${maximized ? " is-maximized" : ""}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="master-agent-modal-header">
              <span>AI 解读 · {masterName}</span>
              <div className="master-agent-modal-header-actions">
                <button
                  type="button"
                  className="master-agent-modal-close"
                  onClick={() => setMaximized((v) => !v)}
                  aria-label={maximized ? "还原" : "最大化"}
                >
                  {maximized ? <Minimize2 size={16} strokeWidth={1.9} /> : <Maximize2 size={16} strokeWidth={1.9} />}
                </button>
                <button
                  type="button"
                  className="master-agent-modal-close"
                  onClick={() => setOpen(false)}
                  aria-label="关闭"
                >
                  <X size={16} strokeWidth={1.9} />
                </button>
              </div>
            </div>
            <div className="master-agent-modal-body">
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
                emptyTitle={`理解${masterName}`}
                emptySubtitle="以他的投资框架，看穿公司的本质"
                placeholder={`问${masterName}的投资框架、持仓或某家公司… (Enter 发送，Shift+Enter 换行)`}
                suggestions={[
                  `${masterName}如何看待护城河与定价权？`,
                  `${masterName}最近的持仓有哪些变化？`,
                  `${masterName}的投资框架适合什么样的公司？`,
                  `${masterName}历史上最经典的投资案例是什么？`,
                ]}
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
