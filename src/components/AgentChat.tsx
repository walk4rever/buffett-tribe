"use client";

import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ComponentPropsWithoutRef } from "react";

const mdComponents = {
  a: (props: ComponentPropsWithoutRef<"a">) => {
    const href = props.href ?? "";
    const isExternal = /^https?:\/\//i.test(href);
    return (
      <a {...props} target={isExternal ? "_blank" : props.target} rel={isExternal ? "noopener noreferrer" : props.rel} />
    );
  },
};

interface Message {
  role: "user" | "assistant";
  text: string;
  toolCalls?: string[];
  error?: boolean;
}

const SUGGESTIONS = [
  "如何判断一家公司是否有真正的护城河？",
  "大师们如何看待管理层的诚信与能力？",
  "什么样的公司值得长期持有？",
  "怎么用价值投资框架分析一家公司？",
];

export function AgentChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  function scrollToBottom() {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  async function sendMessage(text: string) {
    if (!text.trim() || streaming) return;

    setInput("");

    const assistantIndex = messages.length + 1;
    setMessages((prev) => [
      ...prev,
      { role: "user", text },
      { role: "assistant", text: "", toolCalls: [] },
    ]);
    setStreaming(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch("/api/pi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setMessages((prev) =>
          prev.map((m, i) =>
            i === assistantIndex ? { ...m, text: err.error ?? "请求失败", error: true } : m,
          ),
        );
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = "";
      let eventType = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split("\n");
        sseBuffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("event:")) {
            eventType = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            const payload = line.slice(5).trim();
            let data: Record<string, unknown>;
            try { data = JSON.parse(payload); } catch { continue; }

            if (eventType === "delta") {
              const delta = typeof data.text === "string" ? data.text : "";
              setMessages((prev) =>
                prev.map((m, i) => i === assistantIndex ? { ...m, text: m.text + delta } : m),
              );
              scrollToBottom();
            } else if (eventType === "tool_start") {
              const name = typeof data.name === "string" ? data.name : "tool";
              setMessages((prev) =>
                prev.map((m, i) =>
                  i === assistantIndex ? { ...m, toolCalls: [...(m.toolCalls ?? []), name] } : m,
                ),
              );
              scrollToBottom();
            } else if (eventType === "error") {
              const msg = typeof data.message === "string" ? data.message : "未知错误";
              setMessages((prev) =>
                prev.map((m, i) => i === assistantIndex ? { ...m, text: msg, error: true } : m),
              );
            }
            eventType = "";
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setMessages((prev) =>
          prev.map((m, i) =>
            i === assistantIndex
              ? { ...m, text: (err as Error).message ?? "连接失败", error: true }
              : m,
          ),
        );
      } else {
        setMessages((prev) =>
          prev.map((m, i) =>
            i === assistantIndex && !m.text ? { ...m, text: "已中止", error: true } : m,
          ),
        );
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  return (
    <div className="agent-chat">
      {/* Messages */}
      <div className="agent-scroll-area">
        {messages.length === 0 ? (
          <div className="empty-chat">
            <p className="empty-chat-title">理解一家公司</p>
            <p className="empty-chat-sub">以价值投资大师的视角，看穿公司的本质</p>
            <div className="starter-grid">
              {SUGGESTIONS.map((q) => (
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
                    <p className="msg-text">{msg.text}</p>
                  </div>
                </div>
              ) : (
                <div key={i} className="msg msg--assistant">
                  <div className="msg-body">
                    {(msg.toolCalls ?? []).map((_, j) => (
                      <div key={j} className="agent-tool-call">🔍 搜索致股东信…</div>
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
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="chat-input-wrap">
        <div className="chat-input-bar">
          <textarea
            className="chat-input"
            placeholder="问关于巴菲特投资哲学、具体公司、历年决策的问题… (⌘Enter 发送)"
            rows={2}
            value={input}
            disabled={streaming}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                sendMessage(input);
              }
            }}
          />
          <button
            className="chat-send-btn"
            disabled={!streaming && !input.trim()}
            onClick={() => {
              if (streaming) abortRef.current?.abort();
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
    </div>
  );
}
