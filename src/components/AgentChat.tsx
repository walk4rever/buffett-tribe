"use client";

import { useRef, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ClipboardEvent } from "react";
import {
  Sparkles,
  ArrowUpRight,
  Check,
  Bookmark,
  Send,
  Square,
  Search,
} from "lucide-react";
import { TOOL_META, type ImageAttachment, type Message } from "@/hooks/useAgentChat";
import { fileToImageAttachment, isSupportedImageFile } from "@/lib/downscale-image";
import { mdComponents } from "@/lib/markdown-components";
import { CopyMarkdownButton } from "@/components/CopyMarkdownButton";

function imageSrc(img: ImageAttachment): string {
  return `data:${img.mimeType};base64,${img.data}`;
}

function SaveAsNoteButton({ onClick }: { onClick: () => void }) {
  const [saved, setSaved] = useState(false);

  return (
    <button
      type="button"
      className={`msg-copy-btn ${saved ? "is-saved" : ""}`}
      title={saved ? "已存为笔记" : "存为笔记"}
      onClick={() => {
        onClick();
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      }}
    >
      {saved ? (
        <Check size={13} style={{ color: "#34c759" }} />
      ) : (
        <Bookmark size={13} />
      )}
    </button>
  );
}

const SUGGESTIONS = [
  "段永平为什么长期持有泡泡玛特？",
  "Meta 过去 5 年的自由现金流与资本开支变化如何？",
  "伯克希尔哈撒韦最新一季 13F 持仓有什么变化？",
  "贵州茅台的护城河体现在哪些财务指标上？",
];

interface AgentChatProps {
  messages: Message[];
  input: string;
  setInput: (value: string) => void;
  streaming: boolean;
  sendMessage: (text: string) => void;
  abort: () => void;
  suggestions?: string[];
  emptyTitle?: string;
  emptySubtitle?: string;
  placeholder?: string;
  pendingQuote?: { text: string } | null;
  pendingImages: ImageAttachment[];
  onAddImage: (image: ImageAttachment) => void;
  onRemoveImage: (index: number) => void;
  onSaveAsNote?: (text: string) => void;
}

export function AgentChat({
  messages,
  input,
  setInput,
  streaming,
  sendMessage,
  abort,
  suggestions = SUGGESTIONS,
  emptyTitle = "理解一家公司",
  emptySubtitle = "以价值投资大师的视角，穿透商业本质与财报真相",
  placeholder = "探讨公司商业模式、护城河、财务报表或大师持仓…",
  pendingQuote,
  pendingImages,
  onAddImage,
  onRemoveImage,
  onSaveAsNote,
}: AgentChatProps) {
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  // Auto-resize input textarea to fit multi-line content smoothly
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    const nextHeight = Math.min(Math.max(el.scrollHeight, 40), 160);
    el.style.height = `${nextHeight}px`;
  }, [input]);

  useEffect(() => {
    if (!pendingQuote) return;
    const quoted =
      pendingQuote.text.length > 400 ? `${pendingQuote.text.slice(0, 400)}…` : pendingQuote.text;
    setInput(`关于这段：「${quoted}」\n\n`);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [pendingQuote, setInput]);

  useEffect(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  async function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => !!file && isSupportedImageFile(file));

    if (files.length === 0) return;
    e.preventDefault();

    for (const file of files) {
      try {
        onAddImage(await fileToImageAttachment(file));
      } catch {
        // Skip files that fail to decode
      }
    }
  }

  return (
    <div className="agent-chat">
      {/* Messages */}
      <div ref={scrollAreaRef} className="agent-scroll-area">
        {messages.length === 0 ? (
          <div className="empty-chat">
            <div className="empty-chat-badge">
              <Sparkles size={16} />
              <span>投资大师思考模型 · 多源事实佐证</span>
            </div>
            <h2 className="empty-chat-title">{emptyTitle}</h2>
            <p className="empty-chat-sub">{emptySubtitle}</p>

            <div className="starter-grid">
              {suggestions.map((q) => (
                <button key={q} className="starter-chip" onClick={() => sendMessage(q)}>
                  <span className="starter-chip-text">{q}</span>
                  <ArrowUpRight size={14} className="starter-chip-arrow" />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="messages">
            {messages.map((msg, i) =>
              msg.role === "user" ? (
                <div key={i} className="msg msg--user">
                  <div className="msg-body">
                    {(() => {
                      const srcs = [...(msg.images ?? []).map(imageSrc), ...(msg.imageUrls ?? [])];
                      return srcs.length > 0 ? (
                        <div className="msg-images">
                          {srcs.map((src, j) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              key={j}
                              src={src}
                              alt=""
                              className="msg-image"
                              onClick={() => setLightboxSrc(src)}
                            />
                          ))}
                        </div>
                      ) : null;
                    })()}
                    {msg.text && <p className="msg-text">{msg.text}</p>}
                  </div>
                </div>
              ) : (
                <div key={i} className="msg msg--assistant">
                  <div className="msg-body">
                    {(msg.toolCalls ?? []).map((tc, j) => (
                      <div key={j} className={`agent-tool-call${tc.done ? " agent-tool-call--done" : ""}`}>
                        <span className="agent-tool-icon">
                          {TOOL_META[tc.name]?.icon ? (
                            <span>{TOOL_META[tc.name].icon}</span>
                          ) : (
                            <Search size={13} />
                          )}
                        </span>
                        <span className="agent-tool-label">{TOOL_META[tc.name]?.label ?? tc.name}</span>
                        {tc.detail && (
                          <span className="agent-tool-query">&ldquo;{tc.detail}&rdquo;</span>
                        )}
                        {tc.done && tc.count !== undefined && (
                          <span className="agent-tool-count">{tc.count} 条</span>
                        )}
                        {!tc.done && <span className="agent-tool-spinner" />}
                      </div>
                    ))}

                    {msg.text ? (
                      streaming && i === messages.length - 1 ? (
                        <p className={`msg-text${msg.error ? " agent-msg-error" : ""}`}
                           style={{ whiteSpace: "pre-wrap" }}>
                          {msg.text}
                        </p>
                      ) : (
                        <>
                          <div className={`msg-text msg-markdown${msg.error ? " agent-msg-error" : ""}`}>
                            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                              {msg.text}
                            </ReactMarkdown>
                          </div>
                          {!msg.error && (
                            <div className="msg-actions">
                              <CopyMarkdownButton text={msg.text} />
                              {onSaveAsNote && (
                                <SaveAsNoteButton onClick={() => onSaveAsNote(msg.text)} />
                              )}
                            </div>
                          )}
                        </>
                      )
                    ) : !msg.error && streaming && i === messages.length - 1 ? (
                      <p className="msg-text agent-typing">▋</p>
                    ) : null}
                  </div>
                </div>
              ),
            )}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="chat-input-wrap">
        {pendingImages.length > 0 && (
          <div className="chat-pending-images">
            {pendingImages.map((img, i) => (
              <div key={i} className="chat-pending-image">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageSrc(img)} alt="" />
                <button
                  type="button"
                  className="chat-pending-image-remove"
                  onClick={() => onRemoveImage(i)}
                  aria-label="移除图片"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="chat-input-bar">
          <textarea
            ref={inputRef}
            className="chat-input"
            placeholder={placeholder}
            rows={1}
            value={input}
            disabled={streaming}
            onChange={(e) => setInput(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                sendMessage(input);
              }
            }}
          />

          <button
            className={`chat-send-btn ${streaming ? "is-streaming" : ""}`}
            disabled={!streaming && !input.trim() && pendingImages.length === 0}
            onClick={() => {
              if (streaming) abort();
              else sendMessage(input);
            }}
            title={streaming ? "中止生成" : "发送 (Enter)"}
          >
            {streaming ? (
              <Square size={13} fill="currentColor" />
            ) : (
              <Send size={14} />
            )}
          </button>
        </div>
      </div>

      {lightboxSrc && (
        <div className="agent-image-lightbox" onClick={() => setLightboxSrc(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightboxSrc} alt="" />
        </div>
      )}
    </div>
  );
}

