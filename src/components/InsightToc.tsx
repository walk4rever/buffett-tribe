"use client";

import { useEffect, useRef, useState } from "react";
import type { ArticleHeading } from "@/lib/extract-headings";
import { findScrollContainer } from "@/lib/scroll-container";

const MIN_HEADINGS_TO_SHOW = 3;

function scrollHeadingIntoView(id: string) {
  const el = document.getElementById(id);
  if (!el) return;

  const marginTop = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
  const container = findScrollContainer(el);

  if (container) {
    const top =
      el.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop -
      marginTop;
    container.scrollTo({ top, behavior: "smooth" });
    return;
  }

  const scrollTop = window.scrollY + el.getBoundingClientRect().top - marginTop;
  window.scrollTo({
    top: scrollTop,
    behavior: "smooth",
  });
}

interface InsightTocProps {
  headings: ArticleHeading[];
}

export function InsightToc({ headings }: InsightTocProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: PointerEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  if (headings.length < MIN_HEADINGS_TO_SHOW) return null;

  function goTo(id: string) {
    scrollHeadingIntoView(id);
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="insight-toc">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="文章目录"
        aria-expanded={open}
        className="insight-toc-button"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 18 18"
          fill="none"
          aria-hidden="true"
        >
          <line
            x1="1"
            y1="3"
            x2="17"
            y2="3"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <line
            x1="1"
            y1="9"
            x2="13"
            y2="9"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <line
            x1="1"
            y1="15"
            x2="15"
            y2="15"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </button>

      {open && (
        <nav className="insight-toc-panel" aria-label="文章目录">
          <p className="insight-toc-title">目录</p>
          <ul className="insight-toc-list">
            {headings.map((heading) => (
              <li key={heading.id}>
                <button
                  type="button"
                  onClick={() => goTo(heading.id)}
                  className="insight-toc-item"
                  style={{
                    paddingLeft: heading.level === 3 ? "1rem" : 0,
                  }}
                >
                  {heading.text}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
