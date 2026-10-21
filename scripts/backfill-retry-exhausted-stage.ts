/**
 * Backfill retryExhaustedStage without conflating it with onboardPhase=-1.
 *
 * Usage:
 *   node --env-file=.env.local ./node_modules/.bin/tsx scripts/backfill-retry-exhausted-stage.ts --dry-run
 *   node --env-file=.env.local ./node_modules/.bin/tsx scripts/backfill-retry-exhausted-stage.ts
 */

import prisma from "@/lib/prisma";

export type RetryExhaustedRow = {
  id: string;
  ticker: string | null;
  onboardPhase: number;
  retryExhaustedStage: number | null;
  priority: number;
  metadata: unknown;
};

function attempts(meta: Record<string, unknown>, key: string): number {
  const value = Number(meta[key] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

export function targetFor(row: RetryExhaustedRow, meta: Record<string, unknown>): {
  phase: number;
  stage: number | null;
  kind: string;
} {
  const excluded = meta.isExcluded === true;
  if (row.onboardPhase === -1 && excluded) {
    return { phase: -1, stage: null, kind: "excluded" };
  }

  const attempts1 = attempts(meta, "onboardPhase1Attempts");
  const attempts2 = attempts(meta, "onboardPhase2Attempts");
  const attempts3 = attempts(meta, "phase3Attempts");

  if (row.onboardPhase === -1 && !excluded && attempts1 >= 3) {
    return { phase: 0, stage: 1, kind: "phase1_dead" };
  }
  if (row.onboardPhase === 1 && attempts2 >= 3) {
    return { phase: 1, stage: 2, kind: "phase2_dead" };
  }
  if (row.onboardPhase === 2 && attempts3 >= 3) {
    return { phase: 2, stage: 3, kind: "phase3_dead" };
  }
  if (row.onboardPhase >= 0) {
    return {
      phase: row.onboardPhase,
      stage: null,
      kind:
        attempts1 > 0 || attempts2 > 0 || attempts3 > 0
          ? "retryable_or_recovered"
          : "active_or_empty",
    };
  }
  return { phase: row.onboardPhase, stage: null, kind: "unclassified_minus1" };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : undefined;

  const select = `SELECT id, ticker, "onboardPhase", "retryExhaustedStage", priority, metadata
    FROM "Entity"
    WHERE type = 'company'`;
  const attempt = (key: string) =>
    `CASE WHEN metadata->>'${key}' ~ '^[0-9]+$' THEN (metadata->>'${key}')::int ELSE 0 END`;
  const queries: RetryExhaustedRow[][] = await Promise.all([
    prisma.$queryRawUnsafe<RetryExhaustedRow[]>(`${select}
      AND "onboardPhase" = -1
      AND COALESCE(metadata->>'isExcluded', 'false') <> 'true'
      AND ${attempt("onboardPhase1Attempts")} >= 3`),
    prisma.$queryRawUnsafe<RetryExhaustedRow[]>(`${select}
      AND "onboardPhase" = 1
      AND ${attempt("onboardPhase2Attempts")} >= 3`),
    prisma.$queryRawUnsafe<RetryExhaustedRow[]>(`${select}
      AND "onboardPhase" = 2
      AND ${attempt("phase3Attempts")} >= 3`),
    prisma.$queryRawUnsafe<RetryExhaustedRow[]>(`${select}
      AND "retryExhaustedStage" IS NOT NULL`),
  ]);
  const byId = new Map<string, RetryExhaustedRow>();
  for (const row of queries.flat()) byId.set(row.id, row);
  const rows = [...byId.values()].sort(
    (a, b) => a.onboardPhase - b.onboardPhase || (a.ticker ?? "").localeCompare(b.ticker ?? ""),
  ).slice(0, limit && Number.isFinite(limit) ? Math.max(1, Math.trunc(limit)) : undefined);

  const stats = new Map<string, number>();
  const changes: Array<{
    id: string;
    ticker: string | null;
    fromPhase: number;
    fromStage: number | null;
    toPhase: number;
    toStage: number | null;
    kind: string;
  }> = [];

  for (const row of rows) {
    const meta = row.metadata && typeof row.metadata === "object"
      ? (row.metadata as Record<string, unknown>)
      : {};
    const target = targetFor(row, meta);
    stats.set(target.kind, (stats.get(target.kind) ?? 0) + 1);
    if (target.phase === row.onboardPhase && target.stage === row.retryExhaustedStage) {
      continue;
    }
    changes.push({
      id: row.id,
      ticker: row.ticker,
      fromPhase: row.onboardPhase,
      fromStage: row.retryExhaustedStage,
      toPhase: target.phase,
      toStage: target.stage,
      kind: target.kind,
    });
  }

  console.log(`[backfill-retry-exhausted-stage] ${dryRun ? "DRY-RUN" : "LIVE"} rows=${rows.length} changes=${changes.length}`);
  for (const [kind, count] of [...stats.entries()].sort()) {
    console.log(`  ${kind.padEnd(22)} ${count}`);
  }
  for (const change of changes.slice(0, 30)) {
    console.log(
      `  ${change.ticker ?? change.id}: phase ${change.fromPhase} -> ${change.toPhase}, stage ${change.fromStage ?? "null"} -> ${change.toStage ?? "null"} (${change.kind})`,
    );
  }

  if (!dryRun) {
    for (const change of changes) {
      await prisma.entity.update({
        where: { id: change.id },
        data: {
          onboardPhase: change.toPhase,
          retryExhaustedStage: change.toStage,
        },
      });
    }
  }

  console.log(
    `[backfill-retry-exhausted-stage] ${dryRun ? "would update" : "updated"} ${changes.length} rows`,
  );
}

main()
  .catch((error) => {
    console.error("[backfill-retry-exhausted-stage] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
