"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Share2, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { encode } from "uqr";
import { BtLogoMark } from "@/components/BtLogoMark";
import { markdownToHtmlMarkdown, rehypeInsightCallouts } from "@/lib/insights";
import { toAbsoluteSiteUrl } from "@/lib/site-url";

interface InsightOverviewShareButtonProps {
  title: string;
  source?: string | null;
  dateLabel?: string | null;
  overviewTitle: string;
  overviewMarkdown: string;
}

type CaptureStatus = "idle" | "capturing" | "done" | "error";

export function InsightOverviewShareButton({
  title,
  source,
  dateLabel,
  overviewTitle,
  overviewMarkdown,
}: InsightOverviewShareButtonProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [status, setStatus] = useState<CaptureStatus>("idle");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [overviewHtml, setOverviewHtml] = useState<string | null>(null);
  const [captureReady, setCaptureReady] = useState(false);
  const captureRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    setCaptureReady(false);
    const node = document.querySelector(".insight-reader-body aside[data-base-callout='overview']");
    setOverviewHtml(node instanceof HTMLElement ? node.outerHTML : null);
    setStatus("idle");
    setImageUrl(null);
    setCaptureReady(true);
  }, [open]);

  useEffect(() => {
    if (!open || !mounted || !captureReady || !captureRef.current) return;

    let cancelled = false;

    async function capture() {
      setStatus("capturing");
      try {
        if ("fonts" in document) {
          await document.fonts.ready;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 180));
        if (cancelled || !captureRef.current) return;

        const { default: html2canvas } = await import("html2canvas");
        const element = captureRef.current;
        const canvas = await html2canvas(element, {
          backgroundColor: "#f5f4ef",
          scale: 2,
          useCORS: true,
          allowTaint: false,
          logging: false,
          windowWidth: element.scrollWidth,
          windowHeight: element.scrollHeight,
        });

        if (cancelled) return;
        setImageUrl(canvas.toDataURL("image/png"));
        setStatus("done");
      } catch (error) {
        console.error("[insight-share] capture failed", error);
        if (!cancelled) setStatus("error");
      }
    }

    capture();
    return () => {
      cancelled = true;
    };
  }, [open, mounted, captureReady]);

  const shareUrl = mounted ? toAbsoluteSiteUrl(window.location.pathname) : toAbsoluteSiteUrl("/insights");
  const filename = useMemo(() => `${title.replace(/[^\w\u4e00-\u9fff-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "insight"}-overview.png`, [title]);
  const fallbackMarkdown = useMemo(() => `> [!Overview] ${overviewTitle}\n> ${overviewMarkdown.split(/\r?\n/).join("\n> ")}`, [overviewMarkdown, overviewTitle]);

  return (
    <>
      <button type="button" className="insight-share-trigger" onClick={() => setOpen(true)}>
        <Share2 size={15} strokeWidth={2} />
        <span>分享</span>
      </button>

      {open ? (
        <>
          {mounted ? createPortal(
            <>
              <div className="insight-share-capture-root" aria-hidden="true">
                <div ref={captureRef} className="insight-share-card">
                  <div className="insight-share-card-head">
                    <h2>{title}</h2>
                    <div className="insight-share-card-meta">
                      {source ? <span>{source}</span> : null}
                      {dateLabel ? <span>{dateLabel}</span> : null}
                    </div>
                  </div>

                  <div className="insight-share-card-body">
                    {overviewHtml ? (
                      <article
                        className="insight-reader-body insight-share-card-reader"
                        dangerouslySetInnerHTML={{ __html: overviewHtml }}
                      />
                    ) : (
                      <article className="insight-reader-body insight-share-card-reader">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeInsightCallouts]}>
                          {markdownToHtmlMarkdown(fallbackMarkdown)}
                        </ReactMarkdown>
                      </article>
                    )}
                  </div>

                  <div className="insight-share-card-foot">
                  <div className="insight-share-brand">
                    <div className="insight-share-brand-copy">
                      <div className="insight-share-brand-head">
                        <span className="insight-share-brand-mark">
                          <BtLogoMark />
                        </span>
                        <div className="insight-share-brand-head-copy">
                          <strong className="insight-share-brand-name">Buffett Tribe</strong>
                          <span className="insight-share-brand-domain">https://buffett.air7.fun</span>
                        </div>
                      </div>
                      <p className="insight-share-brand-tagline">买股票就是买公司。巴菲特部落用价值投资大师的框架帮你理解一家公司！</p>
                    </div>
                  </div>

                    <div className="insight-share-qr-block">
                      <div className="insight-share-qr-frame">
                        <QRCode url={shareUrl} size={120} />
                      </div>
                      <span>扫码阅读原文</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="share-modal-overlay insight-share-overlay" onClick={() => setOpen(false)}>
                <div className="share-modal insight-share-modal" onClick={(event) => event.stopPropagation()}>
                  <div className="share-modal-header">
                    <span>分享 Overview</span>
                    <button className="share-modal-close" onClick={() => setOpen(false)} aria-label="关闭">
                      <X size={16} strokeWidth={1.9} />
                    </button>
                  </div>

                  <div className="share-modal-body insight-share-modal-body">
                    {status !== "done" || !imageUrl ? (
                      <div className="share-modal-loading">
                        <div className="share-modal-spinner" />
                        <span>{status === "error" ? "图片生成失败" : "生成图片中…"}</span>
                      </div>
                    ) : (
                      <>
                        <div className="share-modal-image-wrap insight-share-preview-wrap">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={imageUrl} alt="Overview 分享图" className="share-modal-image insight-share-preview" />
                        </div>
                        <p className="insight-share-hint insight-share-hint--mobile">手机端 长按保存图片</p>
                        <a href={imageUrl} download={filename} className="insight-share-download insight-share-download--desktop">
                          <Download size={15} strokeWidth={2} />
                          <span>点击下载图片</span>
                        </a>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </>,
            document.body,
          ) : null}
        </>
      ) : null}
    </>
  );
}

function QRCode({ url, size }: { url: string; size: number }) {
  const result = encode(url, { ecc: "M" });
  const matrix = result.data;
  const cellSize = size / matrix.length;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: "block" }}>
      {matrix.flatMap((row, rowIndex) => row.map((cell, colIndex) => {
        if (!cell) return null;
        return (
          <rect
            key={`${rowIndex}-${colIndex}`}
            x={colIndex * cellSize}
            y={rowIndex * cellSize}
            width={cellSize}
            height={cellSize}
            fill="#161616"
          />
        );
      }))}
    </svg>
  );
}
