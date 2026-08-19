"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { InsightAgentPanel } from "@/components/InsightAgentPanel";
import { useAgentChat } from "@/hooks/useAgentChat";

interface InsightChatShellProps {
  slug: string;
  title: string;
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

export function InsightChatShell({ slug, title, children }: InsightChatShellProps) {
  const articleRef = useRef<HTMLDivElement | null>(null);
  const quoteButtonRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [quoteButton, setQuoteButton] = useState<QuoteButtonState | null>(null);
  const [pendingQuote, setPendingQuote] = useState<{ text: string } | null>(null);
  const pendingScrollRef = useRef<number | null>(null);
  const isDesktop = useIsDesktop();
  const docked = open && isDesktop;
  // Called here (not inside InsightAgentPanel, which unmounts when `open` is
  // false) so closing the panel doesn't unmount the conversation state with it.
  const { messages, input, setInput, streaming, sendMessage, abort } = useAgentChat({
    context: { insightSlug: slug, insightTitle: title },
  });

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
  // pop the "问 AI 这段" button.
  useEffect(() => {
    function handleSelectionChange() {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        setQuoteButton(null);
        return;
      }
      const range = selection.getRangeAt(0);
      if (!articleRef.current?.contains(range.commonAncestorContainer)) {
        setQuoteButton(null);
        return;
      }
      const text = selection.toString().trim();
      if (!text) {
        setQuoteButton(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setQuoteButton(null);
        return;
      }
      setQuoteButton({ text, top: rect.top - 40, left: rect.left + rect.width / 2 });
    }

    function handlePointerDown(e: PointerEvent) {
      if (quoteButtonRef.current && !quoteButtonRef.current.contains(e.target as Node)) {
        setQuoteButton(null);
      }
    }

    document.addEventListener("selectionchange", handleSelectionChange);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
      document.removeEventListener("pointerdown", handlePointerDown);
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
    setPendingQuote({ text: quoteButton.text });
    openPanel();
    setQuoteButton(null);
    window.getSelection()?.removeAllRanges();
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
            />
          ) : null}
        </>
      )}

      {quoteButton ? (
        <button
          ref={quoteButtonRef}
          type="button"
          className="filing-reader-quote-btn"
          style={{ top: quoteButton.top, left: quoteButton.left }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={askAboutQuote}
        >
          问 AI 这段 →
        </button>
      ) : null}

      {!open ? (
        <button type="button" className="master-agent-fab" onClick={openPanel}>
          <Sparkles size={15} strokeWidth={2} />
          <span>AI 解读</span>
        </button>
      ) : null}
    </>
  );
}
