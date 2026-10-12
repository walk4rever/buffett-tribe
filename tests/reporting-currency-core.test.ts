import { describe, expect, it } from "vitest";

import { resolveReportingCurrency } from "../src/lib/reporting-currency-core";

describe("resolveReportingCurrency", () => {
  it("prefers the requested entity's verified currency over family results", () => {
    expect(
      resolveReportingCurrency(
        "target",
        ["target", "sibling"],
        [
          { id: "sibling", reportingCurrency: "HKD", metadata: { currency: "CNY" } },
          { id: "target", reportingCurrency: "EUR", metadata: { currency: "USD" } },
        ],
        [],
      ),
    ).toBe("EUR");
  });

  it("uses legacy metadata only after checking explicit currencies in the family", () => {
    expect(
      resolveReportingCurrency(
        "target",
        ["target", "sibling"],
        [
          { id: "target", reportingCurrency: null, metadata: { currency: "shares" } },
          { id: "sibling", reportingCurrency: "CNY", metadata: null },
        ],
        [],
      ),
    ).toBe("CNY");
  });

  it("falls back to valid financial units in deterministic family order", () => {
    expect(
      resolveReportingCurrency(
        "target",
        ["target", "sibling"],
        [],
        [
          { entityId: "sibling", unit: "HKD", periodEnd: new Date("2025-12-31") },
          { entityId: "target", unit: "USD/shares", periodEnd: new Date("2025-12-31") },
          { entityId: "target", unit: "EUR", periodEnd: new Date("2024-12-31") },
        ],
      ),
    ).toBe("EUR");
  });

  it("returns null when no valid currency is available", () => {
    expect(
      resolveReportingCurrency(
        "target",
        ["target"],
        [{ id: "target", reportingCurrency: null, metadata: { currency: "shares" } }],
        [{ entityId: "target", unit: "USD/shares", periodEnd: new Date("2025-12-31") }],
      ),
    ).toBeNull();
  });
});
