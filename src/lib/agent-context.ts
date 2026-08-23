import { z } from "zod";

export type AgentContext =
  | { masterId: string; masterName: string }
  | { companyName: string; ticker?: string; periodYear?: number }
  | { insightSlug: string; insightTitle: string };

export const agentContextSchema: z.ZodType<AgentContext> = z.union([
  z.object({ masterId: z.string(), masterName: z.string() }),
  z.object({
    companyName: z.string(),
    ticker: z.string().optional(),
    periodYear: z.number().optional(),
  }),
  z.object({ insightSlug: z.string(), insightTitle: z.string() }),
]);

/**
 * Normalizes an AgentContext into a stable string key for grouping ChatTurn rows —
 * mirrors the precedence used by pi-gateway's sessionKey() (services/pi-gateway/src/session-manager.ts)
 * so the same page maps to the same conversation thread.
 */
export function deriveContextKey(context: AgentContext | undefined): string {
  if (!context) return "none";
  if ("masterId" in context) return `master:${context.masterId}`;
  if ("companyName" in context) return `company:${context.ticker ?? context.companyName}`;
  return `insight:${context.insightSlug}`;
}
