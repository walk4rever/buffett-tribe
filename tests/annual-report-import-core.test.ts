import { describe, expect, it } from "vitest";

import { findBestFactValue } from "../scripts/lib/annual-report-import-core";

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
    ).toEqual({ value: 1000, unit: "EUR" });
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
    ).toEqual({ value: 100, unit: "USD" });
  });
});
