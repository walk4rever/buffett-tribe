"use client";

import { X } from "lucide-react";
import { AgentChat } from "@/components/AgentChat";

interface FilingAgentPanelProps {
  companyName: string;
  ticker: string | null;
  periodYear: number | null;
  onClose: () => void;
  pendingQuote?: { text: string } | null;
}

export function FilingAgentPanel({
  companyName,
  ticker,
  periodYear,
  onClose,
  pendingQuote,
}: FilingAgentPanelProps) {
  const yearLabel = periodYear ? `${periodYear} 年报` : "年报";

  return (
    <aside className="filing-reader-ai-panel">
      <div className="filing-reader-ai-panel-header">
        <span>解读 {companyName} {yearLabel}</span>
        <button type="button" className="filing-reader-ai-panel-close" onClick={onClose} aria-label="关闭">
          <X size={16} strokeWidth={1.9} />
        </button>
      </div>
      <div className="filing-reader-ai-panel-body">
        <AgentChat
          context={{
            companyName,
            ticker: ticker ?? undefined,
            periodYear: periodYear ?? undefined,
          }}
          emptyTitle={`理解${companyName}`}
          emptySubtitle="基于年报原文，看懂这家公司在说什么"
          placeholder={`针对${companyName}这份年报提问，或选中原文讨论… (Enter 发送，Shift+Enter 换行)`}
          pendingQuote={pendingQuote}
          suggestions={[
            `${companyName}这份年报最大的风险是什么？`,
            `${companyName}的营收和利润增长主要靠什么？`,
            `管理层怎么解释这一年的经营表现？`,
            `跟去年相比，这份年报有什么变化？`,
          ]}
        />
      </div>
    </aside>
  );
}
