"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import PdfViewer from "@/components/PdfViewer";
import { FilingAgentPanel } from "@/components/FilingAgentPanel";
import { useAgentChat } from "@/hooks/useAgentChat";

interface PdfFilingReaderProps {
  pdfUrl: string;
  title: string;
  backHref: string;
  companyName: string;
  ticker: string | null;
  periodYear: number | null;
}

export function PdfFilingReader({
  pdfUrl,
  title,
  backHref,
  companyName,
  ticker,
  periodYear,
}: PdfFilingReaderProps) {
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  // Called here (not inside FilingAgentPanel, which unmounts when aiPanelOpen is
  // false) so closing the panel doesn't unmount the conversation state with it.
  const { messages, input, setInput, streaming, sendMessage, abort } = useAgentChat({
    context: { companyName, ticker: ticker ?? undefined, periodYear: periodYear ?? undefined },
  });

  return (
    <div className="pdf-reader-body">
      <div className="pdf-reader-main">
        <PdfViewer key={pdfUrl} url={pdfUrl} title={title} backHref={backHref} backLabel="返回公司页" />
      </div>

      {aiPanelOpen ? (
        <FilingAgentPanel
          companyName={companyName}
          periodYear={periodYear}
          onClose={() => setAiPanelOpen(false)}
          messages={messages}
          input={input}
          setInput={setInput}
          streaming={streaming}
          sendMessage={sendMessage}
          abort={abort}
        />
      ) : null}

      {!aiPanelOpen ? (
        <button type="button" className="master-agent-fab" onClick={() => setAiPanelOpen(true)}>
          <Sparkles size={15} strokeWidth={2} />
          <span>AI 解读</span>
        </button>
      ) : null}
    </div>
  );
}
