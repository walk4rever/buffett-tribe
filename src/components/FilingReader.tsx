"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ExternalLink, Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { formatCompanyCikUrl, type CompanyAnnualFiling } from "@/lib/company-data";

type FilingReaderProps = {
  company: {
    name: string;
    nameZh: string | null;
    ticker: string | null;
    cik: string | null;
  };
  filing: CompanyAnnualFiling;
};

type TocItem = {
  id: string;
  level: number;
  text: string;
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

function formatFileSize(bytes: bigint | null) {
  if (bytes == null) return "—";
  const value = Number(bytes);
  if (!Number.isFinite(value)) return "—";
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

function slugifyHeading(text: string, index: number) {
  return `h-${index}-${text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}`;
}

export function FilingReader({ company, filing }: FilingReaderProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

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

  const handleFrameLoad = useCallback(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;

    const style = doc.createElement("style");
    style.textContent = "html{scroll-behavior:smooth}:target{scroll-margin-top:1.5rem}";
    doc.head?.appendChild(style);

    const allHeadings = Array.from(doc.querySelectorAll<HTMLElement>("h1,h2,h3"));
    const seen = new Set<string>();
    const items: TocItem[] = [];

    allHeadings.forEach((el, i) => {
      const text = el.textContent?.replace(/\s+/g, " ").trim() ?? "";
      if (text.length < 4 || text.length > 180) return;
      if (seen.has(text.toLowerCase())) return;
      seen.add(text.toLowerCase());
      const id = el.id || slugifyHeading(text, i);
      el.id = id;
      items.push({ id, level: parseInt(el.tagName[1], 10), text });
    });

    setToc(items);
    setFrameLoaded(true);
    if (items[0]) setActiveId(items[0].id);

    observerRef.current?.disconnect();
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((e) => e.isIntersecting);
        if (visible) setActiveId(visible.target.id);
      },
      { root: doc, rootMargin: "0px 0px -65% 0px", threshold: 0 },
    );
    allHeadings.forEach((el) => el.id && observer.observe(el));
    observerRef.current = observer;
  }, []);

  useEffect(() => {
    return () => observerRef.current?.disconnect();
  }, []);

  const scrollToHeading = useCallback((id: string) => {
    iframeRef.current?.contentDocument?.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    setActiveId(id);
  }, []);

  const supplementalFiles = [
    ...filing.attachments.map((a) => ({
      key: `att-${a.sequence}-${a.documentName}`,
      label: a.documentName || a.documentType,
      meta: [a.documentType, a.description].filter(Boolean).join(" · "),
      href: a.url,
    })),
    ...filing.artifacts
      .filter((a) => !a.kind.startsWith("section_") && a.publicUrl)
      .map((a) => ({
        key: `art-${a.objectKey}`,
        label: a.originalName ?? a.objectKey.split("/").pop() ?? a.objectKey,
        meta: [a.kind, formatFileSize(a.sizeBytes)].filter(Boolean).join(" · "),
        href: a.publicUrl!,
      })),
  ];

  return (
    <div className="filing-reader">
      <div className="filing-reader-bar">
        <div className="filing-reader-bar-left">
          <button
            type="button"
            className="filing-reader-desktop-toggle"
            onClick={() => setSidebarOpen((o) => !o)}
            aria-label={sidebarOpen ? "收起侧栏" : "展开侧栏"}
          >
            {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          </button>
          <button
            type="button"
            className="filing-reader-mobile-menu"
            onClick={() => setSidebarOpen((o) => !o)}
            aria-label={sidebarOpen ? "收起目录" : "展开目录"}
          >
            {sidebarOpen ? <PanelLeftClose size={16} /> : <Menu size={16} />}
          </button>
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

      <div
        className={`filing-reader-body${sidebarOpen ? "" : " filing-reader-body--sidebar-collapsed"}`}
      >
        <aside className="filing-reader-sidebar">
          {!frameLoaded && htmlSrc && (
            <p className="filing-reader-toc-loading">目录加载中…</p>
          )}

          {toc.length > 0 && (
            <nav className="filing-reader-toc" aria-label="目录">
              {toc.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`filing-reader-toc-item filing-reader-toc-item--h${item.level}${activeId === item.id ? " filing-reader-toc-item--active" : ""}`}
                  onClick={() => scrollToHeading(item.id)}
                  title={item.text}
                >
                  {item.text}
                </button>
              ))}
            </nav>
          )}

          {supplementalFiles.length > 0 && (
            <div className="filing-reader-sidebar-attachments">
              <p className="filing-reader-sidebar-attachments-label">附件 & 文件</p>
              {supplementalFiles.map((f) => (
                <a
                  key={f.key}
                  href={f.href}
                  target="_blank"
                  rel="noreferrer"
                  className="filing-reader-sidebar-attachment-link"
                  title={f.meta}
                >
                  {f.label}
                </a>
              ))}
            </div>
          )}
        </aside>

        <main className="filing-reader-main filing-reader-main--frame">
          {htmlSrc ? (
            <iframe
              ref={iframeRef}
              src={htmlSrc}
              title={`${formatFilingKindLabel(filing.kind)} ${reportLabel}`}
              className="filing-reader-frame"
              onLoad={handleFrameLoad}
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
      </div>
    </div>
  );
}
