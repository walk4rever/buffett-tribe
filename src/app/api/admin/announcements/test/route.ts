import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin-auth";
import { buildFullEmailHtml } from "@/lib/email-template";
import { Resend } from "resend";

import { getEmailSender, getEmailReplyTo } from "@/lib/brand";

export async function POST(req: Request) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json(
      { error: "未配置 RESEND_API_KEY 环境变量" },
      { status: 500 }
    );
  }

  try {
    const body = await req.json();
    const { toEmail, subject, markdown, preheader } = body;

    const targetEmail = toEmail?.trim() || session.user.email;
    if (!targetEmail || !targetEmail.includes("@")) {
      return NextResponse.json(
        { error: "请输入有效的测试接收邮箱" },
        { status: 400 }
      );
    }

    if (!subject?.trim()) {
      return NextResponse.json(
        { error: "邮件主题不能为空" },
        { status: 400 }
      );
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    const html = buildFullEmailHtml({
      subject,
      markdown: markdown || "",
      preheader,
      user: { name: session.user.name || "测试管理员", email: targetEmail },
    });

    const result = await resend.emails.send({
      from: getEmailSender(),
      to: targetEmail,
      replyTo: getEmailReplyTo(),
      subject: `[测试预览] ${subject}`,
      html,
    });

    if (result.error) {
      console.error("[admin/announcements/test] Resend error:", result.error);
      return NextResponse.json(
        { error: result.error.message || "测试邮件发送失败" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      messageId: result.data?.id,
      sentTo: targetEmail,
    });
  } catch (err: unknown) {
    console.error("[admin/announcements/test] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "发送测试邮件异常" },
      { status: 500 }
    );
  }
}
