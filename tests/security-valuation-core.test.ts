import { describe, expect, it } from "vitest";

import {
  adjustEpsForAdr,
  adjustSharesForAdr,
  getAdrRatio,
} from "../src/lib/security-valuation-core";

describe("ADR valuation adjustments", () => {
  it.each([
    ["TSM", 5],
    ["BABA", 8],
  ])("keeps %s price, EPS, and share count on the same ADR basis", (ticker, ratio) => {
    const ordinaryPrice = 20;
    const ordinaryEps = 4;
    const ordinaryShares = 1_000;
    const adrPrice = ordinaryPrice * ratio;
    const adrEps = adjustEpsForAdr(ordinaryEps, ratio);
    const adrShares = adjustSharesForAdr(ordinaryShares, ratio);

    expect(getAdrRatio(ticker, null)).toBe(ratio);
    expect(adrEps).toBe(ordinaryEps * ratio);
    expect(adrShares).toBe(ordinaryShares / ratio);
    expect(adrPrice / adrEps!).toBe(ordinaryPrice / ordinaryEps);
    expect(adrPrice * adrShares!).toBe(ordinaryPrice * ordinaryShares);
  });

  it("parses a represented ordinary-share ratio when no known ticker mapping exists", () => {
    expect(getAdrRatio("UNKNOWN", "REPSTG 3 COM")).toBe(3);
  });

  it("leaves values unchanged when no ADR conversion applies", () => {
    expect(adjustEpsForAdr(2, null)).toBe(2);
    expect(adjustSharesForAdr(100, null)).toBe(100);
    expect(getAdrRatio("AAPL", null)).toBeNull();
  });
});
