import express from "express";
import { requireSecret } from "./auth.js";
import { getSession, type SessionContext } from "./session-manager.js";
import { streamPrompt } from "./stream.js";

function buildContextPrefix(context: SessionContext | undefined): string | undefined {
  if (context?.masterName) {
    return `[当前用户正在浏览投资人主页：${context.masterName}${context.masterId ? `（id: ${context.masterId}）` : ""}。除非用户明确提到其他大师或公司，围绕这位投资人的框架、持仓、观点展开分析；调用 search_wisdom / search_holdings 时选择与这位投资人匹配的 master 过滤值。]`;
  }
  if (context?.companyName) {
    const label = context.ticker ? `${context.companyName}（${context.ticker}）` : context.companyName;
    const yearHint = context.periodYear ? ` ${context.periodYear} 年` : "";
    const companyParam = context.ticker ?? context.companyName;
    return `[当前用户正在阅读${label}${yearHint}的年报原文。除非用户明确提到其他公司，围绕这家公司的年报内容、财务数据、风险因素展开分析。关于护城河、估值情景、管理层资本配置这类结论性问题，先调用 get_company_analysis("${companyParam}") 看网站已生成的分析，不要重新从原文推导；需要原文具体表述或数据时再调用 search_filings 时用 "${companyParam}" 作为 company 参数${context.periodYear ? `，year 参数用 ${context.periodYear}` : ""}。]`;
  }
  if (context?.insightSlug) {
    const titleLabel = context.insightTitle ? `《${context.insightTitle}》` : "";
    return `[当前用户正在阅读洞见文章${titleLabel}（slug: ${context.insightSlug}）。需要原文中的具体表述、数据或段落细节时，调用 get_insight_content("${context.insightSlug}") 获取全文；仅凭标题回答不确定的问题前，先取原文核实。]`;
  }
  return undefined;
}

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
    context?: SessionContext;
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

  // Seed the page's context once, on the first turn of a fresh session — avoids
  // repeating it every message since the session is already scoped per master/company.
  const contextPrefix = isNew ? buildContextPrefix(context) : undefined;

  await streamPrompt(session, message.trim(), res, contextPrefix);
});

app.listen(PORT, () => {
  console.log(`pi-gateway listening on :${PORT}`);
});
