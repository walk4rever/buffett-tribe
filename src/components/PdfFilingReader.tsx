"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import PdfViewer from "@/components/PdfViewer";
import { FilingAgentPanel } from "@/components/FilingAgentPanel";

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

  return (
    <div className="pdf-reader-body">
      <div className="pdf-reader-main">
        <PdfViewer key={pdfUrl} url={pdfUrl} title={title} backHref={backHref} />
      </div>

      {aiPanelOpen ? (
        <FilingAgentPanel
          companyName={companyName}
          ticker={ticker}
          periodYear={periodYear}
          onClose={() => setAiPanelOpen(false)}
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
