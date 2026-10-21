/**
 * Requeue retry-exhausted companies after the underlying deterministic error
 * has been fixed.
 *
 * Usage:
 *   npm run requeue:retry-exhausted -- --ticker 000863.SZ --ticker 000868.SZ --dry-run
 *   npm run requeue:retry-exhausted -- --ticker 000863.SZ --ticker 000868.SZ
 */

import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

function valuesForFlag(flag: string): string[] {
  const args = process.argv.slice(2);
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== flag) continue;
    const value = args[index + 1];
    if (value && !value.startsWith("--")) values.push(value);
  }
  return values;
}

function retryMetadataKeys(stage: number): {
  attempts: string;
  lastError: string;
  lastAttemptAt: string;
} {
  if (stage === 1) {
    return {
      attempts: "onboardPhase1Attempts",
      lastError: "onboardPhase1LastError",
      lastAttemptAt: "onboardPhase1LastAttemptAt",
    };
  }
  if (stage === 2) {
    return {
      attempts: "onboardPhase2Attempts",
      lastError: "onboardPhase2LastError",
      lastAttemptAt: "onboardPhase2LastAttemptAt",
    };
  }
  if (stage === 3) {
    return {
      attempts: "phase3Attempts",
      lastError: "phase3LastError",
      lastAttemptAt: "phase3LastAttemptAt",
    };
  }
  throw new Error(`Unsupported retry stage: ${stage}`);
}

async function main() {
  const tickers = [...new Set(
    valuesForFlag("--ticker")
      .flatMap((value) => value.split(","))
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean),
  )];
  const dryRun = process.argv.includes("--dry-run");

  if (!tickers.length) {
    throw new Error("Missing --ticker. Pass one or more --ticker values.");
  }

  const rows = await prisma.entity.findMany({
    where: {
      type: "company",
      ticker: { in: tickers },
    },
    select: {
      id: true,
      ticker: true,
      onboardPhase: true,
      retryExhaustedStage: true,
      metadata: true,
    },
    orderBy: { ticker: "asc" },
  });

  const found = new Set(rows.map((row) => row.ticker?.toUpperCase()).filter(Boolean));
  const missing = tickers.filter((ticker) => !found.has(ticker));
  if (missing.length) {
    throw new Error(`Company not found: ${missing.join(", ")}`);
  }

  const changes = rows
    .filter((row) => row.retryExhaustedStage != null)
    .map((row) => {
      const stage = row.retryExhaustedStage!;
      const keys = retryMetadataKeys(stage);
      const metadata = {
        ...((row.metadata as Record<string, unknown> | null) ?? {}),
      };
      delete metadata[keys.attempts];
      delete metadata[keys.lastError];
      delete metadata[keys.lastAttemptAt];
      metadata.requeuedFromRetryExhaustedStage = stage;
      metadata.requeuedAt = new Date().toISOString();

      return {
        id: row.id,
        ticker: row.ticker,
        fromPhase: row.onboardPhase,
        toPhase: Math.min(row.onboardPhase, Math.max(0, stage - 1)),
        stage,
        metadata,
      };
    });

  console.log(
    `[requeue-retry-exhausted] ${dryRun ? "DRY-RUN" : "LIVE"} found=${rows.length} changes=${changes.length}`,
  );
  for (const change of changes) {
    console.log(
      `  ${change.ticker ?? change.id}: stage ${change.stage} -> null, phase ${change.fromPhase} -> ${change.toPhase}`,
    );
    if (!dryRun) {
      await prisma.entity.update({
        where: { id: change.id },
        data: {
          onboardPhase: change.toPhase,
          retryExhaustedStage: null,
          metadata: change.metadata as Prisma.InputJsonValue,
        },
      });
    }
  }

  console.log(
    `[requeue-retry-exhausted] ${dryRun ? "would update" : "updated"} ${changes.length} rows`,
  );
}

main()
  .catch((error) => {
    console.error("[requeue-retry-exhausted] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
