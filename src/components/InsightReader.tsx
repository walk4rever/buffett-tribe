"use client";

import { useMemo, type ComponentPropsWithoutRef } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import type { ReactNode } from "react";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { markdownToHtmlMarkdown, rehypeInsightCallouts, type InsightFormat } from "@/lib/insights";

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
    const normalized = content.replace(/<\/br>/gi, "<br/>");
    return format === "markdown" ? markdownToHtmlMarkdown(normalized) : normalized;
  }, [content, format]);

  return (
    <>
      <div className="insight-reader-bar">
        <Link href={backHref} className="insight-reader-back">← 洞见</Link>
        <span className="insight-reader-bar-title" title={title}>{title}</span>
        {actions ? <div className="insight-reader-bar-actions">{actions}</div> : null}
      </div>

      <article className="insight-reader-body">
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
