import { describe, expect, it } from "vitest";
import {
  calculateAffo,
  calculateFfoPerShare,
  calculateNoi,
  calculateOccupancy,
  calculateSameStoreNoiGrowth,
} from "@/lib/reit-metrics";

describe("REIT metric formulas", () => {
  it("calculates NOI from property revenue and operating expenses", () => {
    expect(calculateNoi(140, 20)).toBe(120);
    expect(calculateNoi(140, null)).toBeNull();
    expect(calculateNoi(0, 20)).toBeNull();
  });

  it("calculates occupancy from leased and available area", () => {
    expect(calculateOccupancy(90, 100)).toBeCloseTo(0.9);
    expect(calculateOccupancy(110, 100)).toBeNull();
    expect(calculateOccupancy(90, 0)).toBeNull();
  });

  it("calculates same-store NOI growth only from a positive base", () => {
    expect(calculateSameStoreNoiGrowth(110, 100)).toBeCloseTo(0.1);
    expect(calculateSameStoreNoiGrowth(110, 0)).toBeNull();
  });

  it("calculates AFFO with explicit recurring capex and adjustments", () => {
    expect(calculateAffo(100, 15, 2)).toBe(87);
    expect(calculateAffo(100, null)).toBeNull();
  });

  it("calculates FFO per diluted share and unit", () => {
    expect(calculateFfoPerShare(1_000, 100)).toBe(10);
    expect(calculateFfoPerShare(1_000, 0)).toBeNull();
  });
});
