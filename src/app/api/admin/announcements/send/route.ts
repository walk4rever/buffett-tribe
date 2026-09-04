import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin-auth";
import prisma from "@/lib/prisma";
import { buildFullEmailHtml } from "@/lib/email-template";
import { Resend } from "resend";

import { getEmailSender, getEmailReplyTo, isDeliverableEmail } from "@/lib/brand";

const BATCH_SIZE = 100;

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
    const {
      subject,
      markdown,
      preheader,
      recipientMode,
      userIds,
      draftId,
    } = body;

    if (!subject?.trim()) {
      return NextResponse.json(
        { error: "邮件主题不能为空" },
        { status: 400 }
      );
    }

    if (!markdown?.trim()) {
      return NextResponse.json(
        { error: "Markdown 发布内容不能为空" },
        { status: 400 }
      );
    }

    if (recipientMode !== "all" && recipientMode !== "selected") {
      return NextResponse.json(
        { error: "请选择有效的收件人模式（全部或指定用户）" },
        { status: 400 }
      );
    }

    if (recipientMode === "selected" && (!Array.isArray(userIds) || userIds.length === 0)) {
      return NextResponse.json(
        { error: "请选择至少一位目标用户" },
        { status: 400 }
      );
    }

    // 1. Fetch targeted users
    const users = await prisma.user.findMany({
      where: {
        email: { not: null },
        ...(recipientMode === "selected" ? { id: { in: userIds } } : {}),
      },
      select: { id: true, email: true, name: true },
    });

    const validRecipients = users.filter(
      (u) => isDeliverableEmail(u.email)
    );

    if (validRecipients.length === 0) {
      return NextResponse.json(
        { error: "所选受众中没有找到包含有效邮箱的用户" },
        { status: 400 }
      );
    }

    // 2. Create or update announcement campaign record
    let announcement = draftId
      ? await prisma.emailAnnouncement
          .update({
            where: { id: draftId },
            data: {
              subject: subject.trim(),
              preheader: preheader?.trim() || null,
              contentMarkdown: markdown,
              recipientMode,
              recipientsCount: validRecipients.length,
              status: "sending",
            },
          })
          .catch(() => null)
      : null;

    if (!announcement) {
      announcement = await prisma.emailAnnouncement.create({
        data: {
          subject: subject.trim(),
          preheader: preheader?.trim() || null,
          contentMarkdown: markdown,
          recipientMode,
          recipientsCount: validRecipients.length,
          status: "sending",
          createdById: session.user.id,
        },
      });
    }

    const resend = new Resend(process.env.RESEND_API_KEY);

    // 3. Prepare individual personalized email payloads
    const emailPayloads = validRecipients.map((u) => ({
      from: getEmailSender(),
      to: u.email!,
      replyTo: getEmailReplyTo(),
      subject: subject.trim(),
      html: buildFullEmailHtml({
        subject: subject.trim(),
        markdown,
        preheader: preheader?.trim(),
        user: { name: u.name, email: u.email! },
      }),
    }));

    let successCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    // 4. Batch send in chunks of up to 100
    for (let i = 0; i < emailPayloads.length; i += BATCH_SIZE) {
      const chunk = emailPayloads.slice(i, i + BATCH_SIZE);
      try {
        const batchRes = await resend.batch.send(chunk);

        if (batchRes.error) {
          console.warn(
            `[admin/announcements/send] batch ${Math.floor(i / BATCH_SIZE) + 1} rejected by Resend (${batchRes.error.message}), falling back to individual sends...`
          );
          // Fallback to sending individually to isolate invalid email and deliver to valid ones
          for (const item of chunk) {
            try {
              const singleRes = await resend.emails.send(item);
              if (singleRes.error) {
                console.error(`[admin/announcements/send] single send error for ${item.to}:`, singleRes.error);
                errors.push(`${item.to} 发送失败: ${singleRes.error.message}`);
                failedCount++;
              } else {
                successCount++;
              }
            } catch (singleErr: unknown) {
              const msg = singleErr instanceof Error ? singleErr.message : String(singleErr);
              errors.push(`${item.to} 异常: ${msg}`);
              failedCount++;
            }
            await new Promise((r) => setTimeout(r, 100));
          }
        } else if (batchRes.data?.data) {
          const sentNum = batchRes.data.data.length;
          successCount += sentNum;
          if (sentNum < chunk.length) {
            failedCount += chunk.length - sentNum;
            errors.push(
              `批次 ${Math.floor(i / BATCH_SIZE) + 1} 部分用户未发送成功 (${chunk.length - sentNum} 封)`
            );
          }
        } else {
          successCount += chunk.length;
        }
      } catch (err: unknown) {
        console.warn("[admin/announcements/send] batch exception, falling back to individual sends:", err);
        for (const item of chunk) {
          try {
            const singleRes = await resend.emails.send(item);
            if (singleRes.error) {
              errors.push(`${item.to} 失败: ${singleRes.error.message}`);
              failedCount++;
            } else {
              successCount++;
            }
          } catch (singleErr: unknown) {
            const msg = singleErr instanceof Error ? singleErr.message : String(singleErr);
            errors.push(`${item.to} 异常: ${msg}`);
            failedCount++;
          }
          await new Promise((r) => setTimeout(r, 100));
        }
      }

      // Small throttle between batches
      if (i + BATCH_SIZE < emailPayloads.length) {
        await new Promise((r) => setTimeout(r, 400));
      }
    }

    // 5. Update campaign status
    const finalStatus =
      failedCount === 0
        ? "sent"
        : successCount > 0
        ? "partial"
        : "failed";

    await prisma.emailAnnouncement.update({
      where: { id: announcement.id },
      data: {
        status: finalStatus,
        successCount,
        failedCount,
        errorSummary: errors.length > 0 ? errors.slice(0, 10).join("\n") : null,
        sentAt: new Date(),
      },
    });

    return NextResponse.json({
      ok: true,
      announcementId: announcement.id,
      totalCount: validRecipients.length,
      successCount,
      failedCount,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err: unknown) {
    console.error("[admin/announcements/send] unexpected error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "群发邮件处理异常" },
      { status: 500 }
    );
  }
}
