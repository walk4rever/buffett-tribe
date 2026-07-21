import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { homedir } from "os";
import { searchWisdomTool } from "./tools/search-wisdom.js";
import { searchHoldingsTool } from "./tools/search-holdings.js";
import { searchFilingsTool } from "./tools/search-filings.js";

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

async function makeSession(): Promise<AgentSession> {
  const { session } = await createAgentSession({
    cwd: GATEWAY_DIR,         // loads AGENTS.md from gateway root
    agentDir: PI_AGENT_DIR,   // loads models.json (custom providers) from here
    sessionManager: SessionManager.inMemory(),
    noTools: "builtin",       // disable bash/read/write/edit for security
    customTools: [searchWisdomTool, searchHoldingsTool, searchFilingsTool],
  });
  return session;
}

export async function getSession(userId: string | undefined, context?: SessionContext): Promise<SessionResult> {
  const key = sessionKey(userId, context);

  // Anonymous: always a fresh in-memory session
  if (!key) return { session: await makeSession(), isNew: true };

  const existing = sessions.get(key);
  if (existing) {
    lastUsed.set(key, Date.now());
    return { session: existing, isNew: false };
  }

  const session = await makeSession();
  sessions.set(key, session);
  lastUsed.set(key, Date.now());
  return { session, isNew: true };
}
