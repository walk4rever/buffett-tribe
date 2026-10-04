import { describe, expect, it } from "vitest";
import {
  getPersistedSectorClassificationStatus,
  shouldSkipSectorClassification,
} from "../src/lib/sector-classification-state";

describe("persisted sector classification state", () => {
  it("accepts a consistent current LLM classification", () => {
    expect(
      getPersistedSectorClassificationStatus("banks", {
        source: "llm",
        type: "banks",
        outcome: "classified",
        inputsHash: "hash-1",
      }),
    ).toBe("classified");
  });

  it("reads classification metadata nested inside Entity.metadata", () => {
    expect(
      getPersistedSectorClassificationStatus("banks", {
        industry: "Commercial Bank",
        sectorModel: {
          source: "llm",
          type: "banks",
          outcome: "classified",
          inputsHash: "hash-1",
        },
      }),
    ).toBe("classified");
  });

  it("accepts pre-outcome LLM metadata when the 13-way type and hash agree", () => {
    expect(
      getPersistedSectorClassificationStatus("banks", {
        source: "llm",
        type: "banks",
        inputsHash: "hash-1",
      }),
    ).toBe("classified");
  });

  it("accepts an explicit unknown result only when both stored types are null", () => {
    expect(
      getPersistedSectorClassificationStatus(null, {
        source: "llm",
        type: null,
        outcome: "unknown",
        inputsHash: "hash-1",
      }),
    ).toBe("unknown");
    expect(
      getPersistedSectorClassificationStatus("unsupported", {
        source: "llm",
        type: null,
        outcome: "unknown",
        inputsHash: "hash-1",
      }),
    ).toBe("invalid");
  });

  it("rejects legacy values and metadata that disagrees with the stored field", () => {
    expect(
      getPersistedSectorClassificationStatus("unsupported", {
        source: "llm",
        type: "banks",
        outcome: "classified",
        inputsHash: "hash-1",
      }),
    ).toBe("invalid");
    expect(
      getPersistedSectorClassificationStatus("insurance", {
        source: "llm",
        type: "banks",
        outcome: "classified",
        inputsHash: "hash-1",
      }),
    ).toBe("invalid");
  });

  it("recognizes a consistent human classification without requiring an input hash", () => {
    expect(
      getPersistedSectorClassificationStatus("real_estate", {
        source: "human",
        type: "real_estate",
      }),
    ).toBe("classified");
  });

  it("skips unchanged valid results, but retries stale or inconsistent records", () => {
    const metadata = {
      source: "llm",
      type: "banks",
      outcome: "classified",
      inputsHash: "same-hash",
    };

    expect(shouldSkipSectorClassification("banks", metadata, "same-hash")).toBe(true);
    expect(shouldSkipSectorClassification("unsupported", metadata, "same-hash")).toBe(false);
    expect(shouldSkipSectorClassification("banks", metadata, "new-hash")).toBe(false);
  });

  it("treats unknown as a completed result for unchanged evidence", () => {
    expect(
      shouldSkipSectorClassification(
        null,
        { source: "llm", type: null, outcome: "unknown", inputsHash: "same-hash" },
        "same-hash",
      ),
    ).toBe(true);
  });

  it("force retries LLM results but never overrides a valid human lock", () => {
    expect(
      shouldSkipSectorClassification(
        "banks",
        { source: "llm", type: "banks", outcome: "classified", inputsHash: "same-hash" },
        "same-hash",
        true,
      ),
    ).toBe(false);
    expect(
      shouldSkipSectorClassification(
        "banks",
        { source: "human", type: "banks" },
        "new-hash",
        true,
      ),
    ).toBe(true);
  });

  it("does not overwrite a human-owned legacy value without an explicit migration decision", () => {
    expect(
      shouldSkipSectorClassification(
        "unsupported",
        { source: "human", type: "unsupported" },
        "new-hash",
        true,
      ),
    ).toBe(true);
  });
});
