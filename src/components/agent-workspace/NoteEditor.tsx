"use client";

import { useRef, useState } from "react";
import type { ClipboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { mdComponents } from "@/lib/markdown-components";
import { CopyMarkdownButton } from "@/components/CopyMarkdownButton";
import { fileToImageAttachment, isSupportedImageFile } from "@/lib/downscale-image";
import type { ImageAttachment } from "@/lib/image-attachment";

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

async function uploadNoteImage(attachment: ImageAttachment): Promise<string | null> {
  const res = await fetch("/api/notes/images", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: attachment }),
  }).catch(() => null);
  if (!res?.ok) return null;
  const { url } = (await res.json()) as { url: string };
  return url;
}

export function NoteEditor({ title, content, onChangeTitle, onChangeContent, onClose, onDelete }: NoteEditorProps) {
  const [mode, setMode] = useState<ViewMode>("preview");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Pastes an image straight into R2 (same pipeline as chat: downscaled client-side,
  // see src/lib/downscale-image.ts) and inserts a markdown image link at the cursor —
  // notes have no separate "pending attachment" concept like chat messages, so the
  // link goes straight into the content string that already autosaves.
  async function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => !!file && isSupportedImageFile(file));
    if (files.length === 0) return;
    e.preventDefault();

    const el = textareaRef.current;
    let insertPos = el?.selectionStart ?? content.length;
    let working = content;

    for (const file of files) {
      try {
        const attachment = await fileToImageAttachment(file);
        const url = await uploadNoteImage(attachment);
        if (!url) continue;
        const insertion = `![](${url})\n`;
        working = working.slice(0, insertPos) + insertion + working.slice(insertPos);
        insertPos += insertion.length;
        onChangeContent(working);
      } catch {
        // Skip files that fail to decode/upload.
      }
    }

    requestAnimationFrame(() => {
      el?.focus();
      if (el) el.selectionStart = el.selectionEnd = insertPos;
    });
  }

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
            ref={textareaRef}
            className="agent-note-textarea"
            value={content}
            onChange={(e) => onChangeContent(e.target.value)}
            onPaste={handlePaste}
            placeholder="写点什么…支持 Markdown，可直接粘贴图片"
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
