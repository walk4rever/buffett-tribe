"use client";

import { useRef, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ClipboardEvent, ComponentPropsWithoutRef } from "react";
import { TOOL_META, type ImageAttachment, type Message } from "@/hooks/useAgentChat";
import { fileToImageAttachment, isSupportedImageFile } from "@/lib/downscale-image";

function imageSrc(img: ImageAttachment): string {
  return `data:${img.mimeType};base64,${img.data}`;
}

const mdComponents = {
  a: (props: ComponentPropsWithoutRef<"a">) => {
    const href = props.href ?? "";
    const isExternal = /^https?:\/\//i.test(href);
    return (
      <a {...props} target={isExternal ? "_blank" : props.target} rel={isExternal ? "noopener noreferrer" : props.rel} />
    );
  },
  table: (props: ComponentPropsWithoutRef<"table">) => (
    <div className="msg-table-wrap">
      <table {...props} />
    </div>
  ),
};

const SUGGESTIONS = [
  "段永平为什么长期持有泡泡玛特？",
  "Meta 过去 5 年的自由现金流变化如何？",
  "伯克希尔哈撒韦最新一季持仓有什么变化？",
  "茅台的护城河体现在哪些方面？",
];

interface AgentChatProps {
  /** Conversation state and actions — owned by a `useAgentChat()` call in a parent
   *  component that stays mounted while the panel toggles open/closed, so closing
   *  the panel doesn't unmount this state and lose the visible history. */
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
  /** Set by a parent when the user selects report text and asks to discuss it — changing
   *  this object (even to an identical string) re-populates the input and focuses it. */
  pendingQuote?: { text: string } | null;
  /** Images attached to the in-progress message (pasted from clipboard), pending send. */
  pendingImages: ImageAttachment[];
  onAddImage: (image: ImageAttachment) => void;
  onRemoveImage: (index: number) => void;
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
  emptySubtitle = "以价值投资大师的视角，看穿公司的本质",
  placeholder = "问一家公司的护城河、财务表现或大师持仓… (Enter 发送，Shift+Enter 换行)",
  pendingQuote,
  pendingImages,
  onAddImage,
  onRemoveImage,
}: AgentChatProps) {
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingQuote) return;
    const quoted =
      pendingQuote.text.length > 400 ? `${pendingQuote.text.slice(0, 400)}…` : pendingQuote.text;
    setInput(`关于这段：「${quoted}」\n\n`);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [pendingQuote, setInput]);

  // Pin the list after React has painted the new content. Calling this from the
  // SSE handlers scrolled to the *previous* bottom — one render behind — and a
  // smooth scrollIntoView() restarted its animation on every delta, so the view
  // crept up a little and then stalled. `streaming` is a dependency because the
  // finished reply re-renders through ReactMarkdown, which is taller than the
  // plain text shown while it streams.
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
        // Skip files that fail to decode (e.g. corrupt clipboard data).
      }
    }
  }

  return (
    <div className="agent-chat">
      {/* Messages */}
      <div ref={scrollAreaRef} className="agent-scroll-area">
        {messages.length === 0 ? (
          <div className="empty-chat">
            <p className="empty-chat-title">{emptyTitle}</p>
            <p className="empty-chat-sub">{emptySubtitle}</p>
            <div className="starter-grid">
              {suggestions.map((q) => (
                <button key={q} className="starter-chip" onClick={() => sendMessage(q)}>
                  {q}
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
                        <span className="agent-tool-icon">{TOOL_META[tc.name]?.icon ?? "🔧"}</span>
                        <span className="agent-tool-label">{TOOL_META[tc.name]?.label ?? tc.name}</span>
                        {tc.detail && (
                          <span className="agent-tool-query">&ldquo;{tc.detail}&rdquo;</span>
                        )}
                        {tc.done && tc.count !== undefined && (
                          <span className="agent-tool-count">{tc.count} 条</span>
                        )}
                        {!tc.done && <span className="agent-tool-spinner">…</span>}
                      </div>
                    ))}
                    {msg.text ? (
                      streaming && i === messages.length - 1 ? (
                        // During streaming: plain text to avoid broken markdown
                        <p className={`msg-text${msg.error ? " agent-msg-error" : ""}`}
                           style={{ whiteSpace: "pre-wrap" }}>
                          {msg.text}
                        </p>
                      ) : (
                        <div className={`msg-text msg-markdown${msg.error ? " agent-msg-error" : ""}`}>
                          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                            {msg.text}
                          </ReactMarkdown>
                        </div>
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
            rows={2}
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
            className="chat-send-btn"
            disabled={!streaming && !input.trim() && pendingImages.length === 0}
            onClick={() => {
              if (streaming) abort();
              else sendMessage(input);
            }}
            title={streaming ? "中止" : "发送"}
          >
            {streaming ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <rect x="3" y="3" width="10" height="10" rx="1" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 2.5L13.5 8 8 13.5M2.5 8h11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none"/>
              </svg>
            )}
          </button>
        </div>
      </div>

      {lightboxSrc && (
        <div className="agent-image-lightbox" onClick={() => setLightboxSrc(null)}>
          <img src={lightboxSrc} alt="" />
        </div>
      )}
    </div>
  );
}
