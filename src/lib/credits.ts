import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";

/** Monthly free grant, in credits. One credit = one /api/pi turn (covers /agent
 *  and all four "AI 解读" panels — they share this one backend route). Same
 *  number ai-dive uses for its own equivalent, reused as-is for now rather than
 *  deriving buffett-tribe's own per-turn cost first. */
export const FREE_MONTHLY_CREDITS = 1000;

/** Ceiling on spend rows within a trailing hour, independent of the monthly
 *  balance — abuse prevention (how fast), not the economic model (how much). */
export const HOURLY_SPEND_LIMIT = 50;

export const GRANT_FREE = "grant_free";
export const GRANT_PLAN = "grant_plan"; // reserved for a future paid plan grant, unused for now
export const SPEND_AGENT = "spend_agent";
export const GRANT_ADMIN_ADJUST = "grant_admin_adjust";

/** 'YYYY-MM' in UTC — the period a ledger row belongs to. Rows outside the
 *  current period stop counting toward the balance query, so monthly expiry is
 *  implicit and needs no cleanup job. */
export function currentPeriod(date: Date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/** Balance = SUM(delta) over rows in the given period plus any never-expiring
 *  rows (period IS NULL — manual admin adjustments and, later, purchased
 *  top-ups). Never stored/mutated in place — this table is append-only. */
export async function getBalance(userId: string, period: string = currentPeriod()): Promise<number> {
  const result = await prisma.creditLedger.aggregate({
    _sum: { delta: true },
    where: { userId, OR: [{ period }, { period: null }] },
  });
  return result._sum.delta ?? 0;
}

/** Lazily grants this period's free credits the first time a user is seen in
 *  it. Idempotent under concurrent requests via the partial unique index on
 *  (userId, reason, period) for grant-type reasons — a duplicate insert hits
 *  that constraint (Prisma P2002) and is swallowed here, so callers never need
 *  to branch on "already granted". No cron: the grant only exists once someone
 *  actually shows up. */
export async function ensureFreeGrant(userId: string, period: string = currentPeriod()): Promise<void> {
  try {
    await prisma.creditLedger.create({
      data: { userId, delta: FREE_MONTHLY_CREDITS, reason: GRANT_FREE, period },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return;
    throw err;
  }
}

/** Records one turn's spend. Called only after the gateway has confirmed it
 *  accepted the request — balance is checked up front instead of
 *  pre-deducting and refunding on failure, which keeps this the only ledger
 *  write per turn. */
export async function recordSpend(
  userId: string,
  refId: string | undefined,
  period: string = currentPeriod()
): Promise<void> {
  await prisma.creditLedger.create({
    data: { userId, delta: -1, reason: SPEND_AGENT, period, refId },
  });
}

/** True if the user is still under the trailing-hour spend ceiling. Reads
 *  existing spend_agent rows rather than writing a separate counter. */
export async function withinHourlyLimit(userId: string): Promise<boolean> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const count = await prisma.creditLedger.count({
    where: { userId, reason: SPEND_AGENT, createdAt: { gte: oneHourAgo } },
  });
  return count < HOURLY_SPEND_LIMIT;
}
