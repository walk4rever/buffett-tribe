"use client";

import { useState } from "react";
import type { ReactNode } from "react";

interface CollapsibleSectionProps {
  title: string;
  defaultOpen?: boolean;
  isOpen?: boolean;
  onToggle?: () => void;
  /** "right" mirrors the header for the right-side workspace panel — chevron + title
   *  hug the panel's outer (right) edge instead of the inner one, so it reads as a
   *  mirror image of the left sidebar's sections rather than the same layout floating
   *  on the wrong side. */
  align?: "left" | "right";
  /** Rendered on the right of the header, next to the chevron — e.g. a "+ 新建" button.
   *  Clicks on it don't toggle the section (stopPropagation). */
  action?: ReactNode;
  children: ReactNode;
}

export function CollapsibleSection({
  title,
  defaultOpen = false,
  isOpen,
  onToggle,
  align = "left",
  action,
  children,
}: CollapsibleSectionProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = isOpen !== undefined ? isOpen : internalOpen;
  const isRight = align === "right";

  const handleToggle = () => {
    if (onToggle) {
      onToggle();
    } else {
      setInternalOpen((o) => !o);
    }
  };

  return (
    <div className="agent-workspace-section">
      <div className={`agent-workspace-section-head${isRight ? " agent-workspace-section-head--right" : ""}`}>
        <button
          type="button"
          className={`agent-workspace-section-toggle${isRight ? " agent-workspace-section-toggle--right" : ""}`}
          onClick={handleToggle}
          aria-expanded={open}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 16 16"
            fill="none"
            className={`agent-workspace-section-chevron${open ? " is-open" : ""}`}
          >
            <path d="M4 2.5 10 8l-6 5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="agent-workspace-section-title">{title}</span>
        </button>
        {action && (
          <div className="agent-workspace-section-action" onClick={(e) => e.stopPropagation()}>
            {action}
          </div>
        )}
      </div>

      {open && <div className="agent-workspace-section-body">{children}</div>}
    </div>
  );
}
