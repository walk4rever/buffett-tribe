import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

async function requireOwnedNote(userId: string, id: string) {
  const note = await prisma.note.findUnique({ where: { id } });
  if (!note || note.userId !== userId) return null;
  return note;
}

const patchBodySchema = z.object({
  title: z.string().nullable().optional(),
  content: z.string().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "需要登录" }, { status: 401 });
  }

  const { id } = await params;
  const existing = await requireOwnedNote(session.user.id, id);
  if (!existing) {
    return NextResponse.json({ error: "笔记不存在" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = patchBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request body" }, { status: 400 });
  }

  const note = await prisma.note.update({
    where: { id },
    data: parsed.data,
  });

  return NextResponse.json({ note });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "需要登录" }, { status: 401 });
  }

  const { id } = await params;
  const existing = await requireOwnedNote(session.user.id, id);
  if (!existing) {
    return NextResponse.json({ error: "笔记不存在" }, { status: 404 });
  }

  await prisma.note.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
