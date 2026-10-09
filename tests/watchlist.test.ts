import { describe, it, expect } from "vitest";
import { normalizeTicker } from "@/lib/ticker";

describe("Watchlist logic and ticker normalization", () => {
  it("normalizes US, HK and CN tickers consistently", () => {
    expect(normalizeTicker("aapl")).toBe("AAPL");
    expect(normalizeTicker(" 0700.hk ")).toBe("0700.HK");
    expect(normalizeTicker("600519.sh")).toBe("600519.SH");
  });

  it("handles duplicate tickers and case insensitivity", () => {
    const list = ["AAPL", "0700.HK"];
    const input = "aapl";
    const normalizedInput = normalizeTicker(input)!;
    const isAlreadyWatched = list.some((t) => t.toUpperCase() === normalizedInput.toUpperCase());
    expect(isAlreadyWatched).toBe(true);

    const filtered = list.filter((t) => t.toUpperCase() !== normalizedInput.toUpperCase());
    expect(filtered).toEqual(["0700.HK"]);
  });
});
