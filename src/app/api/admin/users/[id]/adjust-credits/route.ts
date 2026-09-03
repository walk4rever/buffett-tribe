import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminSession } from "@/lib/admin-auth";
import { GRANT_ADMIN_ADJUST } from "@/lib/credits";
import prisma from "@/lib/prisma";

const bodySchema = z.object({
  amount: z.number().int().refine((n) => n !== 0, "amount must be non-zero"),
});

/** Manual top-up/deduction path — deliberately the *only* way a user's balance
 *  moves outside the automated grant/spend flow, including for admins
 *  themselves (role==='admin' does not bypass the /api/pi quota check).
 *  `period: null` (never-expiring) and `reason` is outside the grant-type
 *  partial unique index, so this can be called repeatedly without hitting the
 *  idempotency constraint that guards the monthly free grant. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });
  }

  const { id: userId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request body" }, { status: 400 });
  }

  const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!target) {
    return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  }

  await prisma.creditLedger.create({
    data: {
      userId,
      delta: parsed.data.amount,
      reason: GRANT_ADMIN_ADJUST,
      period: null,
      refId: session.user.id,
    },
  });

  return NextResponse.json({ ok: true });
}
