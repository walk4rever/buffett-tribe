import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, expect, it, vi } from "vitest";
import type prisma from "@/lib/prisma";
import {
  acquireLock,
  releaseLock,
  computeInterCompanyDelayMs,
  selfHealDeadLetterPriorityCompanies,
  DEAD_LETTER_BACKOFF_MS,
} from "../scripts/pipeline-priority-worker";
import { isRetryableStepError, type StepCommandError } from "../scripts/lib/retryable-error";

describe("pipeline-priority-worker lock ownership & dry-run safety", () => {
  it("does not remove another process's lock file when releaseLock is called without acquiring", () => {
    const tmpDir = path.join(os.tmpdir(), `worker-lock-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    const pidFile = path.join(tmpDir, "worker.pid");

    try {
      // Simulate an active worker holding the lock (PID 1 / init or parent process)
      writeFileSync(pidFile, "999999", "utf8");
      releaseLock(pidFile);
      expect(existsSync(pidFile)).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("acquires and releases its own lock file cleanly", () => {
    const tmpDir = path.join(os.tmpdir(), `worker-lock-own-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    const pidFile = path.join(tmpDir, "worker.pid");

    try {
      expect(acquireLock(pidFile)).toBe(true);
      expect(existsSync(pidFile)).toBe(true);
      releaseLock(pidFile);
      expect(existsSync(pidFile)).toBe(false);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("selfHealDeadLetterPriorityCompanies", () => {
  it("skips all queries and writes during dry-run", async () => {
    const mockDb = {
      entity: {
        findMany: vi.fn(),
        update: vi.fn(),
      },
    } as unknown as typeof prisma;

    const count = await selfHealDeadLetterPriorityCompanies({
      dryRun: true,
      dbClient: mockDb,
    });

    expect(count).toBe(0);
    expect(mockDb.entity.findMany).not.toHaveBeenCalled();
    expect(mockDb.entity.update).not.toHaveBeenCalled();
  });

  it("enforces the 24-hour backoff window unless forceHeal (--heal-deadletter) is true", async () => {
    const nowMs = Date.parse("2026-10-18T00:00:00.000Z");
    const oneHourAgo = new Date(nowMs - 60 * 60 * 1000).toISOString();
    const twentyFiveHoursAgo = new Date(nowMs - (DEAD_LETTER_BACKOFF_MS + 60 * 60 * 1000)).toISOString();

    const mockDb = {
      entity: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "recent_dl",
            ticker: "RECENT",
            metadata: { onboardPhase1LastAttemptAt: oneHourAgo, onboardPhase1Attempts: 3 },
          },
          {
            id: "aged_dl",
            ticker: "AGED",
            metadata: { onboardPhase1LastAttemptAt: twentyFiveHoursAgo, onboardPhase1Attempts: 3 },
          },
        ]),
        update: vi.fn().mockResolvedValue({}),
      },
    } as unknown as typeof prisma;

    // Standard run: only heals AGED (>= 24h), skips RECENT (1h)
    const standardHealed = await selfHealDeadLetterPriorityCompanies({
      forceHeal: false,
      dryRun: false,
      dbClient: mockDb,
      nowMs,
    });
    expect(standardHealed).toBe(1);
    expect(mockDb.entity.update).toHaveBeenCalledTimes(1);
    expect(mockDb.entity.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "aged_dl" },
        data: expect.objectContaining({ onboardPhase: 0 }),
      }),
    );

    // Force heal (--heal-deadletter): heals both regardless of backoff window
    vi.clearAllMocks();
    const forcedHealed = await selfHealDeadLetterPriorityCompanies({
      forceHeal: true,
      dryRun: false,
      dbClient: mockDb,
      nowMs,
    });
    expect(forcedHealed).toBe(2);
    expect(mockDb.entity.update).toHaveBeenCalledTimes(2);
  });
});

describe("computeInterCompanyDelayMs", () => {
  it("adds 0..999ms random jitter to the base delay", () => {
    expect(computeInterCompanyDelayMs(1000, () => 0)).toBe(1000);
    expect(computeInterCompanyDelayMs(1000, () => 0.5)).toBe(1500);
    expect(computeInterCompanyDelayMs(1000, () => 0.999)).toBe(1999);
    expect(computeInterCompanyDelayMs(2000, () => 0.45)).toBe(2450);
  });
});

describe("isRetryableStepError", () => {
  it("classifies transient network, timeout, 429/5xx, and Prisma lock errors as retryable", () => {
    const netErr = Object.assign(new Error("npm run import:price exited with code 1"), {
      exitCode: 1,
      output: "FetchError: request to https://query1.finance.yahoo.com failed, reason: read ECONNRESET",
    }) as StepCommandError;
    expect(isRetryableStepError(netErr)).toBe(true);

    const rateLimitErr = Object.assign(new Error("npm run import:10k exited with code 1"), {
      exitCode: 1,
      output: "HTTP 429 Too Many Requests from SEC EDGAR",
    }) as StepCommandError;
    expect(isRetryableStepError(rateLimitErr)).toBe(true);

    const dbLockErr = Object.assign(new Error("npm run generate:overview exited with code 1"), {
      exitCode: 1,
      output: "PrismaClientKnownRequestError: Transaction API error: P2028",
    }) as StepCommandError;
    expect(isRetryableStepError(dbLockErr)).toBe(true);

    const timeoutErr = Object.assign(new Error("npm run slice exited with code 124"), {
      exitCode: 124,
    }) as StepCommandError;
    expect(isRetryableStepError(timeoutErr)).toBe(true);
  });

  it("classifies deterministic 4xx, validation, and missing-data errors as non-retryable", () => {
    const notFoundErr = Object.assign(new Error("npm run import:10k exited with code 1"), {
      exitCode: 1,
      output: "Error: HTTP status 404 Not Found for filing URL",
    }) as StepCommandError;
    expect(isRetryableStepError(notFoundErr)).toBe(false);

    const emptyRecordsErr = Object.assign(new Error("npm run import:cn-hk-financials exited with code 1"), {
      exitCode: 1,
      output: "Empty records file",
    }) as StepCommandError;
    expect(isRetryableStepError(emptyRecordsErr)).toBe(false);

    const invalidArgErr = new Error('Invalid --market "jp". Expected one of: us, cn, hk.');
    expect(isRetryableStepError(invalidArgErr)).toBe(false);
  });
});
