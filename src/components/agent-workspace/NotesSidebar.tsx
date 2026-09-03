"use client";

import { FileText } from "lucide-react";
import type { Note } from "@/hooks/useNotes";

function stripImages(line: string): string {
  return line.replace(/!\[[^\]]*\]\([^)]*\)/g, "").trim();
}

function summarize(content: string): string {
  const firstLine = content.split("\n").map(stripImages).find((line) => line.length > 0) ?? "";
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
      <div className="agent-workspace-empty-card">
        <FileText size={24} className="agent-workspace-empty-icon" />
        <p className="agent-workspace-empty-text">
          暂无投研笔记。可点击上方「+ 新建」或在 AI 对话回复底部点击「存为笔记」随时沉淀。
        </p>
      </div>
    );
  }

  return (
    <ul className="agent-workspace-note-list">
      {notes.map((note) => (
        <li key={note.id}>
          <button
            type="button"
            className={`agent-workspace-note-item ${note.id === activeNoteId ? "is-active" : ""}`}
            onClick={() => onOpenNote(note.id)}
          >
            <div className="agent-workspace-note-head">
              <span className="agent-workspace-note-title">
                {note.title?.trim() || "无标题笔记"}
              </span>
              <span className="agent-workspace-note-date">
                {formatUpdatedAt(note.updatedAt)}
              </span>
            </div>
            <span className="agent-workspace-note-snippet">
              {summarize(note.content) || "暂无内容"}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

