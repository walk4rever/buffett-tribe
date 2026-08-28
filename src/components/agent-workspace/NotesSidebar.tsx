"use client";

import type { Note } from "@/hooks/useNotes";

function summarize(content: string): string {
  const firstLine = content.split("\n").find((line) => line.trim().length > 0) ?? "";
  return firstLine.length > 40 ? `${firstLine.slice(0, 40)}…` : firstLine;
}

function formatUpdatedAt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

interface NotesSidebarProps {
  notes: Note[];
  activeNoteId: string | null;
  onOpenNote: (id: string) => void;
}

export function NotesSidebar({ notes, activeNoteId, onOpenNote }: NotesSidebarProps) {
  if (notes.length === 0) {
    return (
      <p className="agent-workspace-empty">还没有笔记，点击&ldquo;+ 新建&rdquo;开始，或在对话回复下方点&ldquo;存为笔记&rdquo;。</p>
    );
  }

  return (
    <ul className="agent-workspace-note-list">
      {notes.map((note) => (
        <li key={note.id}>
          <button
            type="button"
            className={`agent-workspace-note-item${note.id === activeNoteId ? " is-active" : ""}`}
            onClick={() => onOpenNote(note.id)}
          >
            <span className="agent-workspace-note-title">{note.title?.trim() || "无标题笔记"}</span>
            <span className="agent-workspace-note-snippet">{summarize(note.content) || "空笔记"}</span>
            <span className="agent-workspace-note-date">{formatUpdatedAt(note.updatedAt)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
