"use client";

import { useEffect, useRef, useState } from "react";

export interface Note {
  id: string;
  title: string | null;
  content: string;
  entityId: string | null;
  createdAt: string;
  updatedAt: string;
}

const AUTOSAVE_DEBOUNCE_MS = 800;

// Owns the note list plus the single note currently open in the editor panel.
// Edits autosave (debounced) rather than requiring an explicit save action —
// see PRODUCT.md "/agent — 投资研究 Agent" for why (low-stakes personal content,
// manual save only adds a "forgot to click it" failure mode).
export function useNotes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ title: string; content: string } | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch("/api/notes")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { notes?: Note[] } | null) => {
        if (data?.notes) setNotes(data.notes);
      })
      .catch(() => {});
  }, []);

  const activeNote = notes.find((n) => n.id === activeNoteId) ?? null;

  function openNote(id: string) {
    flushPendingSave();
    const note = notes.find((n) => n.id === id);
    if (!note) return;
    setActiveNoteId(id);
    setDraft({ title: note.title ?? "", content: note.content });
  }

  function closeEditor() {
    flushPendingSave();
    setActiveNoteId(null);
    setDraft(null);
  }

  async function createNote(content = ""): Promise<void> {
    flushPendingSave();
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    }).catch(() => null);
    if (!res?.ok) return;
    const { note } = (await res.json()) as { note: Note };
    setNotes((prev) => [note, ...prev]);
    setActiveNoteId(note.id);
    setDraft({ title: note.title ?? "", content: note.content });
  }

  function scheduleSave(id: string, patch: { title?: string; content?: string }) {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => void persist(id, patch), AUTOSAVE_DEBOUNCE_MS);
  }

  async function persist(id: string, patch: { title?: string; content?: string }) {
    const res = await fetch(`/api/notes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => null);
    if (!res?.ok) return;
    const { note } = (await res.json()) as { note: Note };
    setNotes((prev) =>
      [note, ...prev.filter((n) => n.id !== id)].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      ),
    );
  }

  function flushPendingSave() {
    if (!saveTimerRef.current || !activeNoteId || !draft) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    void persist(activeNoteId, { title: draft.title, content: draft.content });
  }

  function updateDraft(patch: Partial<{ title: string; content: string }>) {
    if (!activeNoteId) return;
    setDraft((prev) => {
      const next = { ...(prev ?? { title: "", content: "" }), ...patch };
      // Schedule the full merged draft, not just this call's partial patch — two
      // fields edited within the same debounce window would otherwise cancel each
      // other's pending save and only the last-edited field would ever reach the DB.
      scheduleSave(activeNoteId, next);
      return next;
    });
  }

  async function deleteNote(id: string) {
    if (activeNoteId === id) closeEditor();
    setNotes((prev) => prev.filter((n) => n.id !== id));
    await fetch(`/api/notes/${id}`, { method: "DELETE" }).catch(() => {});
  }

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  return {
    notes,
    activeNote,
    draft,
    openNote,
    closeEditor,
    createNote,
    updateDraft,
    deleteNote,
    saveAsNote: createNote,
  };
}
