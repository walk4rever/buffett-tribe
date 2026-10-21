/**
 * Seed OnboardEvent from a priority worker log.
 *
 * Usage:
 *   node --env-file=.env.local ./node_modules/.bin/tsx scripts/backfill-onboard-events-from-log.ts --log ./tmp/mini-batch-logs/priority-worker.log --hours 72 --dry-run
 */

import fs from "node:fs";
import prisma from "@/lib/prisma";
import { classifyOnboardError } from "@/lib/onboard-error";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function durationMs(value: string): number | null {
  const minutes = Number(value.match(/(\d+)m/)?.[1] ?? 0);
  const seconds = Number(value.match(/(\d+)s/)?.[1] ?? 0);
  return minutes || seconds ? (minutes * 60 + seconds) * 1000 : null;
}

function marketOf(ticker: string): "us" | "hk" | "cn" {
  if (ticker.endsWith(".HK")) return "hk";
  if (ticker.endsWith(".SS") || ticker.endsWith(".SZ") || ticker.endsWith(".BJ")) {
    return "cn";
  }
  return "us";
}

async function main() {
  const logPath = arg("--log");
  if (!logPath) throw new Error("--log is required");
  const hours = Number(arg("--hours") ?? "72");
  const dryRun = process.argv.includes("--dry-run");
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const lines = fs.readFileSync(logPath, "utf8").split(/\r?\n/);
  const entities = await prisma.entity.findMany({
    where: { type: "company", ticker: { not: null } },
    select: { id: true, ticker: true },
  });
  const entityByTicker = new Map(
    entities.map((entity) => [entity.ticker!.toUpperCase(), entity.id]),
  );

  let batchId: string | null = null;
  const events: Array<{
    batchId: string;
    entityId: string;
    ticker: string;
    market: string;
    phase: number;
    targetPhase: number;
    result: string;
    errorCategory: string | null;
    errorMessage: string | null;
    elapsedMs: number | null;
    createdAt: Date;
  }> = [];

  for (const line of lines) {
    const batch = line.match(/^=== ([0-9T:.+\-]+) : Starting Hourly Priority Worker/);
    if (batch) {
      batchId = `log:${batch[1]}`;
      continue;
    }
    if (!batchId) continue;

    const result = line.match(
      /^\[([^\]]+)\]\s+(?:✓|✗)\s+\[\d+\/\d+\]\s+(SUCCESS|FAILED)\s+\[P(\d+)→P(\d+)\]\s+([A-Z0-9.\-]+)(?::\s*(.*?))?(?:\s+\(([^)]+)\))?$/,
    );
    if (!result) continue;

    const [, timestamp, outcome, phaseRaw, targetRaw, tickerRaw, message, elapsedRaw] = result;
    const createdAt = new Date(timestamp.replace(" ", "T"));
    if (!Number.isFinite(createdAt.getTime()) || createdAt.getTime() < cutoff) continue;
    const ticker = tickerRaw.toUpperCase();
    const entityId = entityByTicker.get(ticker);
    if (!entityId) continue;
    const phase = Number(phaseRaw);
    const targetPhase = Number(targetRaw);
    const resultValue = outcome === "SUCCESS" ? "success" : "failure";
    events.push({
      batchId,
      entityId,
      ticker,
      market: marketOf(ticker),
      phase,
      targetPhase,
      result: resultValue,
      errorCategory:
        resultValue === "failure" ? classifyOnboardError(message ?? "") : null,
      errorMessage: message?.trim() || null,
      elapsedMs: elapsedRaw ? durationMs(elapsedRaw) : null,
      createdAt,
    });
  }

  console.log(`[backfill-onboard-events] events=${events.length} dryRun=${dryRun}`);
  if (dryRun) return;
  await prisma.onboardEvent.deleteMany({ where: { batchId: { startsWith: "log:" } } });
  for (let offset = 0; offset < events.length; offset += 200) {
    await prisma.onboardEvent.createMany({ data: events.slice(offset, offset + 200) });
  }
  console.log(`[backfill-onboard-events] inserted ${events.length}`);
}

main()
  .catch((error) => {
    console.error("[backfill-onboard-events] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
