import { describe, expect, it } from "vitest";
import {
  extractCnReitFacts,
  extractCnReitPairFacts,
  extractLinkReitFacts,
  extractLinkReitSeriesFacts,
  extractSpgReitFacts,
} from "../scripts/lib/reit-report-extractor";

describe("SPG 10-K extraction", () => {
  it("extracts NOI, FFO, occupancy, and FFO per share", () => {
    const facts = extractSpgReitFacts([
      {
        section: "item_7_mda",
        text: `
          Ending occupancy for our U.S. Malls and Premium Outlets decreased
          0.1% to 96.4% as of December 31, 2025.

          Dilutive FFO allocable to common stockholders $ 4,027,116
          Diluted FFO per share $ 12.34

          Beneficial interest of Portfolio NOI $ 6,117,188 $ 5,843,881
        `,
      },
    ]);

    expect(facts.noi?.value).toBe(6_117_188);
    expect(facts.ffo?.value).toBe(4_027_116);
    expect(facts.occupancy?.value).toBeCloseTo(0.964);
    expect(facts.ffoPerShare?.value).toBe(12.34);
  });
});

describe("CN and HK REIT annual-report extraction", () => {
  it("extracts the CN REIT project revenue, expenses, and occupancy", () => {
    const facts = extractCnReitFacts([
      {
        section: "cn_annual_report_1",
        text: `
          期末出租率 % 87.38 91.90
          营业收入 140,687,370.24 134,154,131.98
          营业成本/费用 19,630,006.69 23,689,498.01
        `,
      },
    ], 2025);

    expect(facts.propertyRevenue?.value).toBe(140_687_370.24);
    expect(facts.propertyOperatingExpenses?.value).toBe(19_630_006.69);
    expect(facts.occupancy?.value).toBeCloseTo(0.8738);
    expect(facts.noi?.value).toBeCloseTo(121_057_363.55);
  });

  it("extracts Link REIT net property income and Hong Kong retail occupancy", () => {
    const facts = extractLinkReitFacts([
      {
        section: "hk_annual_report_4",
        text: `
          物業收入淨額 10,230 10,619 10,070
          年末租用率 – 零售 % 97.8 97.8 98.0
        `,
      },
    ]);

    expect(facts.noi?.value).toBe(10_230);
    expect(facts.occupancy?.value).toBeCloseTo(0.978);
  });

  it("extracts current and prior-year CN REIT columns from one report", () => {
    const facts = extractCnReitPairFacts([
      {
        section: "cn_annual_report_1",
        text: `
          期末出租率 % 87.38 91.90
          营业成本/费用 19,630,006.69 23,689,498.01
        `,
      },
      {
        section: "cn_annual_report_2",
        text: "营业收入 11.5.7.15 140,687,370.24 134,154,131.98",
      },
    ]);

    expect(facts.propertyRevenue.map((fact) => fact.value)).toEqual([
      140_687_370.24, 134_154_131.98,
    ]);
    expect(facts.noi[0].value).toBeCloseTo(121_057_363.55);
    expect(facts.occupancy[1].value).toBeCloseTo(0.919);
  });

  it("extracts the five-year Link REIT series from one annual report", () => {
    const facts = extractLinkReitSeriesFacts([
      {
        section: "hk_annual_report_4",
        text: `
          物業收入淨額 10,230 10,619 10,070 9,198 8,776
          年末租用率 – 零售 % 97.8 97.8 98.0 98.0 97.7
        `,
      },
    ]);

    expect(facts.noi.map((fact) => fact.value)).toEqual([
      10_230, 10_619, 10_070, 9_198, 8_776,
    ]);
    expect(facts.occupancy[0].value).toBeCloseTo(0.978);
    expect(facts.occupancy[4].value).toBeCloseTo(0.977);
  });
});
