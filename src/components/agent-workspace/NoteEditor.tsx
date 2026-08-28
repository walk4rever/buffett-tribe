"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { mdComponents } from "@/lib/markdown-components";
import { CopyMarkdownButton } from "@/components/CopyMarkdownButton";

interface NoteEditorProps {
  title: string;
  content: string;
  onChangeTitle: (title: string) => void;
  onChangeContent: (content: string) => void;
  onClose: () => void;
  onDelete: () => void;
}

type ViewMode = "edit" | "preview";

function ViewModeToggle({ mode, onToggle }: { mode: ViewMode; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="msg-copy-btn"
      title={mode === "edit" ? "切换到预览" : "切换到编辑"}
      onClick={onToggle}
    >
      {mode === "edit" ? (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
          <circle cx="8" cy="8" r="1.8" stroke="currentColor" strokeWidth="1.2"/>
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M2 13.5 2.6 11l7.9-7.9a1.4 1.4 0 0 1 2 0l.4.4a1.4 1.4 0 0 1 0 2L5 13.4 2 13.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
        </svg>
      )}
    </button>
  );
}

export function NoteEditor({ title, content, onChangeTitle, onChangeContent, onClose, onDelete }: NoteEditorProps) {
  const [mode, setMode] = useState<ViewMode>("edit");

  return (
    <div className="agent-note-editor">
      <div className="agent-note-inner">
        <div className="agent-workspace-panel-head">
          <input
            className="agent-note-title-input"
            value={title}
            onChange={(e) => onChangeTitle(e.target.value)}
            placeholder="无标题笔记"
          />
          <div className="msg-actions">
            <ViewModeToggle mode={mode} onToggle={() => setMode((m) => (m === "edit" ? "preview" : "edit"))} />
            <CopyMarkdownButton text={content} />
            <button type="button" className="msg-copy-btn" title="删除" onClick={() => {
              if (confirm("删除这条笔记？")) onDelete();
            }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M3.5 4.5h9M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5M6 7.5v4M10 7.5v4M4.5 4.5l.6 8a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <button type="button" className="msg-copy-btn" title="关闭" onClick={onClose}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        </div>

        {mode === "edit" ? (
          <textarea
            className="agent-note-textarea"
            value={content}
            onChange={(e) => onChangeContent(e.target.value)}
            placeholder="写点什么…支持 Markdown"
            autoFocus
          />
        ) : (
          <div className="agent-note-preview msg-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
              {content || "*空*"}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
