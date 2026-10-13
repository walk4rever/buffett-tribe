import { describe, expect, it } from "vitest";

import { CN_HK_SEEDS } from "../scripts/lib/cn-hk-company-seeds";
import { getAiaCorrectedFinancialUnit } from "../scripts/lib/aia-currency-repair-core";

describe("AIA currency basis", () => {
  it("keeps the official reporting currency separate from AkShare value units", () => {
    expect(CN_HK_SEEDS["1299.HK"].currency).toBe("USD");
    expect(CN_HK_SEEDS["1299.HK"].financialDataCurrency).toBe("CNY");
  });

  it("corrects only USD-denominated AkShare unit labels without changing other units", () => {
    expect(getAiaCorrectedFinancialUnit("USD")).toBe("CNY");
    expect(getAiaCorrectedFinancialUnit("USD/shares")).toBe("CNY/shares");
    expect(getAiaCorrectedFinancialUnit("shares")).toBe("shares");
    expect(getAiaCorrectedFinancialUnit("HKD")).toBe("HKD");
    expect(getAiaCorrectedFinancialUnit(null)).toBeNull();
  });
});
