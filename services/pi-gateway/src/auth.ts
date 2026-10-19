import type { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";

const AGENT_SECRET = process.env.AGENT_SECRET;

if (!AGENT_SECRET) {
  throw new Error("AGENT_SECRET env var is required");
}
const SECRET: string = AGENT_SECRET;

export function requireSecret(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers["x-agent-secret"];
  if (typeof header !== "string" || !safeEqual(header, SECRET)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
