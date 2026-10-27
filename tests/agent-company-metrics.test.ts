import { describe, expect, it } from "vitest";
import {
  buildCapitalAllocationAgentPayload,
  buildValuationAgentPayload,
} from "@/lib/agent-company-metrics";
import { resolveFinancialModel } from "@/lib/financial-model";
import type { ValueLineData } from "@/lib/value-line-data";

const annual = {
  year: 2024,
  revenue: 1000,
  netIncome: 100,
  operatingCashFlow: 150,
  capEx: 50,
  freeCashFlow: 100,
  shareholdersEquity: 500,
  eps: 5,
  shares: 20,
  repurchaseAmt: 20,
  dividendsPaid: 10,
  roe: 20,
};

function data(overrides: Partial<ValueLineData> = {}): ValueLineData {
  return {
    entityId: "entity-1",
    ticker: "AAPL",
    canonicalName: "Apple Inc.",
    nameZh: "苹果",
    sector: "Technology",
    industry: "Consumer Electronics",
    exchange: "NASDAQ",
    market: "us",
    reportingCurrency: "USD",
    tradingCurrency: "USD",
    valuationCurrencyAvailable: true,
    valuationAnnuals: [annual],
    annuals: [annual, { ...annual, year: 2023, eps: 4 }],
    latestPrice: 100,
    latestPriceDate: "2026-10-18",
    pricePoints: [{ date: "2026-10-18", close: 100 }],
    peRatio: 20,
    pbRatio: 4,
    benchmarkPe: 18,
    benchmarkPb: 3.5,
    historicalPePoints: [{ date: "2026-10-18", close: 100, eps: 5, pe: 20 }],
    historicalPbPoints: [{ date: "2026-10-18", close: 100, bps: 25, pb: 4 }],
    valuationStatus: "fair",
    valuationDiffPct: 5,
    roeAvg5Y: 20,
    financialModel: resolveFinancialModel("industrial")!,
    ...overrides,
  } as ValueLineData;
}

describe("agent company metric payloads", () => {
  it("returns computed capital allocation stats", () => {
    const payload = buildCapitalAllocationAgentPayload(data());
    expect(payload.available).toBe(true);
    if (!payload.available) return;
    expect(payload.latestFiscalYear).toBe(2024);
    expect(payload.stats.cumFcf).toBe(200);
    expect(payload.stats.cumBuybacks).toBe(40);
  });

  it("returns insufficient annuals instead of falling back to legacy data", () => {
    const payload = buildCapitalAllocationAgentPayload(data({
      annuals: [annual],
    }));
    expect(payload.available).toBe(false);
    if (payload.available) return;
    expect(payload.reason).toBe("insufficient_annuals");
  });

  it("returns computed valuation metrics", () => {
    const payload = buildValuationAgentPayload(data());
    expect(payload.available).toBe(true);
    expect(payload.currentPe).toBe(20);
    expect(payload.currentPb).toBe(4);
    expect(payload.valuationAnchorLabel).toBe("P/E");
    expect(payload.historicalPe.currentPercentile).toBe(100);
    expect(payload.latestAnnual?.year).toBe(2024);
  });

  it("marks missing price rather than inventing a valuation", () => {
    const payload = buildValuationAgentPayload(data({
      latestPrice: null,
      latestPriceDate: null,
      pricePoints: [],
    }));
    expect(payload.available).toBe(false);
    expect(payload.missing).toContain("stock_price");
  });

  it("returns the implemented P/B method for a non-P/E sector", () => {
    const payload = buildValuationAgentPayload(data({
      financialModel: resolveFinancialModel("real_estate")!,
    }));

    expect(payload.valuationAnchorLabel).toBe("P/B");
  });
});
