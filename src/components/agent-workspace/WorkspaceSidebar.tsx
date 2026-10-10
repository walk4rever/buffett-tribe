"use client";

import { useState } from "react";
import { CollapsibleSection } from "@/components/agent-workspace/CollapsibleSection";
import { NotesSidebar } from "@/components/agent-workspace/NotesSidebar";
import { WatchlistSection } from "@/components/agent-workspace/WatchlistSection";
import type { Note } from "@/hooks/useNotes";
import type { WatchlistCompanyItem } from "@/hooks/useWatchlist";
import type { AgentTurnPreview } from "@/lib/agent-workspace-ui";

interface WorkspaceSidebarProps {
  notes: Note[];
  activeNoteId: string | null;
  onOpenNote: (id: string) => void;
  onCreateNote: () => void;
  watchlistItems: WatchlistCompanyItem[];
  activeCompanyTicker?: string | null;
  onSelectCompany: (company: WatchlistCompanyItem) => void;
  onRemoveCompany?: (ticker: string) => void;
  watchlistLoading?: boolean;
  onWatchlistOpenChange?: (open: boolean) => void;
  latestByContextKey?: Record<string, AgentTurnPreview>;
  previewsLoading?: boolean;
  previewsError?: boolean;
}

export function WorkspaceSidebar({
  notes,
  activeNoteId,
  onOpenNote,
  onCreateNote,
  watchlistItems,
  activeCompanyTicker,
  onSelectCompany,
  onRemoveCompany,
  watchlistLoading,
  onWatchlistOpenChange,
  latestByContextKey,
  previewsLoading,
  previewsError,
}: WorkspaceSidebarProps) {
  // Keep only one workspace section open at a time.
  const [openSection, setOpenSection] = useState<"notes" | "watchlist" | null>(null);

  const toggleNotes = () => {
    const next = openSection === "notes" ? null : "notes";
    setOpenSection(next);
    onWatchlistOpenChange?.(false);
  };

  const toggleWatchlist = () => {
    const next = openSection === "watchlist" ? null : "watchlist";
    setOpenSection(next);
    onWatchlistOpenChange?.(next === "watchlist");
  };

  return (
    <div className="agent-workspace-sections">
      <CollapsibleSection
        title={`资料${notes.length > 0 ? ` (${notes.length})` : ""}`}
        isOpen={openSection === "notes"}
        onToggle={toggleNotes}
        action={
          <button
            type="button"
            className="agent-workspace-new-btn"
            onClick={(e) => {
              e.stopPropagation();
              onCreateNote();
              setOpenSection("notes");
              onWatchlistOpenChange?.(false);
            }}
            title="新建笔记"
          >
            + 新建
          </button>
        }
      >
        <NotesSidebar notes={notes} activeNoteId={activeNoteId} onOpenNote={onOpenNote} />
      </CollapsibleSection>

      <CollapsibleSection
        title={`关注${watchlistItems.length > 0 ? ` (${watchlistItems.length})` : ""}`}
        isOpen={openSection === "watchlist"}
        onToggle={toggleWatchlist}
      >
        <WatchlistSection
          items={watchlistItems}
          activeTicker={activeCompanyTicker}
          onSelectCompany={onSelectCompany}
          onRemoveCompany={onRemoveCompany}
          loading={watchlistLoading}
          latestByContextKey={latestByContextKey}
          previewsLoading={previewsLoading}
          previewsError={previewsError}
        />
      </CollapsibleSection>
    </div>
  );
}
