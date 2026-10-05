import { describe, expect, it } from "vitest";
import { getCikLookupVariants, normalizeCik, unpadCik } from "../src/lib/cik";

describe("normalizeCik", () => {
  it("pads unpadded CIK strings to 10 digits", () => {
    expect(normalizeCik("1855612")).toBe("0001855612");
    expect(normalizeCik("320193")).toBe("0000320193");
    expect(normalizeCik("14693")).toBe("0000014693");
  });

  it("handles numbers directly", () => {
    expect(normalizeCik(1855612)).toBe("0001855612");
    expect(normalizeCik(320193)).toBe("0000320193");
  });

  it("handles strings already padded to 10 digits", () => {
    expect(normalizeCik("0001855612")).toBe("0001855612");
    expect(normalizeCik("0000320193")).toBe("0000320193");
  });

  it("strips CIK or US- prefixes and non-digit characters", () => {
    expect(normalizeCik("CIK0001855612")).toBe("0001855612");
    expect(normalizeCik("cik1855612")).toBe("0001855612");
    expect(normalizeCik("us-0001855612")).toBe("0001855612");
    expect(normalizeCik("  CIK 320193 \n")).toBe("0000320193");
  });

  it("returns null for null, undefined, whitespace, or invalid input", () => {
    expect(normalizeCik(null)).toBeNull();
    expect(normalizeCik(undefined)).toBeNull();
    expect(normalizeCik("")).toBeNull();
    expect(normalizeCik("   ")).toBeNull();
    expect(normalizeCik("0")).toBeNull();
    expect(normalizeCik("0000000000")).toBeNull();
    expect(normalizeCik("abc")).toBeNull();
  });
});

describe("unpadCik", () => {
  it("strips leading zeros from CIK", () => {
    expect(unpadCik("0001855612")).toBe("1855612");
    expect(unpadCik("1855612")).toBe("1855612");
    expect(unpadCik("0000014693")).toBe("14693");
  });

  it("returns null for invalid inputs", () => {
    expect(unpadCik(null)).toBeNull();
    expect(unpadCik("")).toBeNull();
    expect(unpadCik("0")).toBeNull();
  });
});

describe("getCikLookupVariants", () => {
  it("returns both padded and unpadded strings when they differ", () => {
    expect(getCikLookupVariants("1855612")).toEqual(["0001855612", "1855612"]);
    expect(getCikLookupVariants("0001855612")).toEqual(["0001855612", "1855612"]);
  });

  it("returns empty array for invalid input", () => {
    expect(getCikLookupVariants(null)).toEqual([]);
    expect(getCikLookupVariants("")).toEqual([]);
  });
});
