"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Sparkles, Share2, Check } from "lucide-react";
import { InsightAgentPanel } from "@/components/InsightAgentPanel";
import { useAgentChat } from "@/hooks/useAgentChat";
import { useAgentGate } from "@/hooks/useAgentGate";
import { buildInsightHighlightShareText } from "@/lib/insights";

interface InsightChatShellProps {
  slug: string;
  title: string;
  source?: string | null;
  children: ReactNode;
}

type QuoteButtonState = { text: string; top: number; left: number };

// Matches the max-width in .filing-reader-ai-panel's own media query
// (globals.css) — that's the width where the panel itself switches from a
// docked sidebar to a fixed full-screen overlay, so the two must agree or
// the docked article layout and the panel's own CSS disagree about the mode.
const DESKTOP_QUERY = "(min-width: 901px)";

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia(DESKTOP_QUERY).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return isDesktop;
}

// .site-main (src/app/layout.tsx) is the app's single scroll container —
// there's no window/body scroll anywhere in this app shell.
function getScroller(): HTMLElement | null {
  return document.querySelector(".site-main");
}

export function InsightChatShell({ slug, title, source, children }: InsightChatShellProps) {
  const articleRef = useRef<HTMLDivElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [quoteButton, setQuoteButton] = useState<QuoteButtonState | null>(null);
  const [pendingQuote, setPendingQuote] = useState<{ text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingScrollRef = useRef<number | null>(null);
  const isDesktop = useIsDesktop();
  const docked = open && isDesktop;
  // Called here (not inside InsightAgentPanel, which unmounts when `open` is
  // false) so closing the panel doesn't unmount the conversation state with it.
  const { messages, input, setInput, streaming, sendMessage, abort, pendingImages, addImage, removeImage } =
    useAgentChat({
      context: { insightSlug: slug, insightTitle: title },
    });
  const { requireAuth } = useAgentGate(openPanel);

  // While the panel is open, .site-main shouldn't also scroll — on desktop the
  // article becomes its own scroll box (see below), on mobile the panel is a
  // fixed full-screen overlay and there's nothing useful behind it to scroll.
  useEffect(() => {
    if (!open) return;
    if (docked && pendingScrollRef.current !== null && articleRef.current) {
      articleRef.current.scrollTop = pendingScrollRef.current;
    }
    pendingScrollRef.current = null;
    const scroller = getScroller();
    if (!scroller) return;
    const prevOverflow = scroller.style.overflow;
    scroller.style.overflow = "hidden";
    return () => {
      scroller.style.overflow = prevOverflow;
    };
  }, [open, docked]);

  // Mirror of the capture in closePanel(): replay the saved position onto
  // .site-main before paint so closing the panel doesn't snap the reader
  // back to the top of the article.
  useLayoutEffect(() => {
    if (open) return;
    if (pendingScrollRef.current === null) return;
    const scroller = getScroller();
    if (scroller) scroller.scrollTop = pendingScrollRef.current;
    pendingScrollRef.current = null;
  }, [open]);

  // Selected text lives in the main document (not an iframe, unlike the
  // filing reader), so a plain document-level listener is enough. Scoped to
  // articleRef so selecting text inside the chat panel itself doesn't also
  // pop the "AI解读" / "高光分享" toolbar.
  useEffect(() => {
    function handleSelectionChange() {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        setQuoteButton(null);
        setCopied(false);
        return;
      }
      const range = selection.getRangeAt(0);
      if (!articleRef.current?.contains(range.commonAncestorContainer)) {
        setQuoteButton(null);
        setCopied(false);
        return;
      }
      const text = selection.toString().trim();
      if (!text) {
        setQuoteButton(null);
        setCopied(false);
        return;
      }
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setQuoteButton(null);
        setCopied(false);
        return;
      }
      const isNearTop = rect.top < 52;
      const top = isNearTop ? rect.bottom + 10 : rect.top - 44;
      const left = Math.max(110, Math.min(window.innerWidth - 110, rect.left + rect.width / 2));
      setQuoteButton({ text, top, left });
    }

    function handlePointerDown(e: PointerEvent) {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setQuoteButton(null);
        setCopied(false);
      }
    }

    document.addEventListener("selectionchange", handleSelectionChange);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
      document.removeEventListener("pointerdown", handlePointerDown);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    };
  }, []);

  function openPanel() {
    const scroller = getScroller();
    pendingScrollRef.current = scroller ? scroller.scrollTop : null;
    setOpen(true);
  }

  function closePanel() {
    pendingScrollRef.current = docked && articleRef.current ? articleRef.current.scrollTop : null;
    setOpen(false);
    setPendingQuote(null);
  }

  function askAboutQuote() {
    if (!quoteButton) return;
    const text = quoteButton.text;
    setQuoteButton(null);
    setCopied(false);
    if (!requireAuth()) return;
    setPendingQuote({ text });
    openPanel();
    window.getSelection()?.removeAllRanges();
  }

  async function handleShareQuote() {
    if (!quoteButton?.text) return;
    const shareText = buildInsightHighlightShareText({
      title,
      slug,
      quoteText: quoteButton.text,
      source,
    });

    const success = await copyToClipboard(shareText);
    if (success) {
      setCopied(true);
      setToastMessage("已复制高光分享文案");
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => {
        setCopied(false);
      }, 2000);
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
      toastTimeoutRef.current = setTimeout(() => {
        setToastMessage(null);
      }, 2400);
    }
  }

  const articleNode = (
    <div ref={articleRef} className={docked ? "insight-chat-article" : undefined}>
      {children}
    </div>
  );

  return (
    <>
      {docked ? (
        <div className="insight-chat-row">
          {articleNode}
          <InsightAgentPanel
            insightTitle={title}
            onClose={closePanel}
            pendingQuote={pendingQuote}
            messages={messages}
            input={input}
            setInput={setInput}
            streaming={streaming}
            sendMessage={sendMessage}
            abort={abort}
            pendingImages={pendingImages}
            onAddImage={addImage}
            onRemoveImage={removeImage}
          />
        </div>
      ) : (
        <>
          {articleNode}
          {open ? (
            <InsightAgentPanel
              insightTitle={title}
              onClose={closePanel}
              pendingQuote={pendingQuote}
              messages={messages}
              input={input}
              setInput={setInput}
              streaming={streaming}
              sendMessage={sendMessage}
              abort={abort}
              pendingImages={pendingImages}
              onAddImage={addImage}
              onRemoveImage={removeImage}
            />
          ) : null}
        </>
      )}

      {quoteButton ? (
        <div
          ref={toolbarRef}
          className="insight-selection-toolbar"
          style={{ top: quoteButton.top, left: quoteButton.left }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <button
            type="button"
            className="insight-selection-btn insight-selection-btn--ai"
            onClick={askAboutQuote}
            title="使用 AI 解读所选段落"
          >
            <Sparkles size={13} strokeWidth={2} />
            <span>AI解读</span>
          </button>

          <span className="insight-selection-divider" aria-hidden="true" />

          <button
            type="button"
            className={`insight-selection-btn insight-selection-btn--share${copied ? " insight-selection-btn--copied" : ""}`}
            onClick={handleShareQuote}
            title="复制高光分享文案"
          >
            {copied ? (
              <>
                <Check size={13} strokeWidth={2.4} />
                <span>已复制</span>
              </>
            ) : (
              <>
                <Share2 size={13} strokeWidth={2} />
                <span>高光分享</span>
              </>
            )}
          </button>
        </div>
      ) : null}

      {toastMessage ? (
        <div className="insight-selection-toast" role="status" aria-live="polite">
          <Check size={14} strokeWidth={2.4} className="insight-selection-toast-icon" />
          <span>{toastMessage}</span>
        </div>
      ) : null}

      {!open ? (
        <button
          type="button"
          className="master-agent-fab"
          onClick={() => { if (requireAuth()) openPanel(); }}
        >
          <Sparkles size={15} strokeWidth={2} />
          <span>AI 解读</span>
        </button>
      ) : null}
    </>
  );
}

async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fallback to execCommand below
    }
  }
  try {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-999999px";
    textArea.style.top = "-999999px";
    textArea.setAttribute("readonly", "");
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const successful = document.execCommand("copy");
    textArea.remove();
    return successful;
  } catch (err) {
    console.error("[insight-share] clipboard copy failed", err);
    return false;
  }
}
