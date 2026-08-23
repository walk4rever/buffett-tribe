export interface HistoryTurn {
  role: "user" | "assistant";
  text: string;
  hadImages?: boolean;
}

// Matches the HISTORY_LIMIT the Next.js app already caps ChatTurn reads at
// (src/app/api/agent-turns/route.ts) — this is just a defensive ceiling on
// untrusted input, not a second source of truth for the limit.
const MAX_HISTORY_TURNS = 10;
const MAX_HISTORY_TEXT_LENGTH = 20_000;

/** Validates and narrows an untrusted `history` request field. Throws with a
 *  user-facing message on the first invalid entry; returns undefined for an
 *  absent/empty field. */
export function validateHistory(input: unknown): HistoryTurn[] | undefined {
  if (input === undefined || input === null) return undefined;
  if (!Array.isArray(input)) {
    throw new Error("history must be an array");
  }
  if (input.length === 0) return undefined;
  if (input.length > MAX_HISTORY_TURNS) {
    throw new Error(`history exceeds ${MAX_HISTORY_TURNS} turns`);
  }

  return input.map((raw) => {
    const turn = raw as { role?: unknown; text?: unknown; hadImages?: unknown };
    const role = turn.role === "user" || turn.role === "assistant" ? turn.role : undefined;
    const text = typeof turn.text === "string" ? turn.text : undefined;
    if (!role || text === undefined || text.length > MAX_HISTORY_TEXT_LENGTH) {
      throw new Error("invalid history entry");
    }
    return { role, text, hadImages: turn.hadImages === true };
  });
}
