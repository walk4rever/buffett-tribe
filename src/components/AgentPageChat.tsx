"use client";

import { useState, useEffect } from "react";
import {
  PanelLeftClose,
  PanelLeft,
  PanelRightClose,
  PanelRight,
} from "lucide-react";
import { AgentChat } from "@/components/AgentChat";
import { WorkspaceSidebar } from "@/components/agent-workspace/WorkspaceSidebar";
import { NoteEditor } from "@/components/agent-workspace/NoteEditor";
import { RightWorkspaceSidebar } from "@/components/agent-workspace/RightWorkspaceSidebar";
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
  const [rightOpen, setRightOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(true);

  useEffect(() => {
    const handleResize = () => {
      const desktop = window.innerWidth >= 1280;
      setIsDesktop(desktop);
      if (desktop) {
        setLeftOpen(true);
        setRightOpen(true);
      } else {
        setLeftOpen(false);
        setRightOpen(false);
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
        {!isDesktop && (leftOpen || rightOpen) && (
          <div
            className="agent-drawer-backdrop"
            onClick={() => {
              setLeftOpen(false);
              setRightOpen(false);
            }}
          />
        )}

        {/* Left Sidebar (Research Materials) */}
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
              title="收起资料"
            >
              <PanelLeftClose size={16} />
            </button>
            <span className="agent-sidebar-title">资料</span>
          </div>
          <div className="agent-sidebar-content">
            <WorkspaceSidebar
              notes={notes}
              activeNoteId={activeNote?.id ?? null}
              onOpenNote={(id) => {
                openNote(id);
                setRightOpen(false);
                if (!isDesktop) setLeftOpen(false);
              }}
              onCreateNote={() => {
                void createNote();
                setRightOpen(false);
                if (!isDesktop) setLeftOpen(false);
              }}
            />
          </div>
        </aside>

        {/* Center Main Stage (Note Editor on Left + Chat Pane on Right) */}
        <div className="agent-workspace-main">
          {/* Floating Expand Toggle Buttons when Sidebars are Closed */}
          <div className="agent-pane-floating-bars">
            {!leftOpen && (
              <button
                type="button"
                className="agent-pane-toggle agent-pane-toggle--left"
                onClick={() => setLeftOpen(true)}
                title="展开资料"
              >
                <PanelLeft size={15} />
                <span>资料</span>
              </button>
            )}

            {!rightOpen && (
              <button
                type="button"
                className="agent-pane-toggle agent-pane-toggle--right"
                onClick={() => setRightOpen(true)}
                title="展开组合"
              >
                <span>组合</span>
                <PanelRight size={15} />
              </button>
            )}
          </div>

          {/* Side-by-side Note Editor Pane (Positioned between Left Materials and Center Chat) */}
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
                setRightOpen(false);
              }}
            />
          </div>
        </div>

        {/* Right Sidebar (Investment Portfolio) */}
        <aside
          className={`agent-workspace-sidebar agent-workspace-sidebar-right ${
            rightOpen ? "is-open" : "is-closed"
          }`}
        >
          <div className="agent-sidebar-header agent-sidebar-header--nav">
            <span className="agent-sidebar-title">组合</span>
            <button
              type="button"
              className="agent-sidebar-toggle-btn agent-sidebar-toggle-btn--right"
              onClick={() => setRightOpen(false)}
              title="收起组合"
            >
              <PanelRightClose size={16} />
            </button>
          </div>
          <div className="agent-sidebar-content">
            <RightWorkspaceSidebar />
          </div>
        </aside>
      </div>
    </div>
  );
}

