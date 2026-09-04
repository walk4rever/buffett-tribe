import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin-auth";
import prisma from "@/lib/prisma";

export async function GET() {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const users = await prisma.user.findMany({
      where: {
        email: { not: null },
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    const validUsers = users.filter(
      (u) => Boolean(u.email && u.email.trim() && u.email.includes("@"))
    );

    return NextResponse.json({
      totalCount: validUsers.length,
      users: validUsers,
    });
  } catch (err: unknown) {
    console.error("[admin/announcements/recipients] GET error:", err);
    return NextResponse.json(
      { error: "Failed to fetch recipient users" },
      { status: 500 }
    );
  }
}
