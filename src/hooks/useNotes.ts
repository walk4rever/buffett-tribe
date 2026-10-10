"use client";

import { useEffect, useRef, useState } from "react";
import type { NoteSaveStatus } from "@/lib/agent-workspace-ui";

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
  const [saveStatus, setSaveStatus] = useState<NoteSaveStatus>("saved");
  const draftRef = useRef<{ title: string; content: string } | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRevisionRef = useRef(0);
  const pendingSaveRef = useRef<{
    id: string;
    patch: { title: string; content: string };
    revision: number;
  } | null>(null);

  useEffect(() => {
    fetch("/api/notes", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { notes?: Note[] } | null) => {
        if (data?.notes) setNotes(data.notes);
      })
      .catch(() => {});
  }, []);

  const activeNote = notes.find((n) => n.id === activeNoteId) ?? null;

  async function openNote(id: string) {
    if (!(await flushPendingSave())) return;
    const note = notes.find((n) => n.id === id);
    if (!note) return;
    setActiveNoteId(id);
    const nextDraft = { title: note.title ?? "", content: note.content };
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    setSaveStatus("saved");
  }

  async function closeEditor() {
    if (!(await flushPendingSave())) return;
    setActiveNoteId(null);
    draftRef.current = null;
    setDraft(null);
  }

  async function createNote(content = ""): Promise<void> {
    if (!(await flushPendingSave())) return;
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    }).catch(() => null);
    if (!res?.ok) return;
    const { note } = (await res.json()) as { note: Note };
    setNotes((prev) => [note, ...prev]);
    setActiveNoteId(note.id);
    const nextDraft = { title: note.title ?? "", content: note.content };
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    setSaveStatus("saved");
  }

  function scheduleSave(id: string, patch: { title: string; content: string }) {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const save = {
      id,
      patch,
      revision: ++saveRevisionRef.current,
    };
    pendingSaveRef.current = save;
    setSaveStatus("saving");
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void persist(save);
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  async function persist(save: NonNullable<typeof pendingSaveRef.current>, keepalive = false) {
    if (save.revision === saveRevisionRef.current) setSaveStatus("saving");
    try {
      const res = await fetch(`/api/notes/${save.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(save.patch),
        keepalive,
      });
      if (!res.ok) throw new Error("Note save failed");

      const { note } = (await res.json()) as { note: Note };
      if (save.revision === saveRevisionRef.current) {
        pendingSaveRef.current = null;
        setSaveStatus("saved");
        setNotes((prev) =>
          [note, ...prev.filter((n) => n.id !== save.id)].sort(
            (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
          ),
        );
      }
      return true;
    } catch {
      if (save.revision === saveRevisionRef.current) setSaveStatus("error");
      return false;
    }
  }

  async function flushPendingSave(): Promise<boolean> {
    const save = pendingSaveRef.current;
    if (!save) return true;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    return persist(save);
  }

  function updateDraft(patch: Partial<{ title: string; content: string }>) {
    if (!activeNoteId) return;
    const next = { ...(draftRef.current ?? { title: "", content: "" }), ...patch };
    draftRef.current = next;
    setDraft(next);
    scheduleSave(activeNoteId, next);
  }

  async function deleteNote(id: string) {
    if (activeNoteId === id) {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      pendingSaveRef.current = null;
      saveRevisionRef.current += 1;
      setActiveNoteId(null);
      draftRef.current = null;
      setDraft(null);
      setSaveStatus("saved");
    }
    setNotes((prev) => prev.filter((n) => n.id !== id));
    await fetch(`/api/notes/${id}`, { method: "DELETE" }).catch(() => {});
  }

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      const save = pendingSaveRef.current;
      if (save) {
        void fetch(`/api/notes/${save.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(save.patch),
          keepalive: true,
        }).catch(() => {});
      }
    };
  }, []);

  return {
    notes,
    activeNote,
    draft,
    saveStatus,
    openNote,
    closeEditor,
    flushPendingSave,
    createNote,
    updateDraft,
    deleteNote,
    saveAsNote: createNote,
  };
}
