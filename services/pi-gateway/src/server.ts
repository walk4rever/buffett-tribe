import express from "express";
import { requireSecret } from "./auth.js";
import { getSession } from "./session-manager.js";
import { streamPrompt } from "./stream.js";

const PORT = Number(process.env.PORT ?? 3456);
const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/chat", requireSecret, async (req, res) => {
  const { message, userId } = req.body as { message?: string; userId?: string };

  if (!message || typeof message !== "string" || message.trim() === "") {
    res.status(400).json({ error: "message is required" });
    return;
  }

  let session;
  try {
    session = await getSession(userId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Failed to create session: ${msg}` });
    return;
  }

  if (session.isStreaming) {
    res.status(409).json({ error: "Session is busy" });
    return;
  }

  req.on("close", () => {
    if (session.isStreaming) session.abort();
  });

  await streamPrompt(session, message.trim(), res);
});

app.listen(PORT, () => {
  console.log(`pi-gateway listening on :${PORT}`);
});
