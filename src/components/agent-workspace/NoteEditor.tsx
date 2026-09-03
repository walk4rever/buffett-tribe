"use client";

import { useRef, useState } from "react";
import type { ClipboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Eye, Edit3, Trash2, X, Check } from "lucide-react";
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
        // Skip files that fail to decode/upload
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
        {/* Row 1: Note Action Bar */}
        <div className="agent-note-top-bar">
          <div className="agent-note-top-left">
            <span className="agent-note-autosave-tag" title="更改自动保存至数据库">
              <Check size={11} />
              <span>已自动保存</span>
            </span>
          </div>

          <div className="agent-note-actions">
            {/* View Mode Segmented Control */}
            <div className="agent-note-mode-toggle">
              <button
                type="button"
                className={`agent-note-mode-btn ${mode === "edit" ? "is-active" : ""}`}
                onClick={() => setMode("edit")}
                title="编辑模式"
              >
                <Edit3 size={13} />
                <span>编辑</span>
              </button>
              <button
                type="button"
                className={`agent-note-mode-btn ${mode === "preview" ? "is-active" : ""}`}
                onClick={() => setMode("preview")}
                title="预览模式"
              >
                <Eye size={13} />
                <span>预览</span>
              </button>
            </div>

            <CopyMarkdownButton text={content} />

            <button
              type="button"
              className="msg-copy-btn agent-note-delete-btn"
              title="删除笔记"
              onClick={() => {
                if (confirm("确定删除这条笔记？")) onDelete();
              }}
            >
              <Trash2 size={13} />
            </button>

            <button
              type="button"
              className="msg-copy-btn agent-note-close-btn"
              title="关闭笔记"
              onClick={onClose}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Row 2: Full-width Title Input */}
        <div className="agent-note-title-row">
          <input
            className="agent-note-title-input"
            value={title}
            onChange={(e) => onChangeTitle(e.target.value)}
            placeholder="无标题投资笔记…"
          />
        </div>

        {/* Note Body */}
        <div className="agent-note-body">
          {mode === "edit" ? (
            <textarea
              ref={textareaRef}
              className="agent-note-textarea"
              value={content}
              onChange={(e) => onChangeContent(e.target.value)}
              onPaste={handlePaste}
              placeholder="记录你的投资逻辑、商业模式分析或大师观点引用…\n支持 Markdown，可直接粘贴图片或截图"
              autoFocus
            />
          ) : (
            <div className="agent-note-preview msg-markdown">
              {content.trim() ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                  {content}
                </ReactMarkdown>
              ) : (
                <div className="agent-note-empty-preview">
                  <p>笔记暂无内容，切换到编辑模式输入你的投研笔记。</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

