"use client";

import { useEffect, useRef, useState } from "react";

export interface ToolCall {
  id: string;
  name: string;
  detail?: string;
  count?: number;
  done: boolean;
}

export interface Message {
  role: "user" | "assistant";
  text: string;
  toolCalls?: ToolCall[];
  error?: boolean;
}

export const TOOL_META: Record<string, { icon: string; label: string }> = {
  search_wisdom:   { icon: "🧠", label: "查询资料库" },
  search_holdings: { icon: "📊", label: "查询持仓明细" },
  search_filings:  { icon: "📄", label: "查询公司年报" },
  get_company_analysis: { icon: "🔍", label: "查询公司分析" },
  get_insight_content:  { icon: "📰", label: "查询洞见全文" },
};

function resolveToolDetail(name: string, args: Record<string, unknown> | undefined): string | undefined {
  if (!args) return undefined;
  const str = (k: string) => typeof args[k] === "string" ? args[k] as string : undefined;
  const num = (k: string) => typeof args[k] === "number" ? args[k] as number : undefined;

  if (name === "search_wisdom") {
    return str("query");
  }
  if (name === "search_holdings") {
    const parts = [str("master"), str("company"), num("year") && num("quarter") ? `Q${num("quarter")} ${num("year")}` : num("year") ? String(num("year")) : undefined].filter(Boolean);
    return parts.join(" · ") || undefined;
  }
  if (name === "search_filings") {
    const parts = [str("company"), str("section"), num("year") ? String(num("year")) : undefined, str("keyword") ? `"${str("keyword")}"` : undefined].filter(Boolean);
    return parts.join(" · ") || undefined;
  }
  if (name === "get_company_analysis") {
    const parts = [str("company"), str("artifactType")].filter(Boolean);
    return parts.join(" · ") || undefined;
  }
  if (name === "get_insight_content") {
    return str("slug");
  }
  return str("query");
}

export type AgentContext =
  | { masterId: string; masterName: string }
  | { companyName: string; ticker?: string; periodYear?: number }
  | { insightSlug: string; insightTitle: string };

interface UseAgentChatOptions {
  /** Scopes the conversation to a specific investor or filing page — the server keys
   *  the session per (userId, context) and seeds a one-time context note on the first turn. */
  context?: AgentContext;
}

// Call this in whatever component owns the panel's open/closed state and stays
// mounted across toggles (a dialog wrapper, a chat shell) — not inside the panel
// markup that gets conditionally rendered, or closing the panel unmounts this
// hook's state and the conversation history is lost even though the server-side
// session (keyed by the same sessionStorage id + context) is still alive.
export function useAgentChat({ context }: UseAgentChatOptions = {}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef<string>("");

  useEffect(() => {
    const key = "bt_agent_session_id";
    let id = sessionStorage.getItem(key);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(key, id);
    }
    sessionIdRef.current = id;
  }, []);

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
        body: JSON.stringify({ message: text, userId: sessionIdRef.current, context }),
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
            } else if (eventType === "tool_start") {
              const id = typeof data.id === "string" ? data.id : String(Date.now());
              const name = typeof data.name === "string" ? data.name : "tool";
              const args = data.args as Record<string, unknown> | undefined;
              const detail = resolveToolDetail(name, args);
              const toolCall: ToolCall = { id, name, detail, done: false };
              setMessages((prev) =>
                prev.map((m, i) =>
                  i === assistantIndex ? { ...m, toolCalls: [...(m.toolCalls ?? []), toolCall] } : m,
                ),
              );
            } else if (eventType === "tool_end") {
              const id = typeof data.id === "string" ? data.id : "";
              const details = data.details as { count?: number } | null;
              const count = details?.count;
              setMessages((prev) =>
                prev.map((m, i) =>
                  i === assistantIndex
                    ? {
                        ...m,
                        toolCalls: (m.toolCalls ?? []).map((tc) =>
                          tc.id === id ? { ...tc, done: true, count } : tc,
                        ),
                      }
                    : m,
                ),
              );
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

  function abort() {
    abortRef.current?.abort();
  }

  return { messages, input, setInput, streaming, sendMessage, abort };
}
