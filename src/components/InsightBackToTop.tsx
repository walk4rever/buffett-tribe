"use client";

import { useEffect, useState } from "react";
import { findScrollContainer } from "@/lib/scroll-container";

const SHOW_AFTER_PX = 600;

export function InsightBackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function handleScroll(e: Event) {
      const target = e.target;
      if (
        !(target instanceof Element) ||
        !target.matches(".site-main, .insight-chat-article")
      ) {
        return;
      }
      const top =
        target === document.documentElement
          ? window.scrollY
          : (target as HTMLElement).scrollTop;
      setVisible(top > SHOW_AFTER_PX);
    }

    document.addEventListener("scroll", handleScroll, {
      capture: true,
      passive: true,
    });
    return () => document.removeEventListener("scroll", handleScroll, true);
  }, []);

  if (!visible) return null;

  function scrollToTop() {
    const container = findScrollContainer(
      document.querySelector(".insight-reader-body")
    );
    if (container) {
      container.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <button
      type="button"
      onClick={scrollToTop}
      aria-label="回到顶部"
      className="insight-back-to-top"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 18 18"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M9 15V3M9 3L4 8M9 3L14 8"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
