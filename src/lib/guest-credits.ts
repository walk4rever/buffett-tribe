import prisma from "@/lib/prisma";

/** 匿名用户每日试用额度（每 IP） */
export const GUEST_DAILY_LIMIT = 5;

/**
 * 检查匿名用户（IP）今日剩余试用次数
 */
export async function checkGuestLimit(ip: string): Promise<{
  allowed: boolean;
  remaining: number;
  used: number;
}> {
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

  const usage = await prisma.chatUsage.findUnique({
    where: {
      ip_date: {
        ip,
        date: today,
      },
    },
  });

  const used = usage?.count ?? 0;
  const remaining = Math.max(0, GUEST_DAILY_LIMIT - used);

  return {
    allowed: used < GUEST_DAILY_LIMIT,
    remaining,
    used,
  };
}

/**
 * 记录匿名用户（IP）使用一次试用额度
 */
export async function recordGuestUsage(ip: string): Promise<void> {
  const today = new Date().toISOString().split("T")[0];

  await prisma.chatUsage.upsert({
    where: {
      ip_date: {
        ip,
        date: today,
      },
    },
    create: {
      ip,
      date: today,
      count: 1,
    },
    update: {
      count: {
        increment: 1,
      },
    },
  });
}
