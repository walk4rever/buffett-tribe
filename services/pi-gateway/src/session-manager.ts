import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { homedir } from "os";
import { searchLettersTool } from "./tools/search-letters.js";
import { searchWisdomTool } from "./tools/search-wisdom.js";

const GATEWAY_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

// PI_AGENT_DIR: points to a directory containing models.json (and optionally auth.json).
// Local dev default: ~/.pi/agent (reuses existing pi CLI config).
// Production: set to ~/pi-gateway/.pi-agent after filling in real API keys.
const PI_AGENT_DIR = process.env.PI_AGENT_DIR ?? join(homedir(), ".pi", "agent");

// userId → session. Anonymous sessions are not cached (key = undefined).
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
    customTools: [searchLettersTool, searchWisdomTool],
  });
  return session;
}

export async function getSession(userId: string | undefined): Promise<AgentSession> {
  // Anonymous: always a fresh in-memory session
  if (!userId) return makeSession();

  const existing = sessions.get(userId);
  if (existing) {
    lastUsed.set(userId, Date.now());
    return existing;
  }

  const session = await makeSession();
  sessions.set(userId, session);
  lastUsed.set(userId, Date.now());
  return session;
}
