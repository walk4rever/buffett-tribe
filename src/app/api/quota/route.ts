import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { currentPeriod, ensureFreeGrant, getBalance, FREE_MONTHLY_CREDITS } from "@/lib/credits";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "需要登录" }, { status: 401 });
  }

  const period = currentPeriod();
  // Same lazy grant /api/pi does — without it a user who hasn't spent a turn
  // this period would read a balance of 0 and think the quota was gone.
  await ensureFreeGrant(session.user.id, period);
  const balance = await getBalance(session.user.id, period);

  return NextResponse.json({ balance, period, monthlyLimit: FREE_MONTHLY_CREDITS });
}
