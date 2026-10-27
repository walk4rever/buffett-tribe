import { describe, expect, it } from "vitest";

import {
  findBestFactValue,
  LINE_ITEMS,
  parseInlineXbrlDocument,
  pickInlineFactWithUnit,
} from "../scripts/lib/annual-report-import-core";

describe("findBestFactValue", () => {
  it("returns the source XBRL currency for foreign-currency statements", () => {
    const facts = {
      facts: {
        "ifrs-full": {
          Revenue: {
            units: {
              EUR: [{
                end: "2025-12-31",
                filed: "2026-02-18",
                form: "20-F",
                val: 1000,
              }],
            },
          },
        },
      },
    };

    expect(
      findBestFactValue(
        facts as never,
        [],
        ["Revenue"],
        ["USD", "CNY", "HKD"],
        "2025-12-31",
      ),
    ).toMatchObject({ value: 1000, unit: "EUR" });
  });

  it("does not guess a reporting currency from generic unit candidate order", () => {
    const facts = {
      facts: {
        "us-gaap": {
          Revenue: {
            units: {
              EUR: [{ end: "2025-12-31", filed: "2026-02-18", form: "10-K", val: 90 }],
              USD: [{ end: "2025-12-31", filed: "2026-02-18", form: "10-K", val: 100 }],
            },
          },
        },
      },
    };

    expect(
      findBestFactValue(
        facts as never,
        ["Revenue"],
        [],
        ["USD", "EUR"],
        "2025-12-31",
      ),
    ).toBeNull();
  });

  it("returns the selected tag and accession for provenance", () => {
    const facts = {
      facts: {
        "us-gaap": {
          Revenues: {
            units: {
              USD: [{
                end: "2025-12-31",
                filed: "2026-02-18",
                accn: "0000000000-26-000001",
                form: "10-K",
                val: 100,
              }],
            },
          },
        },
      },
    };

    expect(
      findBestFactValue(
        facts as never,
        ["Revenues"],
        [],
        ["USD"],
        "2025-12-31",
      ),
    ).toMatchObject({
      value: 100,
      unit: "USD",
      tag: "Revenues",
      accn: "0000000000-26-000001",
      filed: "2026-02-18",
    });
  });

  it("uses the latest filed currency when units reflect different filings", () => {
    const facts = {
      facts: {
        "us-gaap": {
          Revenue: {
            units: {
              EUR: [{ end: "2025-12-31", filed: "2026-02-18", form: "10-K", val: 90 }],
              USD: [{ end: "2025-12-31", filed: "2026-02-19", form: "10-K/A", val: 100 }],
            },
          },
        },
      },
    };

    expect(
      findBestFactValue(facts as never, ["Revenue"], [], ["USD", "CNY", "HKD"], "2025-12-31"),
    ).toMatchObject({ value: 100, unit: "USD" });
  });

  it("selects full-year duration facts instead of Q4 facts for annual imports", () => {
    const facts = {
      facts: {
        "us-gaap": {
          NetClientFlows: {
            units: {
              USD: [
                {
                  start: "2025-10-01",
                  end: "2025-12-31",
                  filed: "2026-02-18",
                  form: "10-K",
                  val: 260,
                },
                {
                  start: "2025-01-01",
                  end: "2025-12-31",
                  filed: "2026-02-18",
                  form: "10-K",
                  val: 1000,
                },
              ],
            },
          },
        },
      },
    };

    expect(
      findBestFactValue(
        facts as never,
        ["NetClientFlows"],
        [],
        ["USD"],
        "2025-12-31",
        "duration",
      ),
    ).toMatchObject({ value: 1000, unit: "USD" });
  });

  it("does not treat a quarterly duration fact as an annual fact", () => {
    const facts = {
      facts: {
        "us-gaap": {
          NetClientFlows: {
            units: {
              USD: [{
                start: "2025-10-01",
                end: "2025-12-31",
                filed: "2026-02-18",
                form: "10-K",
                val: 260,
              }],
            },
          },
        },
      },
    };

    expect(
      findBestFactValue(
        facts as never,
        ["NetClientFlows"],
        [],
        ["USD"],
        "2025-12-31",
        "duration",
      ),
    ).toBeNull();
  });

  it("matches extended XBRL concepts and prefers annual, consolidated facts", () => {
    const document = parseInlineXbrlDocument(`
      <xbrli:context id="FY"><xbrli:startDate>2025-01-01</xbrli:startDate><xbrli:endDate>2025-12-31</xbrli:endDate></xbrli:context>
      <xbrli:context id="Q4"><xbrli:startDate>2025-10-01</xbrli:startDate><xbrli:endDate>2025-12-31</xbrli:endDate></xbrli:context>
      <xbrli:context id="FYSegment"><xbrli:startDate>2025-01-01</xbrli:startDate><xbrli:endDate>2025-12-31</xbrli:endDate><xbrli:segment><xbrldi:explicitMember dimension="ex:ProductAxis">ex:ETFs</xbrldi:explicitMember></xbrli:segment></xbrli:context>
      <ix:nonFraction name="blk:NetClientFlows" contextRef="FYSegment" unitRef="USD" scale="6">400</ix:nonFraction>
      <ix:nonFraction name="blk:NetClientFlows" contextRef="Q4" unitRef="USD" scale="6">260</ix:nonFraction>
      <ix:nonFraction name="blk:NetClientFlows" contextRef="FY" unitRef="USD" scale="6">1000</ix:nonFraction>
    `);

    expect(
      pickInlineFactWithUnit(
        document,
        [],
        [],
        "2025-12-31",
        "duration",
        ["USD"],
        ["NetClientFlows"],
      ),
    ).toEqual({
      unitRank: 0,
      value: 1_000_000_000,
      unit: "USD",
      tag: "NetClientFlows",
    });
  });

  it("does not use a dimension-only fact as the consolidated value", () => {
    const document = parseInlineXbrlDocument(`
      <xbrli:context id="Segment">
        <xbrli:startDate>2025-01-01</xbrli:startDate>
        <xbrli:endDate>2025-12-31</xbrli:endDate>
        <xbrli:segment><xbrldi:explicitMember dimension="ex:ProductAxis">ex:ETFs</xbrldi:explicitMember></xbrli:segment>
      </xbrli:context>
      <ix:nonFraction name="blk:NetClientFlows" contextRef="Segment" unitRef="USD" scale="6">400</ix:nonFraction>
    `);

    expect(
      pickInlineFactWithUnit(
        document,
        [],
        [],
        "2025-12-31",
        "duration",
        ["USD"],
        ["NetClientFlows"],
      ),
    ).toBeNull();
  });

  it("reads custom AUM concepts from Inline XBRL using the dictionary tag", () => {
    const document = parseInlineXbrlDocument(`
      <xbrli:context id="FYEnd">
        <xbrli:instant>2025-12-31</xbrli:instant>
      </xbrli:context>
      <ix:nonFraction name="issuer:AssetsUnderManagement" contextRef="FYEnd" unitRef="USD" scale="6">12</ix:nonFraction>
    `);

    expect(
      pickInlineFactWithUnit(
        document,
        [],
        [],
        "2025-12-31",
        "instant",
        ["USD"],
        ["AssetsUnderManagement"],
      ),
    ).toEqual({
      unitRank: 0,
      value: 12_000_000,
      unit: "USD",
      tag: "AssetsUnderManagement",
    });
  });

  it("registers financial-services operating extensions for report ingestion", () => {
    const configuredItems = new Set(LINE_ITEMS.map((item) => item.key));
    const aumConfig = LINE_ITEMS.find(
      (item) => item.key === "AssetsUnderManagement",
    );

    expect(configuredItems.has("AssetsUnderManagement")).toBe(true);
    expect(configuredItems.has("NetClientFlows")).toBe(true);
    expect(configuredItems.has("InvestmentManagementFeeIncome")).toBe(true);
    expect(configuredItems.has("NetFeeAndCommissionIncome")).toBe(true);
    expect(aumConfig?.tagsCustom).toContain("AssetsUnderManagement");
  });
});
