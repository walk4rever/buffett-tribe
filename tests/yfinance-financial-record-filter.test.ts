import { describe, expect, it } from "vitest";
import {
  financialRecordKey,
  filterYfinanceFinancialRecords,
} from "../scripts/lib/yfinance-financial-record-filter";
import { alignFiscalPeriod } from "../scripts/import-us-financials-yf";

const records = [
  {
    periodEnd: "2025-11-30",
    periodType: "FY",
    lineItem: "EPSBasic",
    value: 7.98,
  },
  {
    periodEnd: "2025-11-30",
    periodType: "FY",
    lineItem: "EPSDiluted",
    value: 7.98,
  },
  {
    periodEnd: "2025-11-30",
    periodType: "FY",
    lineItem: "Revenue",
    value: 35_000_000_000,
  },
];

describe("yfinance financial record filter", () => {
  it("aligns provider FY dates to the nearest canonical fiscal period", () => {
    expect(
      alignFiscalPeriod("2025-09-30", ["2025-09-27", "2024-09-28"]),
    ).toBe("2025-09-27");
    expect(
      alignFiscalPeriod("2025-09-30", ["2024-09-28"]),
    ).toBe("2025-09-30");
  });

  it("selects only requested missing line items", () => {
    const existingKeys = new Set([
      financialRecordKey({
        periodEnd: "2025-11-30",
        periodType: "FY",
        lineItem: "EPSBasic",
      }),
    ]);

    expect(
      filterYfinanceFinancialRecords(records, {
        lineItems: ["EPSBasic", "EPSDiluted"],
        missingOnly: true,
        existingKeys,
      }),
    ).toEqual([records[1]]);
  });

  it("returns every duplicate-deduplicated record by default", () => {
    expect(filterYfinanceFinancialRecords(records)).toEqual(records);
  });
});
