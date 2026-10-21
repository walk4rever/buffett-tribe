import { describe, expect, it } from "vitest";

import { targetFor, type RetryExhaustedRow } from "../scripts/backfill-retry-exhausted-stage";

function row(overrides: Partial<RetryExhaustedRow> = {}): RetryExhaustedRow {
  return {
    id: "entity-1",
    ticker: "TEST",
    onboardPhase: 0,
    retryExhaustedStage: null,
    priority: 0,
    metadata: {},
    ...overrides,
  };
}

describe("targetFor retryExhaustedStage backfill", () => {
  it("moves phase-1 exhausted rows out of phase=-1", () => {
    expect(
      targetFor(
        row({ onboardPhase: -1 }),
        { onboardPhase1Attempts: 3 },
      ),
    ).toEqual({ phase: 0, stage: 1, kind: "phase1_dead" });
  });

  it("marks phase-2 exhausted rows without changing their phase", () => {
    expect(
      targetFor(
        row({ onboardPhase: 1 }),
        { onboardPhase2Attempts: 3 },
      ),
    ).toEqual({ phase: 1, stage: 2, kind: "phase2_dead" });
  });

  it("keeps excluded entities at phase -1 with no retry stage", () => {
    expect(
      targetFor(
        row({ onboardPhase: -1 }),
        { isExcluded: true, onboardPhase1Attempts: 3 },
      ),
    ).toEqual({ phase: -1, stage: null, kind: "excluded" });
  });

  it("clears stale stages for active or retryable rows", () => {
    expect(
      targetFor(
        row({ onboardPhase: 1, retryExhaustedStage: 2 }),
        { onboardPhase2Attempts: 1 },
      ),
    ).toEqual({
      phase: 1,
      stage: null,
      kind: "retryable_or_recovered",
    });
  });
});
