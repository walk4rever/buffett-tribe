import express from "express";
import { requireSecret } from "./auth.js";
import { getSession, getExistingSession, type SessionContext } from "./session-manager.js";
import { streamPrompt } from "./stream.js";
import { validateImageAttachments } from "./image-attachment.js";
import { validateHistory } from "./history.js";

function buildContextPrefix(context: SessionContext | undefined): string | undefined {
  if (context?.masterName) {
    return `[当前用户正在浏览投资人主页：${context.masterName}${context.masterId ? `（id: ${context.masterId}）` : ""}。除非用户明确提到其他大师或公司，围绕这位投资人的框架、持仓、观点展开分析；调用 search_wisdom / search_holdings 时选择与这位投资人匹配的 master 过滤值。]`;
  }
  if (context?.companyName) {
    const label = context.ticker ? `${context.companyName}（${context.ticker}）` : context.companyName;
    const companyParam = context.ticker ?? context.companyName;
    const situation = context.periodYear
      ? `当前用户正在阅读${label} ${context.periodYear} 年的年报原文。`
      : `当前用户正在浏览${label}的公司主页。`;
    return `[${situation}除非用户明确提到其他公司，围绕这家公司展开分析。业务/产品/护城河/估值情景/管理层资本配置这类问题，先调用 get_company_analysis("${companyParam}") 看网站已生成的分析，不要重新从原文推导；只有需要原文具体表述、某一年具体数字，或 get_company_analysis 没覆盖的内容时才调用 search_filings，用 "${companyParam}" 作为 company 参数${context.periodYear ? `，year 参数用 ${context.periodYear}` : ""}。]`;
  }
  if (context?.insightSlug) {
    const titleLabel = context.insightTitle ? `《${context.insightTitle}》` : "";
    return `[当前用户正在阅读洞见文章${titleLabel}（slug: ${context.insightSlug}）。需要原文中的具体表述、数据或段落细节时，调用 get_insight_content("${context.insightSlug}") 获取全文；仅凭标题回答不确定的问题前，先取原文核实。]`;
  }
  return undefined;
}

const PORT = Number(process.env.PORT ?? 3456);
const app = express();
// Default 100kb is too small for a request carrying downscaled image attachments.
app.use(express.json({ limit: "10mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/chat", requireSecret, async (req, res) => {
  const { message, userId, context, images: rawImages, history: rawHistory } = req.body as {
    message?: string;
    userId?: string;
    context?: SessionContext;
    images?: unknown;
    history?: unknown;
  };

  if (!message || typeof message !== "string" || message.trim() === "") {
    res.status(400).json({ error: "message is required" });
    return;
  }

  let images;
  try {
    images = validateImageAttachments(rawImages);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "invalid images" });
    return;
  }

  let history;
  try {
    history = validateHistory(rawHistory);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "invalid history" });
    return;
  }

  let session, isNew;
  try {
    ({ session, isNew } = await getSession(userId, context, history));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Failed to create session: ${msg}` });
    return;
  }

  if (session.isStreaming) {
    res.status(409).json({ error: "Session is busy" });
    return;
  }

  // `req`'s close event tracks the request body's readable side, which Express's
  // json() middleware already drains before this handler runs — it never fires
  // again just because the client walks away mid-response. `res`'s close event is
  // what actually reflects the underlying socket being torn down (client abort),
  // so it's the one that needs to trigger cancelling the in-flight generation.
  res.on("close", () => {
    if (session.isStreaming) session.abort();
  });

  // Seed the page's context once, on the first turn of a fresh session — avoids
  // repeating it every message since the session is already scoped per master/company.
  const contextPrefix = isNew ? buildContextPrefix(context) : undefined;

  await streamPrompt(session, message.trim(), res, contextPrefix, images);
});

// Explicit cancel, independent of connection-close detection: on platforms where the
// Next.js route forwarding /chat runs as a serverless function (Vercel's Node.js
// runtime), a client disconnect never reaches this process at all — the function just
// keeps running the request to completion in the background regardless of `res`'s
// close event above. The client hits this endpoint directly instead of relying on that.
//
// Awaits the abort rather than firing it off: abort() only resolves once the
// generation has actually unwound and isStreaming is back to false. Responding
// before that lets a client that immediately sends its next message reach /chat
// while the session still looks busy, which is exactly the 409 this endpoint exists
// to prevent.
app.post("/cancel", requireSecret, async (req, res) => {
  const { userId, context } = req.body as { userId?: string; context?: SessionContext };
  const session = getExistingSession(userId, context);
  if (session?.isStreaming) await session.abort();
  res.json({ ok: true, streaming: session?.isStreaming ?? false });
});

app.listen(PORT, () => {
  console.log(`pi-gateway listening on :${PORT}`);
});
