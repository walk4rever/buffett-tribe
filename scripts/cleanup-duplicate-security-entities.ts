import { PrismaClient } from "@prisma/client";
import { normalizeTicker } from "../src/lib/ticker";

const db = new PrismaClient();

const dryRun = process.argv.includes("--dry-run");
const tickerArg = process.argv.find((_, i, arr) => arr[i - 1] === "--ticker") ?? null;
const onlyTicker = normalizeTicker(tickerArg);

type EntityRow = Awaited<ReturnType<typeof loadSecurityEntities>>[number];

type LegacyMergePlan = {
  key: string;
  companyName: string | null;
  ticker: string;
  classKey: string;
  keep: EntityRow;
  drop: EntityRow[];
  holdingIdsToRewrite: string[];
  blockers: string[];
};

type JsonObj = Record<string, unknown>;

function asObj(value: unknown): JsonObj {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as JsonObj;
}

function normText(value: unknown) {
  return typeof value === "string" ? value.trim().toUpperCase().replace(/\s+/g, " ") : "";
}

function metadataString(meta: JsonObj, key: string) {
  const value = meta[key];
  return typeof value === "string" ? value : null;
}

function companyIdOf(entity: EntityRow) {
  const meta = asObj(entity.metadata);
  return entity.securityProfile?.companyEntityId ?? metadataString(meta, "companyEntityId");
}

function tickerOf(entity: EntityRow) {
  return normalizeTicker(entity.securityProfile?.ticker ?? entity.ticker);
}

function classKey(entity: EntityRow) {
  const meta = asObj(entity.metadata);
  return (
    normText(entity.securityProfile?.shareClass) ||
    normText(entity.securityProfile?.titleOfClass) ||
    normText(metadataString(meta, "titleOfClass"))
  );
}

function latestHoldingTime(entity: EntityRow) {
  return entity.holdingsAsSecurity.reduce((latest, holding) => {
    const time = holding.asOfDate.getTime();
    return time > latest ? time : latest;
  }, 0);
}

function scoreEntity(entity: EntityRow) {
  return (
    (entity.securityProfile ? 1_000_000 : 0) +
    entity.holdingsAsSecurity.length * 10_000 +
    latestHoldingTime(entity) / 1_000_000_000 +
    entity.updatedAt.getTime() / 1_000_000_000_000
  );
}

async function loadSecurityEntities() {
  return db.entity.findMany({
    where: {
      type: "security",
      ticker: { not: null },
    },
    select: {
      id: true,
      canonicalName: true,
      ticker: true,
      metadata: true,
      updatedAt: true,
      securityProfile: {
        select: {
          id: true,
          companyEntityId: true,
          ticker: true,
          shareClass: true,
          titleOfClass: true,
          company: { select: { canonicalName: true } },
        },
      },
      holdingsAsSecurity: {
        select: {
          id: true,
          holderEntityId: true,
          asOfDate: true,
        },
      },
      _count: {
        select: {
          mentions: true,
          relationsAsSrc: true,
          relationsAsDst: true,
        },
      },
    },
  });
}

async function buildPlan(): Promise<LegacyMergePlan[]> {
  const entities = await loadSecurityEntities();
  const groups = new Map<string, EntityRow[]>();

  for (const entity of entities) {
    const companyId = companyIdOf(entity);
    const ticker = tickerOf(entity);
    if (!companyId || !ticker) continue;
    if (onlyTicker && ticker !== onlyTicker) continue;
    const key = `${companyId}|${ticker}|${classKey(entity)}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(entity);
    groups.set(key, bucket);
  }

  const plan: LegacyMergePlan[] = [];
  for (const [key, group] of groups.entries()) {
    if (group.length < 2) continue;
    const ranked = [...group].sort((a, b) => scoreEntity(b) - scoreEntity(a));
    const keep = ranked[0];
    const drop = ranked.slice(1);
    const blockers: string[] = [];
    const holdingIdsToRewrite: string[] = [];

    for (const entity of drop) {
      if (entity.securityProfile) blockers.push(`${entity.id} still has Security profile ${entity.securityProfile.id}`);
      if (entity._count.mentions > 0) blockers.push(`${entity.id} mentions=${entity._count.mentions}`);
      const relationCount = entity._count.relationsAsSrc + entity._count.relationsAsDst;
      if (relationCount > 0) blockers.push(`${entity.id} relations=${relationCount}`);

      for (const holding of entity.holdingsAsSecurity) {
        const conflict = await db.holding.findFirst({
          where: {
            holderEntityId: holding.holderEntityId,
            securityEntityId: keep.id,
            asOfDate: holding.asOfDate,
          },
          select: { id: true },
        });
        if (conflict) {
          blockers.push(`${entity.id} holding ${holding.id} conflicts with canonical holding ${conflict.id}`);
        } else {
          holdingIdsToRewrite.push(holding.id);
        }
      }
    }

    plan.push({
      key,
      companyName: keep.securityProfile?.company?.canonicalName ?? null,
      ticker: tickerOf(keep) ?? keep.ticker ?? "",
      classKey: classKey(keep),
      keep,
      drop,
      holdingIdsToRewrite,
      blockers: [...new Set(blockers)],
    });
  }

  return plan;
}

function printPlan(plan: LegacyMergePlan[]) {
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
            name: item.keep.canonicalName,
            securityProfileId: item.keep.securityProfile?.id ?? null,
            holdings: item.keep.holdingsAsSecurity.length,
          },
          drop: item.drop.map((entity) => ({
            id: entity.id,
            name: entity.canonicalName,
            securityProfileId: entity.securityProfile?.id ?? null,
            holdings: entity.holdingsAsSecurity.length,
            mentions: entity._count.mentions,
            relations: entity._count.relationsAsSrc + entity._count.relationsAsDst,
          })),
          holdingsToRewrite: item.holdingIdsToRewrite.length,
          blockers: item.blockers,
        })),
        summary: {
          duplicateGroups: plan.length,
          securityEntitiesToDelete: plan.reduce((sum, item) => sum + item.drop.length, 0),
          holdingsToRewrite: plan.reduce((sum, item) => sum + item.holdingIdsToRewrite.length, 0),
          blockedGroups: plan.filter((item) => item.blockers.length > 0).length,
        },
      },
      null,
      2,
    ),
  );
}

async function applyPlan(plan: LegacyMergePlan[]) {
  for (const item of plan) {
    if (item.blockers.length > 0) continue;
    await db.$transaction(async (tx) => {
      if (item.holdingIdsToRewrite.length > 0) {
        await tx.holding.updateMany({
          where: { id: { in: item.holdingIdsToRewrite } },
          data: { securityEntityId: item.keep.id },
        });
      }

      await tx.entity.deleteMany({
        where: { id: { in: item.drop.map((entity) => entity.id) } },
      });
    });
  }
}

async function main() {
  const plan = await buildPlan();
  printPlan(plan);
  if (dryRun) return;
  await applyPlan(plan);
  console.log("[cleanup-duplicate-security-entities] done");
}

main()
  .catch((err) => {
    console.error("[cleanup-duplicate-security-entities] fatal", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
