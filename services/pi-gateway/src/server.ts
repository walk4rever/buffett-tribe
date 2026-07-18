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
  const { message, userId, context } = req.body as {
    message?: string;
    userId?: string;
    context?: { masterId?: string; masterName?: string };
  };

  if (!message || typeof message !== "string" || message.trim() === "") {
    res.status(400).json({ error: "message is required" });
    return;
  }

  let session, isNew;
  try {
    ({ session, isNew } = await getSession(userId, context));
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

  // Seed the investor page's context once, on the first turn of a fresh session —
  // avoids repeating it every message since the session is already scoped per master.
  const contextPrefix = isNew && context?.masterName
    ? `[当前用户正在浏览投资人主页：${context.masterName}${context.masterId ? `（id: ${context.masterId}）` : ""}。除非用户明确提到其他大师或公司，围绕这位投资人的框架、持仓、观点展开分析；调用 search_wisdom / search_holdings 时选择与这位投资人匹配的 master 过滤值。]`
    : undefined;

  await streamPrompt(session, message.trim(), res, contextPrefix);
});

app.listen(PORT, () => {
  console.log(`pi-gateway listening on :${PORT}`);
});
