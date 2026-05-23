import { PrismaClient } from "@prisma/client";
import { normalizeTicker } from "../src/lib/ticker";

const db = new PrismaClient();

const dryRun = process.argv.includes("--dry-run");
const tickerArg = process.argv.find((_, i, arr) => arr[i - 1] === "--ticker") ?? null;
const onlyTicker = normalizeTicker(tickerArg);

type SecurityRow = Awaited<ReturnType<typeof loadSecurities>>[number];

type MergePlan = {
  key: string;
  companyName: string | null;
  ticker: string;
  classKey: string;
  keep: SecurityRow;
  drop: SecurityRow[];
  holdingIdsToRewrite: string[];
};

function normText(value: string | null) {
  return value?.trim().toUpperCase().replace(/\s+/g, " ") ?? "";
}

function classKey(security: { shareClass: string | null; titleOfClass: string | null }) {
  return normText(security.shareClass) || normText(security.titleOfClass);
}

function scoreSecurity(security: SecurityRow) {
  const latestHolding = security.holdings.reduce<Date | null>((latest, holding) => {
    if (!latest || holding.asOfDate > latest) return holding.asOfDate;
    return latest;
  }, null);
  const earliestHolding = security.holdings.reduce<Date | null>((earliest, holding) => {
    if (!earliest || holding.asOfDate < earliest) return holding.asOfDate;
    return earliest;
  }, null);

  return (
    security.holdings.length * 10_000 +
    (latestHolding?.getTime() ?? 0) / 1_000_000_000 +
    (earliestHolding ? 1_000_000_000 - earliestHolding.getTime() / 1_000_000_000 : 0) +
    (security.isPrimary ? 1_000 : 0) +
    security.updatedAt.getTime() / 1_000_000_000_000
  );
}

async function loadSecurities() {
  return db.security.findMany({
    where: {
      companyEntityId: { not: null },
      ticker: { not: null },
    },
    select: {
      id: true,
      entityId: true,
      companyEntityId: true,
      ticker: true,
      cusip: true,
      shareClass: true,
      titleOfClass: true,
      exchange: true,
      isPrimary: true,
      updatedAt: true,
      company: { select: { canonicalName: true, ticker: true } },
      holdings: { select: { id: true, asOfDate: true } },
    },
  });
}

async function buildPlan(): Promise<MergePlan[]> {
  const securities = await loadSecurities();
  const groups = new Map<string, SecurityRow[]>();

  for (const security of securities) {
    const ticker = normalizeTicker(security.ticker);
    if (!ticker) continue;
    if (onlyTicker && ticker !== onlyTicker) continue;
    const cls = classKey(security);
    const key = `${security.companyEntityId}|${ticker}|${cls}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(security);
    groups.set(key, bucket);
  }

  const plan: MergePlan[] = [];
  for (const [key, group] of groups.entries()) {
    if (group.length < 2) continue;
    const ranked = [...group].sort((a, b) => scoreSecurity(b) - scoreSecurity(a));
    const keep = ranked[0];
    const drop = ranked.slice(1);
    plan.push({
      key,
      companyName: keep.company?.canonicalName ?? null,
      ticker: normalizeTicker(keep.ticker) ?? keep.ticker ?? "",
      classKey: classKey(keep),
      keep,
      drop,
      holdingIdsToRewrite: drop.flatMap((security) => security.holdings.map((holding) => holding.id)),
    });
  }

  return plan;
}

function printPlan(plan: MergePlan[]) {
  console.log(
    JSON.stringify(
      {
        mode: dryRun ? "dry-run" : "live",
        filterTicker: onlyTicker,
        groups: plan.map((item) => ({
          key: item.key,
          company: item.companyName,
          ticker: item.ticker,
          classKey: item.classKey,
          keep: {
            id: item.keep.id,
            entityId: item.keep.entityId,
            cusip: item.keep.cusip,
            holdings: item.keep.holdings.length,
            updatedAt: item.keep.updatedAt,
          },
          drop: item.drop.map((security) => ({
            id: security.id,
            entityId: security.entityId,
            cusip: security.cusip,
            holdings: security.holdings.length,
            updatedAt: security.updatedAt,
          })),
          holdingsToRewrite: item.holdingIdsToRewrite.length,
        })),
        summary: {
          duplicateGroups: plan.length,
          securityProfilesToDelete: plan.reduce((sum, item) => sum + item.drop.length, 0),
          holdingsToRewrite: plan.reduce((sum, item) => sum + item.holdingIdsToRewrite.length, 0),
        },
      },
      null,
      2,
    ),
  );
}

async function applyPlan(plan: MergePlan[]) {
  for (const item of plan) {
    await db.$transaction(async (tx) => {
      if (item.holdingIdsToRewrite.length > 0) {
        await tx.holding.updateMany({
          where: { id: { in: item.holdingIdsToRewrite } },
          data: { securityId: item.keep.id },
        });
      }

      await tx.security.deleteMany({
        where: { id: { in: item.drop.map((security) => security.id) } },
      });
    });
  }
}

async function main() {
  const plan = await buildPlan();
  printPlan(plan);
  if (dryRun) return;
  await applyPlan(plan);
  console.log("[cleanup-duplicate-security-profiles] done");
}

main()
  .catch((err) => {
    console.error("[cleanup-duplicate-security-profiles] fatal", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
