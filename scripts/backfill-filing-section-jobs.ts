/**
 * Source-level FilingSection extraction backfill.
 *
 * Usage:
 *   npm run backfill:filing-section-jobs -- --kinds 10k --sample 20
 *   npm run backfill:filing-section-jobs -- --kinds 10k --seed-only --sample 20
 *   npm run backfill:filing-section-jobs -- --run-only --limit 20 --delay-ms 60000
 */

import fs from "node:fs";
import os from "node:os";
import prisma from "../src/lib/prisma";
import { FILING_SECTION_EXTRACTION_VERSION } from "./lib/filing-section-storage";
import {
  FILING_SOURCE_SELECT,
  type FilingSectionBackfillSource,
  processSource,
} from "./extract-10k-sections";
import { Prisma } from "@prisma/client";

const DEFAULT_KINDS = ["10k"] as const;
const DEFAULT_SAMPLE = 20;
const DEFAULT_DELAY_MS = 60_000;
const DEFAULT_MAX_ATTEMPTS = 1;
const DEFAULT_PAUSE_FILE = "tmp/filing-section-backfill.pause";

function getArg(name: string) {
  const args = process.argv.slice(2);
  return args.find((_, index) => args[index - 1] === name);
}

function hasArg(name: string) {
  return process.argv.slice(2).includes(name);
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseKinds(value: string | undefined) {
  if (!value) return [...DEFAULT_KINDS];
  const allowed = new Set(["10k", "20f", "40f"]);
  const kinds = value.split(",").map((kind) => kind.trim().toLowerCase()).filter(Boolean);
  const invalid = kinds.filter((kind) => !allowed.has(kind));
  if (invalid.length) throw new Error(`Invalid --kinds value: ${invalid.join(", ")}`);
  return [...new Set(kinds)];
}

function errorCode(error: unknown) {
  return (error as { code?: string } | null)?.code ?? (error as { name?: string } | null)?.name ?? "Error";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function seedJobs(params: {
  kinds: string[];
  sample: number;
  maxAttempts: number;
}) {
  const candidates = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT es.id
    FROM "ExtSource" es
    WHERE es.kind IN (${Prisma.join(params.kinds)})
      AND es.url IS NOT NULL
      AND (
        NOT EXISTS (SELECT 1 FROM "FilingSection" fs WHERE fs."sourceId" = es.id)
        OR EXISTS (
          SELECT 1 FROM "FilingSection" fs
          WHERE fs."sourceId" = es.id
            AND fs."extractionVersion" < ${FILING_SECTION_EXTRACTION_VERSION}
        )
      )
      AND NOT COALESCE((
        es.metadata->'filingSectionExtraction'->>'status' = 'no_sections'
        AND (es.metadata->'filingSectionExtraction'->>'version')::int >= ${FILING_SECTION_EXTRACTION_VERSION}
      ), false)
      AND NOT EXISTS (
        SELECT 1 FROM "FilingSectionExtractionJob" job
        WHERE job."sourceId" = es.id
          AND job."extractionVersion" = ${FILING_SECTION_EXTRACTION_VERSION}
          AND job.status IN ('pending', 'running', 'success', 'no_sections')
      )
    ORDER BY es."filerEntityId" ASC NULLS LAST, es."periodYear" DESC NULLS LAST, es."createdAt" ASC
    LIMIT ${params.sample}
  `);

  if (!candidates.length) return 0;

  const result = await prisma.filingSectionExtractionJob.createMany({
    data: candidates.map((candidate) => ({
      sourceId: candidate.id,
      extractionVersion: FILING_SECTION_EXTRACTION_VERSION,
      status: "pending",
      maxAttempts: params.maxAttempts,
    })),
    skipDuplicates: true,
  });

  return result.count;
}

async function acquireJob(workerId: string) {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM "FilingSectionExtractionJob"
    WHERE "extractionVersion" = ${FILING_SECTION_EXTRACTION_VERSION}
      AND status = 'pending'
      AND attempts < "maxAttempts"
      AND ("nextRunAt" IS NULL OR "nextRunAt" <= NOW())
    ORDER BY "createdAt" ASC
    LIMIT 1
  `;
  const job = rows[0] ? await prisma.filingSectionExtractionJob.findUnique({ where: { id: rows[0].id } }) : null;

  if (!job) return null;

  const claimed = await prisma.filingSectionExtractionJob.updateMany({
    where: {
      id: job.id,
      status: "pending",
    },
    data: {
      status: "running",
      attempts: { increment: 1 },
      workerId,
      lockedAt: new Date(),
      startedAt: new Date(),
      finishedAt: null,
      lastError: null,
      lastErrorCode: null,
    },
  });

  if (claimed.count !== 1) return null;

  return prisma.filingSectionExtractionJob.findUniqueOrThrow({
    where: { id: job.id },
  });
}

async function runOne(job: { id: string; sourceId: string }) {
  const startedAt = Date.now();
  const source = await prisma.extSource.findUnique({
    where: { id: job.sourceId },
    select: FILING_SOURCE_SELECT,
  });

  if (!source) {
    throw new Error(`ExtSource not found: ${job.sourceId}`);
  }

  const result = await processSource(source as FilingSectionBackfillSource, { throwOnError: true });
  const status = result.skipped || result.sections === 0 ? "no_sections" : "success";

  await prisma.filingSectionExtractionJob.update({
    where: { id: job.id },
    data: {
      status,
      sectionCount: result.sections,
      finishedAt: new Date(),
      lastDurationMs: Date.now() - startedAt,
      lockedAt: null,
      workerId: null,
      metadata: {
        sourceId: job.sourceId,
      },
    },
  });

  return { status, sections: result.sections };
}

async function markFailed(job: { id: string }, error: unknown, startedAt: number) {
  await prisma.filingSectionExtractionJob.update({
    where: { id: job.id },
    data: {
      status: "failed",
      lastError: errorMessage(error).slice(0, 4000),
      lastErrorCode: errorCode(error),
      finishedAt: new Date(),
      lastDurationMs: Date.now() - startedAt,
      lockedAt: null,
      workerId: null,
    },
  });
}

async function runJobs(params: {
  limit: number;
  delayMs: number;
  pauseFile: string;
  workerId: string;
}) {
  let processed = 0;
  while (processed < params.limit) {
    if (fs.existsSync(params.pauseFile)) {
      console.log(`[jobs] pause file exists: ${params.pauseFile}`);
      break;
    }

    const job = await acquireJob(params.workerId);
    if (!job) {
      console.log("[jobs] no pending job");
      break;
    }

    const startedAt = Date.now();
    console.log(`[jobs] running job=${job.id} source=${job.sourceId} attempt=${job.attempts}/${job.maxAttempts}`);
    try {
      const result = await runOne(job);
      console.log(`[jobs] ${result.status} job=${job.id} source=${job.sourceId} sections=${result.sections} durationMs=${Date.now() - startedAt}`);
    } catch (error) {
      await markFailed(job, error, startedAt);
      console.warn(`[jobs] failed job=${job.id} source=${job.sourceId} code=${errorCode(error)} error=${errorMessage(error)}`);
    }

    processed++;
    if (processed < params.limit && params.delayMs > 0) {
      await sleep(params.delayMs);
    }
  }

  return processed;
}

async function main() {
  const kinds = parseKinds(getArg("--kinds") ?? getArg("--kind"));
  const sample = parsePositiveInt(getArg("--sample"), DEFAULT_SAMPLE);
  const runLimit = parsePositiveInt(getArg("--limit"), sample);
  const delayMs = parsePositiveInt(getArg("--delay-ms"), DEFAULT_DELAY_MS);
  const maxAttempts = parsePositiveInt(getArg("--max-attempts"), DEFAULT_MAX_ATTEMPTS);
  const pauseFile = getArg("--pause-file") ?? DEFAULT_PAUSE_FILE;
  const seedOnly = hasArg("--seed-only");
  const runOnly = hasArg("--run-only");
  const workerId = `filing-section-${os.hostname()}-${process.pid}`;

  if (!runOnly) {
    const seeded = await seedJobs({ kinds, sample, maxAttempts });
    console.log(`[jobs] seeded=${seeded} kinds=${kinds.join(",")} sample=${sample} maxAttempts=${maxAttempts}`);
  }

  if (!seedOnly) {
    const processed = await runJobs({ limit: runLimit, delayMs, pauseFile, workerId });
    console.log(`[jobs] processed=${processed} limit=${runLimit} delayMs=${delayMs}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
