import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin-auth";
import prisma from "@/lib/prisma";

export async function POST(req: Request) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { id, subject = "", preheader = "", markdown = "", recipientMode = "all" } = body;

    let draft;
    if (id) {
      draft = await prisma.emailAnnouncement.upsert({
        where: { id },
        update: {
          subject: subject.trim() || "无标题草稿",
          preheader: preheader.trim() || null,
          contentMarkdown: markdown,
          recipientMode,
          status: "draft",
          updatedAt: new Date(),
        },
        create: {
          id,
          subject: subject.trim() || "无标题草稿",
          preheader: preheader.trim() || null,
          contentMarkdown: markdown,
          recipientMode,
          status: "draft",
          createdById: session.user.id,
        },
      });
    } else {
      draft = await prisma.emailAnnouncement.create({
        data: {
          subject: subject.trim() || "无标题草稿",
          preheader: preheader.trim() || null,
          contentMarkdown: markdown,
          recipientMode,
          status: "draft",
          createdById: session.user.id,
        },
      });
    }

    return NextResponse.json({ draft });
  } catch (err: unknown) {
    console.error("[admin/announcements/draft] POST error:", err);
    return NextResponse.json(
      { error: "Failed to save draft" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Draft ID required" }, { status: 400 });
    }

    await prisma.emailAnnouncement.delete({
      where: { id },
    });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    console.error("[admin/announcements/draft] DELETE error:", err);
    return NextResponse.json(
      { error: "Failed to delete draft" },
      { status: 500 }
    );
  }
}
