import { describe, expect, it } from "vitest";

import { hasChineseText, issuerKey, normalizeEnglishName, resolveCompanyNamesFromMaps } from "../src/lib/company-name-map";

describe("company-name-map", () => {
  it("removes legal suffixes without leaving dangling punctuation", () => {
    expect(normalizeEnglishName("Tesla, Inc.")).toBe("Tesla");
    expect(normalizeEnglishName("Circle Internet Group, Inc.")).toBe("Circle Internet");
    expect(normalizeEnglishName("Merck & Co., Inc.")).toBe("Merck");
    expect(normalizeEnglishName("MARSH & MCLENNAN COMPANIES, INC.")).toBe("MARSH & MCLENNAN");
  });

  it("produces stable issuer keys without trailing spaces", () => {
    expect(issuerKey("Circle Internet Group, Inc.")).toBe("CIRCLE INTERNET");
    expect(issuerKey("Floor & Decor Holdings, Inc.")).toBe("FLOOR DECOR");
  });

  it("distinguishes translated Chinese names from English fallbacks", () => {
    expect(hasChineseText("特斯拉")).toBe(true);
    expect(hasChineseText("Tesla,")).toBe(false);
    expect(hasChineseText(null)).toBe(false);
  });

  it("does not use English short names as Chinese name fallbacks", () => {
    const resolved = resolveCompanyNamesFromMaps({
      ticker: "TSLA",
      canonicalName: "Tesla, Inc.",
      existingNameZh: "Tesla,",
      maps: {
        zhByTicker: new Map(),
        zhByIssuer: new Map(),
        tickerByIssuer: new Map(),
      },
    });

    expect(resolved.nameZh).toBeNull();
    expect(resolved.nameEnShort).toBe("Tesla");
  });
});
