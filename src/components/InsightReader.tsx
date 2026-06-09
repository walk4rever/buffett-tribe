"use client";

import { useMemo, useState, type ComponentPropsWithoutRef } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { markdownToHtmlMarkdown, rehypeInsightCallouts, type InsightFormat } from "@/lib/insights";

const FONT_SIZES = [15, 16, 17, 18, 20];
const LINE_HEIGHTS = [1.65, 1.8, 2.0, 2.2];

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
}

export function InsightReader({ title, content, format, backHref = "/insights" }: InsightReaderProps) {
  const [fontIdx, setFontIdx] = useState(1);
  const [lineIdx, setLineIdx] = useState(1);
  const renderedContent = useMemo(() => {
    const normalized = content.replace(/<\/br>/gi, "<br/>");
    return format === "markdown" ? markdownToHtmlMarkdown(normalized) : normalized;
  }, [content, format]);

  return (
    <>
      <div className="insight-reader-bar">
        <Link href={backHref} className="insight-reader-back">← 洞见</Link>
        <span className="insight-reader-bar-title" title={title}>{title}</span>
        <div className="insight-reader-controls">
          <button
            type="button"
            className="insight-reader-ctrl"
            onClick={() => setFontIdx((v) => Math.max(0, v - 1))}
            disabled={fontIdx === 0}
            aria-label="缩小字体"
          >
            A-
          </button>
          <button
            type="button"
            className="insight-reader-ctrl"
            onClick={() => setFontIdx((v) => Math.min(FONT_SIZES.length - 1, v + 1))}
            disabled={fontIdx === FONT_SIZES.length - 1}
            aria-label="放大字体"
          >
            A+
          </button>
          <button
            type="button"
            className="insight-reader-ctrl"
            onClick={() => setLineIdx((v) => (v + 1) % LINE_HEIGHTS.length)}
            aria-label="调整行距"
          >
            行距
          </button>
        </div>
      </div>

      <article
        className="insight-reader-body"
        style={{ fontSize: FONT_SIZES[fontIdx], lineHeight: LINE_HEIGHTS[lineIdx] }}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[
            rehypeRaw,
            [rehypeSanitize, sanitizeSchema],
            rehypeInsightCallouts,
          ]}
          components={markdownComponents}
        >
          {renderedContent}
        </ReactMarkdown>
      </article>
    </>
  );
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
