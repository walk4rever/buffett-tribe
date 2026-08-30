/**
 * 批量发送功能上线公告邮件给所有注册用户
 *
 * 内容草稿：~/R129/Vault/Buffett-Tribe-Agent上线公告邮件.md
 * 截图图片：~/R129/Vault/assets/（需上传到公开 URL 后更新 SCREENSHOTS 常量）
 *
 * 用法：
 *   npm run send:announcement                        # dry-run（只打印列表，不发送）
 *   npm run send:announcement -- --send              # 全量发送
 *   npm run send:announcement -- --send --limit 10   # 只发前 N 封（分批测试）
 *   npm run send:announcement -- --send --to me@example.com  # 只发给指定邮箱（预览测试）
 */

import { PrismaClient } from "@prisma/client";
import { Resend } from "resend";

const prisma = new PrismaClient();
const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = "价值部落 <buffet@air7.fun>";
const BASE_URL = "https://buffett.air7.fun";

const R2 = "https://pub-675abd2580e643e89dde5e766edae1b7.r2.dev/buffett-tribe/email/announcement-2026-06";
const SCREENSHOTS = {
  agent1:   `${R2}/agent-1.png`,
  agent2:   `${R2}/agent-2.png`,
  master1:  `${R2}/master-1.png`,
  master2:  `${R2}/master-2.png`,
  company1: `${R2}/company-1.png`,
  company2: `${R2}/company-2.png`,
  wechat:   `${R2}/wechat-qr.jpeg`,
};

const SUBJECT = "泡泡玛特值得买吗？大师会怎么分析这家公司";

// ─── HTML 邮件模板 ────────────────────────────────────────────────────────────
// 内容来源：~/R129/Vault/Buffett-Tribe-Agent上线公告邮件.md

function buildHtml(name: string | null): string {
  const greeting = name ? `你好，${name}，感谢注册！` : "你好，感谢注册！";

  function img(url: string, alt: string): string {
    if (!url) return "";
    return `<img src="${url}" alt="${alt}" style="width:100%;border-radius:6px;margin-top:14px;display:block;" />`;
  }

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif;">
<div style="max-width:600px;margin:40px auto;background:#ffffff;border-radius:12px;overflow:hidden;border:0.5px solid #e0e0e0;">

  <!-- Header -->
  <div style="background:#0f172a;padding:28px 36px;">
    <div style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">Value Tribe</div>
    <div style="font-size:12px;color:#94a3b8;margin-top:4px;letter-spacing:0.5px;">知识库 + Agent 驱动的价值投资研究平台</div>
  </div>

  <!-- Body -->
  <div style="padding:36px 36px 0;">

    <p style="margin:0 0 14px;font-size:15px;color:#1d1d1f;line-height:1.7;">${greeting}</p>
    <p style="margin:0 0 14px;font-size:15px;color:#1d1d1f;line-height:1.7;">
      过去几个月，我对这个产品做了很多调整与更新，刚刚上线了 Value Tribe 最重要的功能：<strong>价值投资 Agent</strong>。
    </p>
    <p style="margin:0 0 28px;font-size:15px;color:#374151;line-height:1.7;">
      买股票就是买公司。你有一个投资想法——"泡泡玛特值得买吗？"——平台把这个问题放进价值投资框架里：护城河在哪里？管理层可信吗？现在的价格有安全边际吗？大师们怎么看这类生意？
    </p>

    <!-- Feature 1: Agent -->
    <div style="border:0.5px solid #e5e7eb;border-radius:8px;padding:22px 24px;margin-bottom:16px;">
      <div style="font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:8px;">核心功能 一</div>
      <div style="font-size:17px;font-weight:700;color:#0f172a;margin-bottom:10px;">投资研究 Agent</div>
      <p style="margin:0 0 12px;font-size:14px;color:#374151;line-height:1.7;">
        这不是普通的 AI 对话。Agent 背后连接了真实数据——大师原话、持仓申报、公司年报——回答有溯源，不是凭空生成。
      </p>
      <p style="margin:0;font-size:14px;color:#6b7280;line-height:1.9;">
        可以直接问：<br />
        · 巴菲特如何评估一家公司的护城河？<br />
        · 查一下巴菲特最新的前十大持仓<br />
        · 苹果最新年报的 MD&A 里提到了什么风险？<br />
        · 段永平谈过怎么判断一个好的管理层？
      </p>
      ${img(SCREENSHOTS.agent1, "Agent 对话界面")}
      ${img(SCREENSHOTS.agent2, "Agent 工具调用过程")}
    </div>

    <!-- Feature 2: Knowledge base -->
    <div style="border:0.5px solid #e5e7eb;border-radius:8px;padding:22px 24px;margin-bottom:16px;">
      <div style="font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:8px;">核心功能 二</div>
      <div style="font-size:17px;font-weight:700;color:#0f172a;margin-bottom:10px;">大师知识图谱</div>
      <p style="margin:0 0 12px;font-size:14px;color:#374151;line-height:1.7;">
        内容库是这个产品的护城河。你在 Agent 里问到的每一个"大师怎么说"，都来自这里：
      </p>
      <p style="margin:0 0 12px;font-size:14px;color:#6b7280;line-height:1.9;">
        · 巴菲特年会记录 1994–2023（30 年）<br />
        · 股东信 1965–2025 + 合伙人信（60 封以上）<br />
        · 段永平问答录<br />
        · 李录演讲与文章
      </p>
      <p style="margin:0;font-size:14px;color:#6b7280;line-height:1.65;">
        共 <strong style="color:#374151;">2,656 个知识片段</strong>，语义检索，引用精确到来源文章和年份。也可以在
        <a href="${BASE_URL}/master" style="color:#0071e3;text-decoration:none;">/master</a> 页面直接浏览和阅读原文。
      </p>
      ${img(SCREENSHOTS.master1, "大师资料库页面")}
      ${img(SCREENSHOTS.master2, "大师资料详情")}
    </div>

    <!-- Feature 3: Company canvas -->
    <div style="border:0.5px solid #e5e7eb;border-radius:8px;padding:22px 24px;margin-bottom:28px;">
      <div style="font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:8px;">核心功能 三</div>
      <div style="font-size:17px;font-weight:700;color:#0f172a;margin-bottom:10px;">公司研究画布</div>
      <p style="margin:0 0 12px;font-size:14px;color:#374151;line-height:1.7;">
        任意一家公司，六个维度结构化呈现：业务分析、财务分析、价值分析、管理分析、估值分析、年度报告。
      </p>
      <p style="margin:0;font-size:14px;color:#6b7280;line-height:1.65;">
        每个维度背后都有 AI 结合价值投资框架生成的分析，财务数据来自 SEC 原始申报，年报可直接在页面内阅读。目前覆盖约
        <strong style="color:#374151;">120 家公司，2020–2025 年</strong>数据。
      </p>
      ${img(SCREENSHOTS.company1, "公司研究画布 — 六维度 Tab")}
      ${img(SCREENSHOTS.company2, "公司研究画布 — 详情")}
    </div>

    <!-- CTA -->
    <div style="text-align:center;margin-bottom:32px;">
      <a href="${BASE_URL}/agent"
         style="display:inline-block;background:#0071e3;color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:8px;font-size:15px;font-weight:600;">
        立即体验 →
      </a>
    </div>

    <!-- WeChat QR -->
    <div style="text-align:center;margin-bottom:36px;">
      <p style="margin:0 0 12px;font-size:14px;color:#374151;">有任何问题，请加我微信交流，或者<a href="mailto:walkklaw@gmail.com" style="color:#0071e3;text-decoration:none;">发邮件给我</a>！</p>
      <img src="${SCREENSHOTS.wechat}" alt="微信二维码" style="width:200px;border-radius:8px;border:0.5px solid #e5e7eb;display:block;margin:0 auto;" />
    </div>

  </div>

  <!-- Footer -->
  <div style="border-top:0.5px solid #e5e7eb;padding:20px 36px;background:#f9fafb;">
    <p style="margin:0;font-size:12px;color:#9ca3af;">— Value Tribe &nbsp;|&nbsp;
      <a href="${BASE_URL}" style="color:#9ca3af;text-decoration:none;">${BASE_URL.replace("https://", "")}</a>
    </p>
  </div>

</div>
</body>
</html>`;
}

// ─── 发送逻辑 ─────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf("--limit");
  const toIdx = args.indexOf("--to");
  return {
    send: args.includes("--send"),
    limit: limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : undefined,
    to: toIdx !== -1 ? args[toIdx + 1] : undefined,
  };
}

async function main() {
  const { send, limit, to } = parseArgs();

  if (!send) {
    console.log("⚠️  DRY-RUN 模式（加 --send 才会真正发送）\n");
  }

  if (!process.env.RESEND_API_KEY) {
    console.error("❌ 缺少 RESEND_API_KEY 环境变量");
    process.exit(1);
  }

  let users: { id: string; email: string | null; name: string | null }[];

  if (to) {
    users = [{ id: "test", email: to, name: null }];
    console.log(`📧 单发测试 → ${to}\n`);
  } else {
    users = await prisma.user.findMany({
      select: { id: true, email: true, name: true },
      where: { email: { not: null } },
      orderBy: { createdAt: "asc" },
      ...(limit ? { take: limit } : {}),
    });
  }

  console.log(`找到 ${users.length} 个用户${limit ? `（限制 ${limit} 封）` : ""}\n`);

  let sent = 0;
  let failed = 0;

  for (const user of users) {
    if (!user.email) continue;
    const label = `${user.email}${user.name ? ` (${user.name})` : ""}`;

    if (!send) {
      console.log(`  [dry-run] → ${label}`);
      continue;
    }

    try {
      await resend.emails.send({
        from: FROM,
        to: user.email,
        replyTo: "walkklaw@gmail.com",
        subject: SUBJECT,
        html: buildHtml(user.name),
      });
      console.log(`  ✓ → ${label}`);
      sent++;
    } catch (err) {
      console.error(`  ✗ 失败 → ${label}`, err);
      failed++;
    }

    // Resend 速率限制：2 req/s，留 500ms 余量
    await new Promise((r) => setTimeout(r, 500));
  }

  if (send) {
    console.log(`\n完成：成功 ${sent}，失败 ${failed}，共 ${users.length}`);
  } else {
    console.log(`\nDry-run 完成：共 ${users.length} 封待发。加 --send 开始发送。`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
