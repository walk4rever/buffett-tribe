"use client";

import { useEffect, useMemo, useState, type ComponentPropsWithoutRef } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import type { ReactNode } from "react";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { markdownToHtmlMarkdown, rehypeInsightCallouts, rehypeInsightEmbeds, type InsightFormat } from "@/lib/insights";

const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    "article",
    "aside",
    "section",
    "figure",
    "figcaption",
    "summary",
    "details",
  ],
  attributes: {
    ...defaultSchema.attributes,
    a: [
      ...(defaultSchema.attributes?.a ?? []),
      ["href"],
      ["title"],
      ["target"],
      ["rel"],
    ],
    img: [
      ...(defaultSchema.attributes?.img ?? []),
      ["src"],
      ["alt"],
      ["title"],
      ["width"],
      ["height"],
    ],
    aside: [
      ["className"],
      ["data-callout"],
      ["data-base-callout"],
      ["style"],
    ],
    div: [["className"]],
    span: [["className"]],
    code: [...(defaultSchema.attributes?.code ?? []), ["className"]],
    pre: [...(defaultSchema.attributes?.pre ?? []), ["className"]],
  },
  protocols: {
    ...defaultSchema.protocols,
    src: ["http", "https", "data"],
  },
};

interface InsightReaderProps {
  title: string;
  content: string;
  format: InsightFormat;
  backHref?: string;
  actions?: ReactNode;
}

export function InsightReader({ title, content, format, backHref = "/insights", actions }: InsightReaderProps) {
  const renderedContent = useMemo(() => {
    const normalized = stripDuplicateTitleHeading(content.replace(/<\/br>/gi, "<br/>"), title, format);
    return format === "markdown" ? markdownToHtmlMarkdown(normalized) : normalized;
  }, [content, format, title]);

  const [titleVisible, setTitleVisible] = useState(false);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    function computeFrom(scroller: Element | null) {
      const top = scroller ? scroller.scrollTop : window.scrollY;
      const max = scroller
        ? scroller.scrollHeight - scroller.clientHeight
        : document.documentElement.scrollHeight - window.innerHeight;
      setTitleVisible(top > 180);
      setProgress(max > 0 ? Math.min(1, top / max) : 0);
    }

    // The scroll container is .site-main normally, or .insight-chat-article
    // once InsightChatShell docks the AI panel and turns the article into
    // its own scroll box (see globals.css) — that swap happens after this
    // effect's mount, so it can't be resolved once up front. `scroll`
    // doesn't bubble, but capturing-phase listeners on an ancestor (here,
    // document) still see it, so one listener covers whichever of the two
    // is actually scrolling without needing to know which is current.
    function onScroll(e: Event) {
      const target = e.target;
      if (!(target instanceof Element) || !target.matches(".site-main, .insight-chat-article")) return;
      computeFrom(target);
    }

    computeFrom(document.querySelector(".insight-chat-article") ?? document.querySelector(".site-main"));
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => document.removeEventListener("scroll", onScroll, true);
  }, []);

  return (
    <>
      <div className={`insight-reader-bar${titleVisible ? " insight-reader-bar--title-visible" : ""}`}>
        <Link href={backHref} className="insight-reader-back">← 洞见</Link>
        <span className="insight-reader-bar-title" title={title}>{title}</span>
        {actions ? <div className="insight-reader-bar-actions">{actions}</div> : null}
        <span className="insight-reader-progress" style={{ transform: `scaleX(${progress})` }} />
      </div>

      <article className="insight-reader-body">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[
            rehypeRaw,
            [rehypeSanitize, sanitizeSchema],
            rehypeInsightCallouts,
            rehypeInsightEmbeds,
          ]}
          components={markdownComponents}
        >
          {renderedContent}
        </ReactMarkdown>
      </article>
    </>
  );
}

function normalizeHeadingText(text: string): string {
  return text
    .replace(/[（【]/g, "(")
    .replace(/[）】]/g, ")")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

// 正文首个 h1 若与页面标题相同则移除，避免页头 h1 与正文 h1 重复。
function stripDuplicateTitleHeading(content: string, title: string, format: InsightFormat): string {
  const target = normalizeHeadingText(title);
  if (!target) return content;

  if (format === "markdown") {
    const match = /^\s*#\s+([^\n]+)(?:\n|$)/.exec(content);
    if (match && normalizeHeadingText(match[1]) === target) {
      return content.slice(match[0].length);
    }
    return content;
  }

  const match = /^\s*<h1[^>]*>([\s\S]*?)<\/h1>\s*/i.exec(content);
  if (match && normalizeHeadingText(match[1].replace(/<[^>]+>/g, "")) === target) {
    return content.slice(match[0].length);
  }
  return content;
}

const markdownComponents = {
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
  table: (props: ComponentPropsWithoutRef<"table">) => (
    <div className="insight-table-wrap">
      <table {...props} />
    </div>
  ),
};
