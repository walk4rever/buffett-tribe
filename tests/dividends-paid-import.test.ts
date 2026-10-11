import { describe, expect, it } from "vitest";
import { findBestFactValue, LINE_ITEMS } from "../scripts/lib/annual-report-import-core";

describe("DividendsPaid financial mapping", () => {
  it("registers a cash-flow line item for cash dividends paid", () => {
    const item = LINE_ITEMS.find((lineItem) => lineItem.key === "DividendsPaid");

    expect(item).toBeDefined();
    expect(item?.periodType).toBe("duration");
    expect(item?.tagsUsGaap).toContain("PaymentsOfDividendsCommonStock");
    expect(item?.tagsIfrs).toContain("DividendsPaid");
  });

  it("reads a reported annual dividend cash outflow from SEC CompanyFacts", () => {
    const value = findBestFactValue(
      {
        facts: {
          "us-gaap": {
            PaymentsOfDividendsCommonStock: {
              units: {
                USD: [
                  {
                    end: "2024-12-31",
                    filed: "2025-02-15",
                    form: "10-K",
                    val: -125000000,
                  },
                ],
              },
            },
          },
        },
      },
      ["PaymentsOfDividendsCommonStock"],
      [],
      ["USD"],
      "2024-12-31",
    );

    expect(value).toBe(-125000000);
  });
});
