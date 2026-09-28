import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getClientIp } from "@/lib/ratelimit";
import { checkGuestLimit } from "@/lib/guest-credits";
import { currentPeriod, getBalance } from "@/lib/credits";

/**
 * GET /api/quota
 *
 * 返回当前用户的 AI 对话配额信息：
 * - 已登录用户：每月 1000 次额度，返回剩余次数
 * - 未登录用户：每 IP 每天 5 次试用，返回剩余次数
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);

  if (session) {
    // 已登录用户：返回月度余额
    const balance = await getBalance(session.user.id, currentPeriod());
    return NextResponse.json({
      type: "user",
      balance,
      limit: 1000,
      period: "monthly",
    });
  } else {
    // 未登录用户：返回 IP 每日试用次数
    const ip = getClientIp(req);
    const { allowed, remaining, used } = await checkGuestLimit(ip);
    return NextResponse.json({
      type: "guest",
      remaining,
      used,
      limit: 5,
      period: "daily",
      allowed,
    });
  }
}
