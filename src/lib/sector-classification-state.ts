import { isSectorModelType13 } from "./sector-classification";

export type PersistedSectorClassificationStatus = "classified" | "unknown" | "invalid";

type SectorClassificationMetadata = {
  source?: unknown;
  type?: unknown;
  outcome?: unknown;
  inputsHash?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function getSectorClassificationMetadata(value: unknown): SectorClassificationMetadata | null {
  const record = asRecord(value);
  if (!record) return null;

  const nested = asRecord(record.sectorModel);
  return (nested ?? record) as SectorClassificationMetadata;
}

export function getPersistedSectorClassificationStatus(
  storedType: unknown,
  rawMetadata: unknown,
): PersistedSectorClassificationStatus {
  const metadata = getSectorClassificationMetadata(rawMetadata);
  if (!metadata) return "invalid";

  if (metadata.source === "human") {
    if (!isSectorModelType13(storedType)) return "invalid";
    return metadata.type == null || metadata.type === storedType ? "classified" : "invalid";
  }

  if (metadata.source !== "llm" || typeof metadata.inputsHash !== "string" || !metadata.inputsHash) {
    return "invalid";
  }

  if (
    metadata.outcome === "unknown" &&
    storedType == null &&
    metadata.type == null
  ) {
    return "unknown";
  }

  if (
    isSectorModelType13(storedType) &&
    metadata.type === storedType &&
    (metadata.outcome == null || metadata.outcome === "classified")
  ) {
    return "classified";
  }

  return "invalid";
}

export function shouldSkipSectorClassification(
  storedType: unknown,
  rawMetadata: unknown,
  currentInputsHash: string,
  force = false,
): boolean {
  const metadata = getSectorClassificationMetadata(rawMetadata);
  const status = getPersistedSectorClassificationStatus(storedType, rawMetadata);

  if (metadata?.source === "human") return true;
  if (force || status === "invalid" || metadata?.inputsHash !== currentInputsHash) return false;

  return status === "classified" || status === "unknown";
}
