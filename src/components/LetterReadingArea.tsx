"use client";

import {
  isValidElement,
  useState,
  useMemo,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";

type ReadingMode = "all";

interface LetterReadingAreaProps {
  year: number;
  contentMd: string;
  sourceType?: string;
}

const FONT_SIZES = [14, 15, 16, 17, 18, 20];
const LINE_HEIGHTS = [1.5, 1.65, 1.8, 2.0, 2.2];

const DEFAULT_FONT = 2;      // index → 16px
const DEFAULT_LINE = 2;      // index → 1.8

function getInitialFontIdx() {
  if (typeof window === "undefined") return DEFAULT_FONT;
  const saved = window.localStorage.getItem("reader-font-idx");
  if (saved === null) return DEFAULT_FONT;
  const parsed = Number(saved);
  if (!Number.isFinite(parsed)) return DEFAULT_FONT;
  return Math.max(0, Math.min(FONT_SIZES.length - 1, parsed));
}

function getInitialLineIdx() {
  if (typeof window === "undefined") return DEFAULT_LINE;
  const saved = window.localStorage.getItem("reader-line-idx");
  if (saved === null) return DEFAULT_LINE;
  const parsed = Number(saved);
  if (!Number.isFinite(parsed)) return DEFAULT_LINE;
  return Math.max(0, Math.min(LINE_HEIGHTS.length - 1, parsed));
}


function hasCJK(text: string): boolean {
  return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(text);
}

function extractPlainText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!node) return "";
  if (Array.isArray(node)) return node.map(extractPlainText).join(" ");
  if (isValidElement<{ children?: ReactNode }>(node)) return extractPlainText(node.props.children);
  return "";
}

function joinClassNames(...names: Array<string | undefined>) {
  return names.filter(Boolean).join(" ");
}

function mixedModeLangClass(children: ReactNode, readingMode: ReadingMode): string {
  if (readingMode !== "all") return "";
  const text = extractPlainText(children).trim();
  if (!text) return "";
  return hasCJK(text) ? "md-lang-block md-lang-zh" : "md-lang-block md-lang-en";
}

function createMarkdownComponents(readingMode: ReadingMode) {
  return {
    table: (props: ComponentPropsWithoutRef<"table">) => (
      <div className="md-table-wrap">
        <table {...props} />
      </div>
    ),
    a: (props: ComponentPropsWithoutRef<"a">) => {
      const href = props.href ?? "";
      const isExternal = /^https?:\/\//i.test(href);
      return (
        <a
          {...props}
          target={isExternal ? "_blank" : props.target}
          rel={isExternal ? "noopener noreferrer" : props.rel}
        />
      );
    },
    p: (props: ComponentPropsWithoutRef<"p">) => (
      <p {...props} className={joinClassNames(props.className, mixedModeLangClass(props.children, readingMode))} />
    ),
    h1: (props: ComponentPropsWithoutRef<"h1">) => (
      <h1 {...props} className={joinClassNames(props.className, mixedModeLangClass(props.children, readingMode))} />
    ),
    h2: (props: ComponentPropsWithoutRef<"h2">) => (
      <h2 {...props} className={joinClassNames(props.className, mixedModeLangClass(props.children, readingMode))} />
    ),
    h3: (props: ComponentPropsWithoutRef<"h3">) => (
      <h3 {...props} className={joinClassNames(props.className, mixedModeLangClass(props.children, readingMode))} />
    ),
    blockquote: (props: ComponentPropsWithoutRef<"blockquote">) => (
      <blockquote
        {...props}
        className={joinClassNames(props.className, mixedModeLangClass(props.children, readingMode))}
      />
    ),
  };
}

// ── Strip metadata header ──────────────────────────────────────────────────

function stripHeader(md: string): string {
  const lines = md.split("\n");
  let lastMetaLine = 0;
  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const t = lines[i].trim();
    if (
      t.startsWith("原文信息") ||
      t.startsWith("- 标题") ||
      t.startsWith("- 作者") ||
      t.startsWith("- 发表") ||
      t.startsWith("- 链接") ||
      t.startsWith("- 中文") ||
      t.startsWith("- 整理") ||
      t.startsWith("- 修订") ||
      t.startsWith("- 校译") ||
      t.startsWith("- 校对") ||
      t.startsWith("[^") ||
      (t === "---" && i < 20) ||
      t === ""
    ) {
      lastMetaLine = i;
    }
  }
  return lines.slice(lastMetaLine + 1).join("\n").trim();
}

// ── Filter markdown by language ────────────────────────────────────────────

function filterByLanguage(md: string, mode: ReadingMode): string {
  if (mode === "all") return md;

  const lines = md.split("\n");
  const result: string[] = [];
  let inTable = false;
  let tableIsTarget = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Track table blocks — keep table with its header language
    if (trimmed.startsWith("|") || trimmed.match(/^---[\s|:]+/)) {
      if (!inTable) {
        inTable = true;
        // Table language determined by first cell content
        tableIsTarget = mode === "en" ? !hasCJK(trimmed) : hasCJK(trimmed);
      }
      if (tableIsTarget) result.push(line);
      continue;
    } else {
      inTable = false;
    }

    // Empty lines: keep for spacing
    if (!trimmed) {
      result.push(line);
      continue;
    }

    // Headings: keep for both (they often have both languages)
    if (trimmed.startsWith("#")) {
      if (mode === "en") {
        // Strip Chinese from heading like "# Insurance Operations 保险业务"
        const cleaned = trimmed.replace(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]+/g, "").trim();
        result.push(cleaned);
      } else {
        // Keep Chinese part of heading; if no Chinese exists, keep the original heading.
        const zhMatch = trimmed.match(/([\u4e00-\u9fff][\u4e00-\u9fff\u3000-\u303f\uff00-\uffef\s·\-—]+)/);
        if (zhMatch) {
          const level = trimmed.match(/^#+/)?.[0] ?? "#";
          result.push(`${level} ${zhMatch[1].trim()}`);
        } else {
          result.push(trimmed);
        }
      }
      continue;
    }

    // Regular paragraphs: filter by language
    const isZh = hasCJK(trimmed);
    if (mode === "en" && !isZh) result.push(line);
    if (mode === "zh" && isZh) result.push(line);
  }

  // Clean up excessive blank lines
  const filtered = result.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!filtered && mode !== "en") return md;
  return filtered;
}

// ── Component ──────────────────────────────────────────────────────────────

export function LetterReadingArea({ year, contentMd, sourceType = "shareholder" }: LetterReadingAreaProps) {
  const router = useRouter();
  const [fontIdx, setFontIdx] = useState(getInitialFontIdx);
  const [lineIdx, setLineIdx] = useState(getInitialLineIdx);
  const readingMode: ReadingMode = "all";

  function changeFontIdx(next: number) {
    const clamped = Math.max(0, Math.min(FONT_SIZES.length - 1, next));
    setFontIdx(clamped);
    localStorage.setItem("reader-font-idx", String(clamped));
  }

  function changeLineIdx(next: number) {
    const clamped = Math.max(0, Math.min(LINE_HEIGHTS.length - 1, next));
    setLineIdx(clamped);
    localStorage.setItem("reader-line-idx", String(clamped));
  }

  const body = useMemo(() => stripHeader(contentMd), [contentMd]);
  const filtered = useMemo(() => {
    const md = filterByLanguage(body, readingMode);
    return md.replace(/<\/br>/gi, "<br/>");
  }, [body, readingMode]);
  const markdownComponents = useMemo(() => createMarkdownComponents(readingMode), [readingMode]);

  return (
    <>
      {/* Toolbar */}
      <div className="letter-bar">
        <div className="letter-bar-heading">
          <span className="letter-bar-title">
            {year} {{ shareholder: "致股东信", partnership: "致合伙人信", annual_meeting: "股东大会", article: "文章", interview: "采访" }[sourceType] ?? sourceType}
          </span>
        </div>

        <div className="letter-bar-controls">
          {/* Font size */}
          <div className="letter-bar-ctrl-group" title="字体大小">
            <button
              className="letter-bar-ctrl-btn"
              onClick={() => changeFontIdx(fontIdx - 1)}
              disabled={fontIdx === 0}
              aria-label="缩小字体"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h6M4 12h6M4 17h6"/><path d="m14 9-3 9M17 9l-3 9"/></svg>
            </button>
            <span className="letter-bar-ctrl-val" suppressHydrationWarning>{FONT_SIZES[fontIdx]}px</span>
            <button
              className="letter-bar-ctrl-btn"
              onClick={() => changeFontIdx(fontIdx + 1)}
              disabled={fontIdx === FONT_SIZES.length - 1}
              aria-label="放大字体"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h6M4 12h6M4 17h6"/><path d="m14 9-3 9M17 9l-3 9M15 7h6M18 4v6"/></svg>
            </button>
          </div>

          <span className="letter-bar-divider" />

          {/* Line height */}
          <div className="letter-bar-ctrl-group" title="行间距">
            <button
              className="letter-bar-ctrl-btn"
              onClick={() => changeLineIdx(lineIdx - 1)}
              disabled={lineIdx === 0}
              aria-label="减小行距"
            >
              <LineHeightIcon tight />
            </button>
            <span className="letter-bar-ctrl-val" suppressHydrationWarning>{LINE_HEIGHTS[lineIdx].toFixed(1)}</span>
            <button
              className="letter-bar-ctrl-btn"
              onClick={() => changeLineIdx(lineIdx + 1)}
              disabled={lineIdx === LINE_HEIGHTS.length - 1}
              aria-label="增大行距"
            >
              <LineHeightIcon />
            </button>
          </div>
        </div>
      </div>

      {/* Markdown reader */}
      <div
        className="md-reader"
        style={{ fontSize: FONT_SIZES[fontIdx], lineHeight: LINE_HEIGHTS[lineIdx] }}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={markdownComponents}>
          {filtered}
        </ReactMarkdown>
      </div>

      {/* FAB → navigate to workspace with this source open */}
      <button
        className="chat-fab"
        onClick={() => router.push(`/idea?source=${sourceType}&year=${year}`)}
        aria-label="进入 Text Room"
        title="进入 Text Room"
      >
        <span className="chat-fab-ring" />
        <Image
          src="/buffett-avarta.jpg"
          alt="Warren Buffett"
          className="chat-fab-img"
          width={44}
          height={44}
        />
        <span className="chat-fab-label">进入 Text Room</span>
      </button>
    </>
  );
}

// Inline SVG icon for line height
function LineHeightIcon({ tight }: { tight?: boolean }) {
  const gap = tight ? 3 : 6;
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <line x1="4" y1="3" x2="12" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="4" y1={3 + gap} x2="12" y2={3 + gap} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="4" y1={3 + gap * 2} x2="12" y2={3 + gap * 2} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}
