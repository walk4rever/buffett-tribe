"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatCompanyCikUrl, type CompanyAnnualFiling } from "@/lib/company-data";

type FilingReaderProps = {
  company: {
    name: string;
    ticker: string | null;
    cik: string | null;
  };
  filing: CompanyAnnualFiling;
};

const SECTION_ORDER = [
  "item_1_business",
  "item_1a_risk_factors",
  "item_2_properties",
  "item_3_legal",
  "item_7_mda",
  "item_7a_market_risk",
  "item_8_notes",
];

const SECTION_LABELS: Record<string, { zh: string; en: string }> = {
  item_1_business: { zh: "业务", en: "Business" },
  item_1a_risk_factors: { zh: "风险因素", en: "Risk Factors" },
  item_2_properties: { zh: "资产", en: "Properties" },
  item_3_legal: { zh: "法律诉讼", en: "Legal Proceedings" },
  item_7_mda: { zh: "管理层讨论与分析", en: "MD&A" },
  item_7a_market_risk: { zh: "市场风险", en: "Market Risk" },
  item_8_notes: { zh: "附注", en: "Notes" },
};

function formatFilingDate(date: Date | null) {
  if (!date) return "—";
  return date.toISOString().slice(0, 10);
}

function formatFileSize(bytes: bigint | null) {
  if (bytes == null) return "—";
  const value = Number(bytes);
  if (!Number.isFinite(value)) return "—";
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

function getSectionLabel(section: string) {
  return SECTION_LABELS[section] ?? {
    zh: section.replaceAll("_", " "),
    en: section,
  };
}

function sortSections(sections: CompanyAnnualFiling["sections"]) {
  return [...sections].sort((a, b) => {
    const ai = SECTION_ORDER.indexOf(a.section);
    const bi = SECTION_ORDER.indexOf(b.section);
    if (ai === -1 && bi === -1) return a.section.localeCompare(b.section);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

function splitParagraphs(text: string) {
  return text
    .replace(/\r\n/g, "\n")
    .trim()
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
}

function isBulletLine(line: string) {
  return /^([•*-]|\d+[\.)]|\([a-z0-9]+\))\s+/i.test(line);
}

function isLikelyHeading(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.length > 120) return false;
  if (/[:。.!?]$/.test(trimmed)) return false;
  const upperRatio = trimmed.replace(/[^A-Z]/g, "").length / Math.max(trimmed.replace(/\s+/g, "").length, 1);
  return upperRatio > 0.45 || /^[A-Z][A-Za-z0-9,&()\-/' ]+$/.test(trimmed);
}

function renderStructuredSectionContent(content: string) {
  const paragraphs = splitParagraphs(content);
  if (!paragraphs.length) {
    return <p className="filing-reader-empty-paragraph">暂无正文内容。</p>;
  }

  return paragraphs.map((paragraph, index) => {
    const lines = paragraph.split("\n").map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return null;

    if (lines.length === 1 && isLikelyHeading(lines[0])) {
      return (
        <h4 key={`${index}-heading`} className="filing-reader-inline-heading">
          {lines[0]}
        </h4>
      );
    }

    if (lines.every(isBulletLine)) {
      return (
        <ul key={`${index}-list`} className="filing-reader-list">
          {lines.map((line, lineIndex) => (
            <li key={`${lineIndex}`}>
              {line.replace(/^([•*-]|\d+[\.)]|\([a-z0-9]+\))\s+/i, "")}
            </li>
          ))}
        </ul>
      );
    }

    return (
      <p key={`${index}-paragraph`} className="filing-reader-paragraph">
        {lines.map((line, lineIndex) => (
          <span key={`${lineIndex}`}>
            {line}
            {lineIndex < lines.length - 1 ? <br /> : null}
          </span>
        ))}
      </p>
    );
  });
}

export function FilingReader({ company, filing }: FilingReaderProps) {
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  const sortedSections = useMemo(() => {
    return sortSections(filing.sections);
  }, [filing]);

  const currentSection = useMemo(() => {
    if (!sortedSections.length) return null;
    if (activeSection && sortedSections.some((section) => section.section === activeSection)) {
      return activeSection;
    }
    return sortedSections[0].section;
  }, [activeSection, sortedSections]);

  useEffect(() => {
    if (!contentRef.current || !sortedSections.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        const section = visible?.target.getAttribute("data-section");
        if (section) setActiveSection(section);
      },
      {
        root: contentRef.current,
        rootMargin: "0px 0px -70% 0px",
        threshold: [0.2, 0.4, 0.6, 0.8],
      },
    );

    Object.values(sectionRefs.current).forEach((el) => {
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [sortedSections]);

  const jumpToSection = (section: string) => {
    const el = sectionRefs.current[section];
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveSection(section);
  };

  const reportLabel = `${filing.periodYear ?? "—"}${filing.periodQuarter ? ` Q${filing.periodQuarter}` : ""}`;
  const companyUrl = formatCompanyCikUrl(company.cik) ?? `/company/${company.cik ?? ""}`;
  const referencesUrl = `${companyUrl}?tab=references`;

  return (
    <div className="filing-reader">
      <aside className="filing-reader-sidebar">
        <div className="filing-reader-sidebar-head">
          <div className="filing-reader-backcrumb" aria-label="返回路径">
            <Link href={companyUrl} className="filing-reader-back">
              {company.name}
            </Link>
            <span className="filing-reader-backsep">·</span>
            <Link href={referencesUrl} className="filing-reader-back filing-reader-back--muted">
              参考资料
            </Link>
          </div>
          <div className="filing-reader-titleblock">
            <p className="filing-reader-eyebrow">Filing Reader</p>
            <h2>{company.name}</h2>
            <span>{company.ticker ?? "—"} · {company.cik ?? "—"}</span>
          </div>
        </div>

        <div className="filing-reader-nav">
          <p className="filing-reader-nav-title">主要章节</p>
          {sortedSections.map((section) => {
            const active = currentSection === section.section;
            const label = getSectionLabel(section.section);
            return (
              <button
                key={section.section}
                type="button"
                className={`filing-reader-nav-item${active ? " filing-reader-nav-item--active" : ""}`}
                onClick={() => jumpToSection(section.section)}
                title={`${label.zh} / ${label.en}`}
              >
                <span className="filing-reader-nav-zh">{label.zh}</span>
                <span className="filing-reader-nav-en">{label.en}</span>
              </button>
            );
          })}
          <p className="filing-reader-nav-note">当前页只展示已抽取的主要章节。</p>
        </div>

      </aside>

      <main className="filing-reader-main" ref={contentRef}>
        <header className="filing-reader-header">
          <div>
            <p className="filing-reader-eyebrow">Annual Report</p>
            <h1>{company.name}</h1>
            <p className="filing-reader-subtitle">
              {reportLabel} · Filed {formatFilingDate(filing.filedAt ?? filing.ts)}
              {filing.ts ? ` · Report date ${formatFilingDate(filing.ts)}` : ""}
            </p>
          </div>
        </header>

        <section className="filing-reader-summary">
          <div>
            <span>Form</span>
            <strong>{filing.kind.toUpperCase()}</strong>
          </div>
          <div>
            <span>Filed</span>
            <strong>{formatFilingDate(filing.filedAt ?? filing.ts)}</strong>
          </div>
          <div>
            <span>Report date</span>
            <strong>{formatFilingDate(filing.ts)}</strong>
          </div>
        </section>

        {sortedSections.map((section) => {
          const label = getSectionLabel(section.section);
          return (
            <article
              key={section.section}
              id={`filing-section-${section.section}`}
              className="filing-reader-section"
              data-section={section.section}
              ref={(el) => {
                sectionRefs.current[section.section] = el;
              }}
            >
              <div className="filing-reader-section-head">
                <div>
                  <p>{label.zh}</p>
                  <h3>{label.en}</h3>
                </div>
              </div>
              <div className="filing-reader-section-body">
                {renderStructuredSectionContent(section.content)}
              </div>
            </article>
          );
        })}

        <section className="filing-reader-attachments">
          <div className="filing-reader-section-head">
            <div>
              <p>附件</p>
              <h3>Attachments & Artifacts</h3>
            </div>
          </div>

          {filing.attachments.length ? (
            <div className="filing-reader-file-grid">
              {filing.attachments.map((attachment) => (
                <article key={`${attachment.sequence}-${attachment.documentName}`} className="filing-reader-file-card">
                  <span>{attachment.sequence}</span>
                  <strong>{attachment.documentType}</strong>
                  <p>{attachment.documentName}</p>
                  <small>{attachment.description}</small>
                  <a href={attachment.url} target="_blank" rel="noreferrer">
                    打开附件
                  </a>
                </article>
              ))}
            </div>
          ) : null}

          {filing.artifacts.length ? (
            <div className="filing-reader-artifact-list">
              {filing.artifacts.map((artifact) => (
                <article key={artifact.objectKey} className="filing-reader-artifact-item">
                  <div>
                    <strong>{artifact.kind}</strong>
                    <p>{artifact.originalName ?? artifact.objectKey.split("/").pop() ?? artifact.objectKey}</p>
                  </div>
                  <div className="filing-reader-artifact-meta">
                    <span>{formatFileSize(artifact.sizeBytes)}</span>
                    {artifact.publicUrl ? (
                      <a href={artifact.publicUrl} target="_blank" rel="noreferrer">
                        Open
                      </a>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
