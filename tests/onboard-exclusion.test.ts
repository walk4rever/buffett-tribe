import { describe, expect, it } from "vitest";
import {
  evaluateOnboardExclusion,
  isExcludedEntity,
  EXCLUSION_LABELS,
} from "../src/lib/onboard-exclusion";

describe("evaluateOnboardExclusion", () => {
  it("identifies OTC ADRs (5 letters ending in Y) and Foreign Ordinaries (ending in F)", () => {
    const tcehy = evaluateOnboardExclusion({
      ticker: "TCEHY",
      market: "us",
      canonicalName: "Tencent Holdings Ltd.",
    });
    expect(tcehy.isExcluded).toBe(true);
    expect(tcehy.reason).toBe("otc_pink_sheet");

    const byddf = evaluateOnboardExclusion({
      ticker: "BYDDF",
      market: "us",
      canonicalName: "BYD Co Ltd.",
    });
    expect(byddf.isExcluded).toBe(true);
    expect(byddf.reason).toBe("otc_pink_sheet");

    const edpfy = evaluateOnboardExclusion({
      ticker: "EDPFY",
      market: "us",
      canonicalName: "EDP - Energias de Portugal S.A.",
    });
    expect(edpfy.isExcluded).toBe(true);
    expect(edpfy.reason).toBe("otc_pink_sheet");
  });

  it("identifies bankrupt/delisted pink sheets (5 letters ending in Q)", () => {
    const sondq = evaluateOnboardExclusion({
      ticker: "SONDQ",
      market: "us",
      canonicalName: "Sonder Holdings Inc.",
    });
    expect(sondq.isExcluded).toBe(true);
    expect(sondq.reason).toBe("delisted");

    const ftchq = evaluateOnboardExclusion({
      ticker: "FTCHQ",
      market: "us",
      canonicalName: "Farfetch Ltd.",
    });
    expect(ftchq.isExcluded).toBe(true);
    expect(ftchq.reason).toBe("delisted");
  });

  it("identifies SPAC units (5 letters ending in U)", () => {
    const cparu = evaluateOnboardExclusion({
      ticker: "CPARU",
      market: "us",
      canonicalName: "Catalyst Partners Acquisition Corp.",
    });
    expect(cparu.isExcluded).toBe(true);
    expect(cparu.reason).toBe("spac_unit");
  });

  it("identifies companies listing explicitly on OTC/PINK exchanges", () => {
    const fnma = evaluateOnboardExclusion({
      ticker: "FNMA",
      market: "us",
      exchange: "OTC",
      canonicalName: "Fannie Mae",
    });
    expect(fnma.isExcluded).toBe(true);
    expect(fnma.reason).toBe("otc_pink_sheet");
  });

  it("identifies ETFs and trusts from securities metadata", () => {
    const spy = evaluateOnboardExclusion({
      ticker: "SPY",
      market: "us",
      canonicalName: "SPDR S&P 500 ETF Trust",
      securities: [{ kind: "etf" }],
    });
    expect(spy.isExcluded).toBe(true);
    expect(spy.reason).toBe("etf");

    const qqq = evaluateOnboardExclusion({
      ticker: "QQQ",
      market: "us",
      canonicalName: "Invesco QQQ Trust",
      securities: [{ kind: "fund_trust" }],
    });
    expect(qqq.isExcluded).toBe(true);
    expect(qqq.reason).toBe("fund_trust");
  });

  it("identifies acquired or delisted companies from metadata", () => {
    const splk = evaluateOnboardExclusion({
      ticker: "SPLK",
      market: "us",
      canonicalName: "Splunk Inc.",
      metadata: { unmatchedReason: "acquired" },
    });
    expect(splk.isExcluded).toBe(true);
    expect(splk.reason).toBe("acquired");

    const twtr = evaluateOnboardExclusion({
      ticker: "TWTR",
      market: "us",
      canonicalName: "Twitter Inc.",
      metadata: { delisted: true },
    });
    expect(twtr.isExcluded).toBe(true);
    expect(twtr.reason).toBe("delisted");
  });

  it("does NOT exclude legitimate operating companies (even with 5 letters like GOOGL or BRK.B)", () => {
    const googl = evaluateOnboardExclusion({
      ticker: "GOOGL",
      market: "us",
      canonicalName: "Alphabet Inc.",
    });
    expect(googl.isExcluded).toBe(false);

    const cwan = evaluateOnboardExclusion({
      ticker: "CWAN",
      market: "us",
      canonicalName: "Clearwater Analytics Holdings, Inc.",
    });
    expect(cwan.isExcluded).toBe(false);

    const aapl = evaluateOnboardExclusion({
      ticker: "AAPL",
      market: "us",
      canonicalName: "Apple Inc.",
    });
    expect(aapl.isExcluded).toBe(false);

    const tencentHk = evaluateOnboardExclusion({
      code: "00700",
      ticker: "0700.HK",
      market: "hk",
      canonicalName: "Tencent Holdings Ltd.",
    });
    expect(tencentHk.isExcluded).toBe(false);
  });

  it("respects previously marked isExcluded metadata", () => {
    const res = evaluateOnboardExclusion({
      ticker: "XYZ",
      metadata: {
        isExcluded: true,
        exclusionReason: "otc_pink_sheet",
      },
    });
    expect(res.isExcluded).toBe(true);
    expect(res.reason).toBe("otc_pink_sheet");
    expect(res.label).toBe(EXCLUSION_LABELS.otc_pink_sheet);
  });
});

describe("isExcludedEntity", () => {
  it("returns true for onboardPhase -1", () => {
    expect(isExcludedEntity({ onboardPhase: -1 })).toBe(true);
    expect(isExcludedEntity({ onboardPhase: 0 })).toBe(false);
    expect(isExcludedEntity({ onboardPhase: 1 })).toBe(false);
  });

  it("returns true for metadata.isExcluded = true", () => {
    expect(isExcludedEntity({ onboardPhase: 0, metadata: { isExcluded: true } })).toBe(true);
    expect(isExcludedEntity({ onboardPhase: 0, metadata: { isExcluded: false } })).toBe(false);
  });
});
