"use client";

import { useState } from "react";
import { CollapsibleSection } from "@/components/agent-workspace/CollapsibleSection";
import { NotesSidebar } from "@/components/agent-workspace/NotesSidebar";
import { WatchlistSection } from "@/components/agent-workspace/WatchlistSection";
import type { Note } from "@/hooks/useNotes";
import type { WatchlistCompanyItem } from "@/hooks/useWatchlist";

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
}: WorkspaceSidebarProps) {
  // 默认「资料」和「关注」均为折叠（null）。点击哪个打开哪个，其余自动折叠。
  const [openSection, setOpenSection] = useState<"notes" | "watchlist" | null>(null);

  const toggleNotes = () => {
    setOpenSection((prev) => (prev === "notes" ? null : "notes"));
  };

  const toggleWatchlist = () => {
    setOpenSection((prev) => (prev === "watchlist" ? null : "watchlist"));
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
        />
      </CollapsibleSection>
    </div>
  );
}
