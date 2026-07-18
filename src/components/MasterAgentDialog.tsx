"use client";

import { useState } from "react";
import { Sparkles, X } from "lucide-react";
import { AgentChat } from "@/components/AgentChat";

interface MasterAgentDialogProps {
  masterId: string;
  masterName: string;
}

export function MasterAgentDialog({ masterId, masterName }: MasterAgentDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="master-agent-fab" onClick={() => setOpen(true)}>
        <Sparkles size={15} strokeWidth={2} />
        <span>AI 解读</span>
      </button>

      {open ? (
        <div className="master-agent-overlay" onClick={() => setOpen(false)}>
          <div className="master-agent-modal" onClick={(e) => e.stopPropagation()}>
            <div className="master-agent-modal-header">
              <span>与 {masterName} 对话</span>
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
                context={{ masterId, masterName }}
                emptyTitle={`理解${masterName}`}
                emptySubtitle="以他的投资框架，看穿公司的本质"
                placeholder=""
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
