import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { homedir } from "os";
import { searchWisdomTool } from "./tools/search-wisdom.js";
import { createSearchHoldingsTool } from "./tools/search-holdings.js";
import { searchFilingsTool } from "./tools/search-filings.js";
import { getInsightContentTool } from "./tools/get-insight-content.js";
import { getCompanyAnalysisTool } from "./tools/get-company-analysis.js";
import type { HistoryTurn } from "./history.js";

const GATEWAY_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

// PI_AGENT_DIR: points to a directory containing models.json (and optionally auth.json).
// Local dev default: ~/.pi/agent (reuses existing pi CLI config).
// Production: set to ~/pi-gateway/.pi-agent after filling in real API keys.
const PI_AGENT_DIR = process.env.PI_AGENT_DIR ?? join(homedir(), ".pi", "agent");

export interface SessionContext {
  masterId?: string;
  masterName?: string;
  companyName?: string;
  ticker?: string;
  periodYear?: number;
  insightSlug?: string;
  insightTitle?: string;
}

export interface SessionResult {
  session: AgentSession;
  /** True when this session was just created (no prior turns) — used to decide whether to seed context. */
  isNew: boolean;
}

// Session key: userId alone, or userId scoped to a master/company context so
// switching investor or filing-reader pages starts a fresh conversation
// instead of bleeding context across masters or companies.
function sessionKey(userId: string | undefined, context?: SessionContext): string | undefined {
  if (!userId) return undefined;
  if (context?.masterId) return `${userId}:${context.masterId}`;
  if (context?.companyName) return `${userId}:${context.ticker ?? context.companyName}`;
  if (context?.insightSlug) return `${userId}:insight:${context.insightSlug}`;
  return userId;
}

// session key → session. Anonymous sessions are not cached (key = undefined).
const sessions = new Map<string, AgentSession>();

// TTL: evict idle sessions after 30 minutes
const SESSION_TTL_MS = 30 * 60 * 1000;
const lastUsed = new Map<string, number>();

function evictStaleSessions() {
  const now = Date.now();
  for (const [userId, ts] of lastUsed) {
    if (now - ts > SESSION_TTL_MS) {
      sessions.get(userId)?.dispose();
      sessions.delete(userId);
      lastUsed.delete(userId);
    }
  }
}

setInterval(evictStaleSessions, 5 * 60 * 1000).unref();

// SessionManager.appendMessage()'s parameter type (Message | CustomMessage | BashExecutionMessage)
// isn't re-exported from the package's public entry point — derive it structurally instead of
// deep-importing from a nested transitive dependency path that could shift on any reinstall.
type SessionMessage = Parameters<SessionManager["appendMessage"]>[0];

// Converts a persisted history turn into a raw session message entry. Text-only:
// historical images are not re-fetched and re-injected as bytes here — the risk/cost
// (re-downloading + base64 re-encoding on every cold resume, plus needing to keep the
// session on a vision-capable model just to replay old turns) isn't worth it when the
// assistant's own prior text reply already carries forward what mattered about the image
// in words. An image-only turn with no text becomes a short placeholder so the model at
// least knows something visual was shared, instead of that turn silently vanishing.
function historyTurnToMessage(turn: HistoryTurn): SessionMessage | null {
  const text = turn.text.trim() || (turn.hadImages ? "[用户发送了一张图片]" : "");
  if (!text) return null;

  if (turn.role === "user") {
    return { role: "user", content: text, timestamp: Date.now() };
  }

  // AssistantMessage requires api/provider/model/usage/stopReason — these are only read
  // for informational display (buildSessionContext's tracked "current model"), never fed
  // back into the actual live LLM request, so plausible placeholders are safe here.
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-completions",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

async function makeSession(history?: HistoryTurn[]): Promise<AgentSession> {
  const searchHoldingsTool = await createSearchHoldingsTool();
  const sessionManager = SessionManager.inMemory();
  for (const turn of history ?? []) {
    const message = historyTurnToMessage(turn);
    if (message) sessionManager.appendMessage(message);
  }
  const { session } = await createAgentSession({
    cwd: GATEWAY_DIR,         // loads AGENTS.md from gateway root
    agentDir: PI_AGENT_DIR,   // loads models.json (custom providers) from here
    sessionManager,
    noTools: "builtin",       // disable bash/read/write/edit for security
    customTools: [searchWisdomTool, searchHoldingsTool, searchFilingsTool, getInsightContentTool, getCompanyAnalysisTool],
  });
  return session;
}

export async function getSession(userId: string | undefined, context?: SessionContext, history?: HistoryTurn[]): Promise<SessionResult> {
  const key = sessionKey(userId, context);

  // Anonymous: always a fresh in-memory session
  if (!key) return { session: await makeSession(), isNew: true };

  const existing = sessions.get(key);
  if (existing) {
    lastUsed.set(key, Date.now());
    return { session: existing, isNew: false };
  }

  // Cold start (new tab, TTL eviction, or gateway restart) — replay persisted
  // history into the fresh session so the model isn't amnesiac relative to what
  // the UI shows from ChatTurn. No-op when there's no prior history.
  const session = await makeSession(history);
  sessions.set(key, session);
  lastUsed.set(key, Date.now());
  return { session, isNew: true };
}
