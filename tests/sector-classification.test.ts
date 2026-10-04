import { describe, expect, it } from "vitest";
import {
  SECTOR_MODEL_13_CONFIG,
  SECTOR_MODEL_13_TYPES,
  getExplicitSectorModel13Info,
  getSectorModel13Info,
  isSectorModelType13,
} from "../src/lib/sector-classification";

describe("SECTOR_MODEL_13_CONFIG", () => {
  it("contains exactly 13 unique types with matching config keys", () => {
    expect(SECTOR_MODEL_13_TYPES).toHaveLength(13);
    expect(new Set(SECTOR_MODEL_13_TYPES).size).toBe(13);

    for (const type of SECTOR_MODEL_13_TYPES) {
      expect(SECTOR_MODEL_13_CONFIG[type].type).toBe(type);
    }
  });

  it("retains the distinct valuation categories that justify the 13-way model", () => {
    expect(SECTOR_MODEL_13_TYPES).toContain("energy_materials");
    expect(SECTOR_MODEL_13_TYPES).toContain("banks");
    expect(SECTOR_MODEL_13_TYPES).toContain("insurance");
    expect(SECTOR_MODEL_13_TYPES).toContain("capital_markets");
    expect(SECTOR_MODEL_13_TYPES).toContain("software_platform");
    expect(SECTOR_MODEL_13_TYPES).toContain("semiconductor_hardware");
  });

  it("provides a unique label, PE seed and definition for each type", () => {
    const labels = new Set<string>();

    for (const type of SECTOR_MODEL_13_TYPES) {
      const info = getSectorModel13Info(type);
      expect(info.label.length).toBeGreaterThan(0);
      expect(labels.has(info.label)).toBe(false);
      labels.add(info.label);
      expect(info.benchmarkPE).toBeGreaterThanOrEqual(8);
      expect(info.benchmarkPE).toBeLessThanOrEqual(40);
      expect(info.cagrMetrics.length).toBeGreaterThan(0);
      expect(info.definition).toContain("装：");
    }
  });

  it("accepts only explicit 13-way category values", () => {
    for (const type of SECTOR_MODEL_13_TYPES) {
      expect(isSectorModelType13(type)).toBe(true);
      expect(getExplicitSectorModel13Info(type)?.type).toBe(type);
    }

    for (const value of ["unsupported", "", "toString", "constructor", "__proto__", null, undefined, 7]) {
      expect(isSectorModelType13(value)).toBe(false);
      expect(getExplicitSectorModel13Info(value)).toBeNull();
    }
  });

  it("does not substitute another category for an invalid model key", () => {
    expect(() => getSectorModel13Info("unsupported" as never)).toThrow("Unknown 13-way sector model");
  });
});
