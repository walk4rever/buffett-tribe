import type { Request, Response, NextFunction } from "express";

const AGENT_SECRET = process.env.AGENT_SECRET;

if (!AGENT_SECRET) {
  throw new Error("AGENT_SECRET env var is required");
}

export function requireSecret(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers["x-agent-secret"];
  if (header !== AGENT_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}
