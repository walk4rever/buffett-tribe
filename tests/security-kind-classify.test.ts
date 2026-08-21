import { describe, expect, it } from "vitest";

import { classifySecurityKind } from "../scripts/lib/security-kind-classify";

describe("classifySecurityKind", () => {
  it("classifies common stock variants as equity", () => {
    const commonForms = [
      "COM",
      "CL A",
      "COM CL A",
      "COM NEW",
      "SHS",
      "CL A COM",
      "COMMON STOCK",
      "CLASS A COM",
      "SHS CL A",
      "CL B",
      "COM SER C",
      "COM SHS",
      "COM SHS SER C",
      "COM SER A",
      "SHS NEW",
      "SHS CLASS A",
      "COM SHS CL A",
      "COM SHS SER C",
      "COM LBTY SRM S A",
      "COMMON STOCK NEW",
      "COM CL C",
      "CL A NEW",
    ];
    for (const titleOfClass of commonForms) {
      expect(classifySecurityKind({ titleOfClass })).toEqual({ kind: "equity" });
    }
  });

  it("classifies ADRs as equity with the adr subtype", () => {
    for (const titleOfClass of ["SPONSORED ADS", "SPONS ADS", "SPONS ADS REP Z", "SPON ADR NEW"]) {
      expect(classifySecurityKind({ titleOfClass })).toEqual({ kind: "equity", subtype: "adr" });
    }
  });

  it("classifies foreign ordinary shares as equity with the foreign_ordinary subtype", () => {
    for (const titleOfClass of ["ORD SHS", "ORDINARY SHARES", "ORD", "CLASS A ORD"]) {
      expect(classifySecurityKind({ titleOfClass })).toEqual({ kind: "equity", subtype: "foreign_ordinary" });
    }
  });

  it("classifies explicit ETF labels as etf", () => {
    for (const titleOfClass of ["SEMICONDUCTR ETF", "RUS 1000 GRW ETF", "VALUE ETF"]) {
      expect(classifySecurityKind({ titleOfClass })).toEqual({ kind: "etf" });
    }
  });

  it("classifies UNIT titles as fund_trust (e.g. QQQ Trust)", () => {
    expect(classifySecurityKind({ titleOfClass: "UNIT SER 1" })).toEqual({ kind: "fund_trust" });
    expect(classifySecurityKind({ titleOfClass: "TR UNIT" })).toEqual({ kind: "fund_trust" });
  });

  it("leaves 'SH BEN INT' unclassified — it's standard REIT-as-trust common equity (e.g. Vornado Realty Trust), not a reliable fund signal", () => {
    expect(classifySecurityKind({ titleOfClass: "SH BEN INT" })).toEqual({ kind: "unclassified" });
  });

  it("classifies dated titles as right_warrant, ahead of the UNIT rule", () => {
    expect(classifySecurityKind({ titleOfClass: "RIGHT 10/10/2024" })).toEqual({ kind: "right_warrant" });
    expect(classifySecurityKind({ titleOfClass: "UNIT 99/99/9999" })).toEqual({ kind: "right_warrant" });
  });

  it("classifies convertible titles as convertible_bond", () => {
    expect(classifySecurityKind({ titleOfClass: "CONV NT" })).toEqual({ kind: "convertible_bond" });
  });

  it("classifies put/call rows as option regardless of titleOfClass", () => {
    expect(classifySecurityKind({ titleOfClass: "COM", putCall: "PUT" })).toEqual({ kind: "option" });
    expect(classifySecurityKind({ titleOfClass: "COM", putCall: "call" })).toEqual({ kind: "option" });
  });

  it("falls back to unclassified for ambiguous or unrecognized titles, never guessing from the issuer name", () => {
    for (const titleOfClass of ["MSCI SWITZERLAND", "MCAP VL IDXVIP", "S&P500 LOW VOL", "NY REGISTRY", ""]) {
      expect(classifySecurityKind({ titleOfClass })).toEqual({ kind: "unclassified" });
    }
    expect(classifySecurityKind({ titleOfClass: null })).toEqual({ kind: "unclassified" });
    expect(classifySecurityKind({})).toEqual({ kind: "unclassified" });
  });
});
