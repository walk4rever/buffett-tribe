"use client";

import { useState, useMemo, type ComponentPropsWithoutRef, type ReactNode, isValidElement } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";

export interface ArticleSource {
  id: string;
  title: string;
  date?: string | null;
  year: number;
  type: string;
  contentMd: string;
}

const FONT_SIZES = [14, 15, 16, 17, 18, 20];
const LINE_HEIGHTS = [1.5, 1.65, 1.8, 2.0, 2.2];
const DEFAULT_FONT = 2;
const DEFAULT_LINE = 2;

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

function mixedModeLangClass(children: ReactNode): string {
  const text = extractPlainText(children).trim();
  if (!text) return "";
  return hasCJK(text) ? "md-lang-block md-lang-zh" : "md-lang-block md-lang-en";
}

const markdownComponents = {
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
    <p {...props} className={joinClassNames(props.className, mixedModeLangClass(props.children))} />
  ),
  h1: (props: ComponentPropsWithoutRef<"h1">) => (
    <h1 {...props} className={joinClassNames(props.className, mixedModeLangClass(props.children))} />
  ),
  h2: (props: ComponentPropsWithoutRef<"h2">) => (
    <h2 {...props} className={joinClassNames(props.className, mixedModeLangClass(props.children))} />
  ),
  h3: (props: ComponentPropsWithoutRef<"h3">) => (
    <h3 {...props} className={joinClassNames(props.className, mixedModeLangClass(props.children))} />
  ),
  blockquote: (props: ComponentPropsWithoutRef<"blockquote">) => (
    <blockquote {...props} className={joinClassNames(props.className, mixedModeLangClass(props.children))} />
  ),
};

const TYPE_LABEL: Record<string, string> = {
  article: "文章",
  interview: "采访",
  post: "言论",
  speech: "演讲",
};

interface ArticleReadingAreaProps {
  source: ArticleSource;
  backHref?: string;
}

export function ArticleReadingArea({ source, backHref = "/" }: ArticleReadingAreaProps) {
  const router = useRouter();
  const [fontIdx, setFontIdx] = useState(getInitialFontIdx);
  const [lineIdx, setLineIdx] = useState(getInitialLineIdx);

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

  const content = useMemo(() => {
    return source.contentMd.replace(/<\/br>/gi, "<br/>");
  }, [source.contentMd]);

  const typeLabel = TYPE_LABEL[source.type] ?? source.type;
  const dateLabel = source.date
    ? source.date.slice(0, 10)
    : String(source.year);

  return (
    <>
      {/* Sticky bar */}
      <div className="letter-bar">
        <Link href={backHref} className="back-link">← 返回</Link>

        <span className="letter-bar-title" title={source.title}>
          {source.title}
        </span>

        <div className="reader-controls">
          {/* Font size */}
          <div className="reader-ctrl-group" title="字体大小">
            <button
              className="reader-ctrl-btn"
              onClick={() => changeFontIdx(fontIdx - 1)}
              disabled={fontIdx === 0}
              aria-label="缩小字体"
            >
              A<sup>−</sup>
            </button>
            <span className="reader-ctrl-val" suppressHydrationWarning>{FONT_SIZES[fontIdx]}px</span>
            <button
              className="reader-ctrl-btn"
              onClick={() => changeFontIdx(fontIdx + 1)}
              disabled={fontIdx === FONT_SIZES.length - 1}
              aria-label="放大字体"
            >
              A<sup>+</sup>
            </button>
          </div>

          <div className="reader-ctrl-sep" />

          {/* Line height */}
          <div className="reader-ctrl-group" title="行间距">
            <button
              className="reader-ctrl-btn"
              onClick={() => changeLineIdx(lineIdx - 1)}
              disabled={lineIdx === 0}
              aria-label="减小行距"
            >
              <LineHeightIcon tight />
            </button>
            <span className="reader-ctrl-val" suppressHydrationWarning>{LINE_HEIGHTS[lineIdx].toFixed(1)}</span>
            <button
              className="reader-ctrl-btn"
              onClick={() => changeLineIdx(lineIdx + 1)}
              disabled={lineIdx === LINE_HEIGHTS.length - 1}
              aria-label="增大行距"
            >
              <LineHeightIcon />
            </button>
          </div>
        </div>
      </div>

      {/* Article meta */}
      <div className="article-reader-meta">
        <span className="article-reader-type">{typeLabel}</span>
        <span className="article-reader-date">{dateLabel}</span>
      </div>

      {/* Markdown reader */}
      <div
        className="md-reader"
        style={{ fontSize: FONT_SIZES[fontIdx], lineHeight: LINE_HEIGHTS[lineIdx] }}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={markdownComponents}>
          {content}
        </ReactMarkdown>
      </div>

      {/* FAB → Text Room */}
      <button
        className="chat-fab"
        onClick={() => router.push(`/idea?source=${source.type}&year=${source.year}`)}
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
