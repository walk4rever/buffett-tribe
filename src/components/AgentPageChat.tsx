"use client";

import { useState, useEffect } from "react";
import {
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";
import { AgentChat } from "@/components/AgentChat";
import { WorkspaceSidebar } from "@/components/agent-workspace/WorkspaceSidebar";
import { NoteEditor } from "@/components/agent-workspace/NoteEditor";
import { useAgentChat, type Message } from "@/hooks/useAgentChat";
import { useNotes } from "@/hooks/useNotes";

interface AgentPageChatProps {
  initialMessages?: Message[];
}

export function AgentPageChat({ initialMessages }: AgentPageChatProps) {
  const { messages, input, setInput, streaming, sendMessage, abort, pendingImages, addImage, removeImage } =
    useAgentChat({ initialMessages });

  const { notes, activeNote, draft, openNote, closeEditor, createNote, updateDraft, deleteNote, saveAsNote } =
    useNotes();

  const [leftOpen, setLeftOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(true);

  useEffect(() => {
    const handleResize = () => {
      const desktop = window.innerWidth >= 1280;
      setIsDesktop(desktop);
      if (desktop) {
        setLeftOpen(true);
      } else {
        setLeftOpen(false);
      }
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <div className="agent-workspace">
      {/* Main Workspace Body */}
      <div className="agent-workspace-body">
        {/* Mobile/Tablet Backdrop when drawer is open */}
        {!isDesktop && leftOpen && (
          <div
            className="agent-drawer-backdrop"
            onClick={() => {
              setLeftOpen(false);
            }}
          />
        )}

        {/* Left Sidebar (Research Materials, Portfolio & Watchlist) */}
        <aside
          className={`agent-workspace-sidebar agent-workspace-sidebar-left ${
            leftOpen ? "is-open" : "is-closed"
          }`}
        >
          <div className="agent-sidebar-header agent-sidebar-header--nav">
            <button
              type="button"
              className="agent-sidebar-toggle-btn"
              onClick={() => setLeftOpen(false)}
              title="收起侧边栏"
            >
              <PanelLeftClose size={16} />
            </button>
            <span className="agent-sidebar-title">工作区</span>
          </div>
          <div className="agent-sidebar-content">
            <WorkspaceSidebar
              notes={notes}
              activeNoteId={activeNote?.id ?? null}
              onOpenNote={(id) => {
                openNote(id);
                if (!isDesktop) setLeftOpen(false);
              }}
              onCreateNote={() => {
                void createNote();
                if (!isDesktop) setLeftOpen(false);
              }}
            />
          </div>
        </aside>

        {/* Center Main Stage (Note Editor + Chat Pane) */}
        <div className="agent-workspace-main">
          {/* Floating Expand Toggle Button when Sidebar is Closed */}
          <div className="agent-pane-floating-bars">
            {!leftOpen && (
              <button
                type="button"
                className="agent-pane-toggle agent-pane-toggle--left"
                onClick={() => setLeftOpen(true)}
                title="展开工作区"
              >
                <PanelLeft size={15} />
                <span>工作区</span>
              </button>
            )}
          </div>

          {/* Side-by-side Note Editor Pane */}
          {activeNote && draft && (
            <div className="agent-workspace-note-pane">
              <NoteEditor
                key={activeNote.id}
                title={draft.title}
                content={draft.content}
                onChangeTitle={(title) => updateDraft({ title })}
                onChangeContent={(content) => updateDraft({ content })}
                onClose={closeEditor}
                onDelete={() => void deleteNote(activeNote.id)}
              />
            </div>
          )}

          {/* Agent Chat Pane - Always Mounted */}
          <div className="agent-workspace-chat-pane">
            <AgentChat
              messages={messages}
              input={input}
              setInput={setInput}
              streaming={streaming}
              sendMessage={sendMessage}
              abort={abort}
              pendingImages={pendingImages}
              onAddImage={addImage}
              onRemoveImage={removeImage}
              onSaveAsNote={(text) => {
                void saveAsNote(text);
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

