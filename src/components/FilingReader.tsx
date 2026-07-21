"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ALargeSmall, AlignVerticalSpaceAround, ChevronLeft, ExternalLink, Sparkles } from "lucide-react";
import { formatCompanyCikUrl, type CompanyAnnualFiling } from "@/lib/company-data";
import { FilingAgentPanel } from "@/components/FilingAgentPanel";

type FilingReaderProps = {
  company: {
    name: string;
    nameZh: string | null;
    ticker: string | null;
    cik: string | null;
  };
  filing: CompanyAnnualFiling;
};

function formatShortDate(date: Date | null) {
  if (!date) return null;
  return date.toISOString().slice(5, 10);
}

function formatFilingKindLabel(kind: string) {
  if (kind === "10k") return "10-K";
  if (kind === "20f") return "20-F";
  if (kind === "40f") return "40-F";
  return kind.toUpperCase();
}

const FONT_LEVELS = [
  { zoom: 0.9, label: "小" },
  { zoom: 1, label: "中" },
  { zoom: 1.15, label: "大" },
  { zoom: 1.3, label: "特大" },
] as const;

const LINE_LEVELS = [
  { value: 1.3, label: "紧凑" },
  { value: 1.6, label: "标准" },
  { value: 1.9, label: "宽松" },
] as const;

const FONT_LEVEL_STORAGE_KEY = "filing-reader-font-level";
const LINE_LEVEL_STORAGE_KEY = "filing-reader-line-level";

// Reading from localStorage during render would make the client's first render
// diverge from the SSR output (React hydration mismatch). useSyncExternalStore is
// the mechanism React provides for exactly this: it renders getServerSnapshot()
// during SSR and the initial client hydration pass so they always match, then
// switches to getSnapshot() afterward.
function createLevelStore(key: string, length: number, defaultIndex: number) {
  const listeners = new Set<() => void>();

  function getSnapshot() {
    const stored = localStorage.getItem(key);
    if (stored === null) return defaultIndex;
    const raw = Number(stored);
    return Number.isInteger(raw) && raw >= 0 && raw < length ? raw : defaultIndex;
  }

  function subscribe(onStoreChange: () => void) {
    listeners.add(onStoreChange);
    return () => listeners.delete(onStoreChange);
  }

  function setIndex(next: number) {
    localStorage.setItem(key, String(next));
    listeners.forEach((listener) => listener());
  }

  return { getSnapshot, getServerSnapshot: () => defaultIndex, subscribe, setIndex };
}

const fontLevelStore = createLevelStore(FONT_LEVEL_STORAGE_KEY, FONT_LEVELS.length, 1);
const lineLevelStore = createLevelStore(LINE_LEVEL_STORAGE_KEY, LINE_LEVELS.length, 1);

function applyFontZoom(doc: Document, zoom: number) {
  doc.body.style.setProperty("zoom", String(zoom));
}

function applyLineSpacing(doc: Document, lineHeight: number) {
  doc.body.querySelectorAll<HTMLElement>("*").forEach((el) => {
    if (el.closest("table")) return;
    el.style.setProperty("line-height", String(lineHeight), "important");
  });
}

export function FilingReader({ company, filing }: FilingReaderProps) {
  const [frameReady, setFrameReady] = useState(false);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const fontLevelIndex = useSyncExternalStore(
    fontLevelStore.subscribe,
    fontLevelStore.getSnapshot,
    fontLevelStore.getServerSnapshot,
  );
  const lineLevelIndex = useSyncExternalStore(
    lineLevelStore.subscribe,
    lineLevelStore.getSnapshot,
    lineLevelStore.getServerSnapshot,
  );
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const primaryHtmlArtifact = filing.artifacts.find(
    (a) => a.kind === "primary_html" && a.objectKey,
  );
  const htmlSrc = primaryHtmlArtifact
    ? `/api/filing-html?sourceId=${encodeURIComponent(filing.id)}`
    : null;

  const companyUrl = formatCompanyCikUrl(company.cik) ?? `/company/${company.cik ?? ""}`;
  const displayCompanyName = company.nameZh?.trim() || company.name;
  const reportLabel = `${filing.periodYear ?? "—"}${filing.periodQuarter ? ` Q${filing.periodQuarter}` : ""}`;
  const reportMetaLabel = [
    reportLabel,
    filing.filedAt ? `Filed ${formatShortDate(filing.filedAt)}` : null,
    filing.ts ? `Report ${formatShortDate(filing.ts)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const secOriginalUrl = filing.url ?? primaryHtmlArtifact?.sourceUrl ?? null;

  // The iframe's `load` event waits for every subresource, including images —
  // SEC filings routinely embed dozens proxied through /api/filing-image, some
  // taking minutes. Font/line-spacing controls only need the DOM parsed, so
  // poll readyState instead of waiting on the full load event.
  useEffect(() => {
    if (!htmlSrc) return;
    let cancelled = false;

    function tick() {
      if (cancelled) return;
      const doc = iframeRef.current?.contentDocument;
      const domReady = doc && doc.readyState !== "loading" && (doc.body?.children.length ?? 0) > 0;
      if (domReady && doc) {
        const style = doc.createElement("style");
        style.textContent =
          "html{scroll-behavior:smooth}:target{scroll-margin-top:1.5rem}" +
          "html,body{overflow-x:hidden}table{max-width:100%;overflow-x:auto}";
        doc.head?.appendChild(style);
        setFrameReady(true);
        return;
      }
      setTimeout(tick, 100);
    }

    tick();
    return () => {
      cancelled = true;
    };
  }, [htmlSrc]);

  useEffect(() => {
    if (!frameReady) return;
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    applyFontZoom(doc, FONT_LEVELS[fontLevelIndex].zoom);
  }, [frameReady, fontLevelIndex]);

  useEffect(() => {
    if (!frameReady) return;
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    applyLineSpacing(doc, LINE_LEVELS[lineLevelIndex].value);
  }, [frameReady, lineLevelIndex]);

  const cycleFontLevel = useCallback(() => {
    fontLevelStore.setIndex((fontLevelStore.getSnapshot() + 1) % FONT_LEVELS.length);
  }, []);

  const cycleLineLevel = useCallback(() => {
    lineLevelStore.setIndex((lineLevelStore.getSnapshot() + 1) % LINE_LEVELS.length);
  }, []);

  return (
    <div className="filing-reader">
      <div className="filing-reader-bar">
        <div className="filing-reader-bar-left">
          <Link href={`${companyUrl}?tab=references`} className="filing-reader-back" aria-label="返回年度报告">
            <ChevronLeft size={15} />
          </Link>
          <div className="filing-reader-bar-copy">
            <span className="filing-reader-bar-name">
              {displayCompanyName}
              {company.ticker ? <em>{company.ticker}</em> : null}
              {reportMetaLabel ? <small>{reportMetaLabel}</small> : null}
            </span>
          </div>
        </div>
        <div className="filing-reader-bar-right">
          <button type="button" className="filing-reader-tool-btn" onClick={cycleFontLevel} title="调整字体大小">
            <ALargeSmall size={16} />
            <span>{FONT_LEVELS[fontLevelIndex].label}</span>
          </button>
          <button type="button" className="filing-reader-tool-btn" onClick={cycleLineLevel} title="调整行间距">
            <AlignVerticalSpaceAround size={16} />
            <span>{LINE_LEVELS[lineLevelIndex].label}</span>
          </button>
          {secOriginalUrl ? (
            <a
              className="filing-reader-sec-link"
              href={secOriginalUrl}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={14} />
              SEC 原文
            </a>
          ) : null}
        </div>
      </div>

      <div className={`filing-reader-body${aiPanelOpen ? " filing-reader-body--split" : ""}`}>
        <main className="filing-reader-main filing-reader-main--frame">
          {htmlSrc ? (
            <iframe
              ref={iframeRef}
              src={htmlSrc}
              title={`${formatFilingKindLabel(filing.kind)} ${reportLabel}`}
              className="filing-reader-frame"
              sandbox="allow-same-origin allow-scripts"
            />
          ) : (
            <div className="filing-reader-frame-empty">
              <p>暂无 HTML 原文</p>
              {secOriginalUrl && (
                <a href={secOriginalUrl} target="_blank" rel="noreferrer">
                  在 SEC 查看
                  <ExternalLink size={13} />
                </a>
              )}
            </div>
          )}
        </main>

        {aiPanelOpen ? (
          <FilingAgentPanel
            companyName={displayCompanyName}
            ticker={company.ticker}
            periodYear={filing.periodYear}
            onClose={() => setAiPanelOpen(false)}
          />
        ) : null}
      </div>

      {!aiPanelOpen ? (
        <button type="button" className="master-agent-fab" onClick={() => setAiPanelOpen(true)}>
          <Sparkles size={15} strokeWidth={2} />
          <span>AI 解读</span>
        </button>
      ) : null}
    </div>
  );
}
