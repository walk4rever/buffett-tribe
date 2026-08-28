"use client";

import { CollapsibleSection } from "@/components/agent-workspace/CollapsibleSection";
import { NotesSidebar } from "@/components/agent-workspace/NotesSidebar";
import { RepositorySection } from "@/components/agent-workspace/RepositorySection";
import type { Note } from "@/hooks/useNotes";

interface WorkspaceSidebarProps {
  notes: Note[];
  activeNoteId: string | null;
  onOpenNote: (id: string) => void;
  onCreateNote: () => void;
}

export function WorkspaceSidebar({ notes, activeNoteId, onOpenNote, onCreateNote }: WorkspaceSidebarProps) {
  return (
    <div className="agent-workspace-sections">
      <CollapsibleSection
        title="投研笔记"
        defaultOpen
        action={
          <button type="button" className="agent-workspace-new-btn" onClick={onCreateNote} title="新建笔记">
            + 新建
          </button>
        }
      >
        <NotesSidebar notes={notes} activeNoteId={activeNoteId} onOpenNote={onOpenNote} />
      </CollapsibleSection>

      <CollapsibleSection title="资料库">
        <RepositorySection />
      </CollapsibleSection>
    </div>
  );
}
