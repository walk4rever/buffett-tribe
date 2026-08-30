import { NextResponse } from "next/server";
import { Resend } from "resend";
import crypto from "crypto";
import prisma from "@/lib/prisma";
import { BRAND_EN } from "@/lib/brand";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.RESEND_FROM ?? "onboarding@resend.dev";
const BASE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
const TOKEN_TTL_HOURS = 2;

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = body?.email?.trim().toLowerCase();

  if (!email) {
    return NextResponse.json({ error: "请输入邮箱" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email } });

  // Always return success to avoid leaking whether email is registered
  if (!user) {
    return NextResponse.json({ ok: true });
  }

  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000);

  await prisma.verificationToken.upsert({
    where: { identifier_token: { identifier: email, token } },
    update: { expires },
    create: { identifier: email, token, expires },
  });

  const resetUrl = `${BASE_URL}/reset-password?token=${token}&email=${encodeURIComponent(email)}`;

  await resend.emails.send({
    from: FROM,
    to: email,
    subject: `重置你的 ${BRAND_EN} 账户密码`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif;line-height:1.65;color:#1f2937;max-width:560px;">
        <h2 style="margin:0 0 10px;font-size:18px;color:#0f172a;">${BRAND_EN} 账户密码重置</h2>
        <p style="margin:0 0 12px;">你好，</p>
        <p style="margin:0 0 12px;">我们收到了你的密码重置请求。点击下方按钮设置新密码（链接在 ${TOKEN_TTL_HOURS} 小时内有效）。</p>
        <p style="margin:0 0 14px;">
          <a href="${resetUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600;">重置密码</a>
        </p>
        <p style="margin:0 0 12px;color:#475569;font-size:13px;">如果你没有发起此请求，请忽略这封邮件。</p>
        <p style="margin:0;color:#64748b;font-size:12px;">— ${BRAND_EN}</p>
      </div>
    `,
  });

  return NextResponse.json({ ok: true });
}
