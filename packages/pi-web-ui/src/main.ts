const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL ?? "http://localhost:3456";
const AGENT_SECRET = import.meta.env.VITE_AGENT_SECRET ?? "";

// ── Types ─────────────────────────────────────────────────────────────────────

type Role = "user" | "assistant";

interface Message {
  role: Role;
  text: string;
  toolCalls?: string[];
  error?: boolean;
}

// ── State ─────────────────────────────────────────────────────────────────────

let messages: Message[] = [];
let isStreaming = false;
let abortController: AbortController | null = null;

// ── DOM ───────────────────────────────────────────────────────────────────────

const app = document.getElementById("app")!;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderMessages(): string {
  if (messages.length === 0) {
    return `
      <div class="empty-state">
        <div class="empty-icon">📜</div>
        <p>问我关于巴菲特致股东信的任何问题</p>
        <div class="suggestions">
          <button class="suggestion" data-q="巴菲特如何定义护城河？">巴菲特如何定义护城河？</button>
          <button class="suggestion" data-q="巴菲特最早谈到可口可乐是哪年？">最早谈到可口可乐是哪年？</button>
          <button class="suggestion" data-q="巴菲特对杠杆收购的看法是什么？">对杠杆收购的看法？</button>
        </div>
      </div>`;
  }

  return messages
    .map((msg, i) => {
      if (msg.role === "user") {
        return `<div class="msg msg-user" data-index="${i}"><span>${escapeHtml(msg.text)}</span></div>`;
      }

      const toolHtml = (msg.toolCalls ?? [])
        .map(() => `<div class="tool-call">🔍 搜索致股东信…</div>`)
        .join("");

      const textHtml = msg.text
        ? `<div class="msg-text${msg.error ? " msg-error" : ""}">${escapeHtml(msg.text)}</div>`
        : "";

      const placeholderHtml =
        !msg.text && !msg.error && isStreaming && i === messages.length - 1
          ? `<div class="msg-text typing">▋</div>`
          : "";

      return `
        <div class="msg msg-assistant" data-index="${i}">
          ${toolHtml}
          ${textHtml}
          ${placeholderHtml}
        </div>`;
    })
    .join("");
}

function render() {
  app.innerHTML = `
    <div class="layout">
      <header class="header">
        <div class="logo">Buffett Research Agent</div>
        <div class="subtitle">基于1965–2024年致股东信</div>
      </header>

      <div class="messages" id="messages">
        ${renderMessages()}
      </div>

      <div class="input-area">
        <div class="input-row">
          <textarea
            id="input"
            placeholder="问关于巴菲特投资哲学、具体公司、历年决策的问题…"
            rows="1"
            ${isStreaming ? "disabled" : ""}
          ></textarea>
          <button id="send-btn" class="send-btn" ${isStreaming ? "disabled" : ""}>
            ${isStreaming ? "⏹" : "发送"}
          </button>
        </div>
      </div>
    </div>
  `;

  bindEvents();
  scrollToBottom();
}

function scrollToBottom() {
  const el = document.getElementById("messages");
  if (el) el.scrollTop = el.scrollHeight;
}

// ── Events ────────────────────────────────────────────────────────────────────

function bindEvents() {
  const input = document.getElementById("input") as HTMLTextAreaElement;
  const sendBtn = document.getElementById("send-btn") as HTMLButtonElement;

  // Auto-resize textarea
  input?.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  });

  // Enter to send (Shift+Enter for newline)
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  sendBtn?.addEventListener("click", () => {
    if (isStreaming) {
      abortController?.abort();
    } else {
      handleSend();
    }
  });

  // Suggestion buttons
  document.querySelectorAll<HTMLButtonElement>(".suggestion").forEach((btn) => {
    btn.addEventListener("click", () => {
      const q = btn.dataset.q ?? "";
      if (q) sendMessage(q);
    });
  });
}

function handleSend() {
  const input = document.getElementById("input") as HTMLTextAreaElement;
  const text = input?.value.trim();
  if (!text || isStreaming) return;
  sendMessage(text);
}

// ── SSE chat ──────────────────────────────────────────────────────────────────

async function sendMessage(text: string) {
  messages = [...messages, { role: "user", text }];
  messages = [...messages, { role: "assistant", text: "", toolCalls: [] }];
  isStreaming = true;
  abortController = new AbortController();
  render();

  const assistantIndex = messages.length - 1;

  try {
    const res = await fetch(`${GATEWAY_URL}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Agent-Secret": AGENT_SECRET,
      },
      body: JSON.stringify({ message: text }),
      signal: abortController.signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      messages = messages.map((m, i) =>
        i === assistantIndex ? { ...m, text: err.error ?? "请求失败", error: true } : m
      );
      isStreaming = false;
      render();
      return;
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split("\n");
      sseBuffer = lines.pop() ?? "";

      let eventType = "";
      for (const line of lines) {
        if (line.startsWith("event:")) {
          eventType = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          const payload = line.slice(5).trim();
          handleSseEvent(eventType, payload, assistantIndex);
          eventType = "";
        }
      }
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      messages = messages.map((m, i) =>
        i === assistantIndex && !m.text ? { ...m, text: "已中止", error: true } : m
      );
    } else {
      messages = messages.map((m, i) =>
        i === assistantIndex
          ? { ...m, text: (err as Error).message ?? "连接失败", error: true }
          : m
      );
    }
  } finally {
    isStreaming = false;
    abortController = null;
    render();
  }
}

function handleSseEvent(event: string, payload: string, assistantIndex: number) {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(payload);
  } catch {
    return;
  }

  const msg = messages[assistantIndex];
  if (!msg) return;

  switch (event) {
    case "delta": {
      const delta = typeof data.text === "string" ? data.text : "";
      messages = messages.map((m, i) =>
        i === assistantIndex ? { ...m, text: m.text + delta } : m
      );
      // Patch DOM directly for smooth streaming instead of full re-render
      const el = document.querySelector(`[data-index="${assistantIndex}"] .msg-text`);
      const placeholder = document.querySelector(`[data-index="${assistantIndex}"] .typing`);
      if (placeholder) {
        placeholder.className = "msg-text";
        placeholder.textContent = messages[assistantIndex].text;
      } else if (el) {
        el.textContent = messages[assistantIndex].text;
      }
      scrollToBottom();
      break;
    }
    case "tool_start": {
      const name = typeof data.name === "string" ? data.name : "tool";
      messages = messages.map((m, i) =>
        i === assistantIndex ? { ...m, toolCalls: [...(m.toolCalls ?? []), name] } : m
      );
      render();
      break;
    }
    case "tool_end":
      // tool_start already shown, nothing extra needed
      break;
    case "done":
      // handled in finally
      break;
    case "error": {
      const errMsg = typeof data.message === "string" ? data.message : "未知错误";
      messages = messages.map((m, i) =>
        i === assistantIndex ? { ...m, text: errMsg, error: true } : m
      );
      break;
    }
  }
}

// ── Styles ────────────────────────────────────────────────────────────────────

const style = document.createElement("style");
style.textContent = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'Inter', system-ui, sans-serif;
    background: #0f0f0f;
    color: #e8e0d0;
    height: 100dvh;
    overflow: hidden;
  }

  .layout {
    display: flex;
    flex-direction: column;
    height: 100dvh;
    max-width: 760px;
    margin: 0 auto;
  }

  .header {
    padding: 16px 20px 12px;
    border-bottom: 1px solid #2a2a2a;
    flex-shrink: 0;
  }

  .logo {
    font-size: 15px;
    font-weight: 600;
    color: #c8a96e;
  }

  .subtitle {
    font-size: 11px;
    color: #666;
    margin-top: 2px;
  }

  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    scroll-behavior: smooth;
  }

  .messages::-webkit-scrollbar { width: 4px; }
  .messages::-webkit-scrollbar-track { background: transparent; }
  .messages::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }

  .empty-state {
    margin: auto;
    text-align: center;
    color: #555;
  }

  .empty-icon { font-size: 36px; margin-bottom: 12px; }

  .empty-state p {
    font-size: 14px;
    margin-bottom: 20px;
    color: #666;
  }

  .suggestions {
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: center;
  }

  .suggestion {
    background: #1a1a1a;
    border: 1px solid #2a2a2a;
    color: #999;
    padding: 8px 16px;
    border-radius: 8px;
    font-size: 13px;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
    font-family: inherit;
  }

  .suggestion:hover {
    border-color: #c8a96e;
    color: #c8a96e;
  }

  .msg { display: flex; flex-direction: column; gap: 6px; }

  .msg-user {
    align-items: flex-end;
  }

  .msg-user span {
    background: #1e3a2e;
    color: #a8d5b5;
    padding: 10px 14px;
    border-radius: 16px 16px 4px 16px;
    font-size: 14px;
    max-width: 80%;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .msg-assistant { align-items: flex-start; }

  .tool-call {
    font-size: 12px;
    color: #888;
    background: #1a1a1a;
    border: 1px solid #2a2a2a;
    padding: 4px 10px;
    border-radius: 6px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .msg-text {
    font-size: 14px;
    line-height: 1.65;
    color: #d4c9b8;
    max-width: 90%;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .msg-error { color: #e07070; }

  @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
  .typing { animation: blink 1s step-end infinite; color: #c8a96e; }

  .input-area {
    padding: 12px 20px 20px;
    border-top: 1px solid #1e1e1e;
    flex-shrink: 0;
  }

  .input-row {
    display: flex;
    gap: 8px;
    align-items: flex-end;
  }

  textarea {
    flex: 1;
    background: #1a1a1a;
    border: 1px solid #2a2a2a;
    border-radius: 10px;
    color: #e8e0d0;
    font-family: inherit;
    font-size: 14px;
    line-height: 1.5;
    padding: 10px 14px;
    resize: none;
    outline: none;
    transition: border-color 0.15s;
    min-height: 42px;
    max-height: 160px;
  }

  textarea:focus { border-color: #c8a96e44; }
  textarea::placeholder { color: #444; }
  textarea:disabled { opacity: 0.5; }

  .send-btn {
    background: #c8a96e;
    color: #0f0f0f;
    border: none;
    border-radius: 10px;
    padding: 0 18px;
    height: 42px;
    font-size: 13px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    white-space: nowrap;
    transition: opacity 0.15s;
    flex-shrink: 0;
  }

  .send-btn:hover { opacity: 0.85; }
  .send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
`;
document.head.appendChild(style);

// ── Init ──────────────────────────────────────────────────────────────────────

render();
