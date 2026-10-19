import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCompanyCapitalAllocationTool } from "./get-company-capital-allocation.js";
import { getCompanyValuationTool } from "./get-company-valuation.js";

type ToolOutput = {
  content: Array<{ text: string }>;
  details: unknown;
};

const executeCapital = (getCompanyCapitalAllocationTool as unknown as {
  execute(id: string, params: { company: string }): Promise<ToolOutput>;
}).execute;
const executeValuation = (getCompanyValuationTool as unknown as {
  execute(id: string, params: { company: string }): Promise<ToolOutput>;
}).execute;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  process.env.AGENT_SECRET = "test-secret";
  process.env.APP_ORIGIN = "https://example.test";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.AGENT_SECRET;
  delete process.env.APP_ORIGIN;
});

describe("computed company metric tools", () => {
  it("calls the internal metrics endpoint with the shared secret", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({
      available: true,
      view: "capital_allocation",
      company: { name: "Apple Inc.", ticker: "AAPL", tradingCurrency: "USD" },
      latestFiscalYear: 2024,
      periodCount: 5,
      stats: {
        annuals: [{
          year: 2024,
          operatingCashFlow: 100,
          capEx: 20,
          repurchaseAmt: 30,
          dividendsPaid: 10,
          shares: 1000,
        }],
        earliestYear: 2024,
        latestYear: 2024,
        periodCount: 1,
        flowCoverage: 1,
        cumOcf: 100,
        cumCapEx: 20,
        cumFcf: 80,
        cumBuybacks: 30,
        cumDividends: 10,
        buybackCoverage: 1,
        dividendCoverage: 1,
        sharesStart: 1000,
        sharesEnd: 1000,
        shareDeltaPct: 0,
        avgRoe: 20,
      },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const output = await executeCapital("test", { company: "AAPL" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url.toString()).toContain("/api/internal/company-metrics");
    expect(url.toString()).toContain("company=AAPL");
    expect(url.toString()).toContain("view=capital_allocation");
    expect(init.headers["X-Agent-Secret"]).toBe("test-secret");
    expect(output.content[0].text).toContain("Capital Allocation");
    expect(output.content[0].text).toContain("Cumulative FCF");
  });

  it("formats valuation metrics without recommending a trade", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({
      available: true,
      view: "valuation",
      company: { name: "Apple Inc.", ticker: "AAPL", tradingCurrency: "USD" },
      asOf: { priceDate: "2026-10-18", fiscalYear: 2025 },
      latestPrice: 250,
      currentPe: 30,
      currentPb: 40,
      benchmarkPe: 25,
      benchmarkPb: 35,
      valuationStatus: "overvalued",
      valuationDiffPct: 20,
      valuationAnchorLabel: "盈利与自由现金流",
      valuationCurrencyAvailable: true,
      eps: 8,
      bps: 6,
      epsGrowthCagrPct: 10,
      roeAvg5Y: 30,
      fcfBasis: "fcf",
      priceToFcf: 25,
      priceToOcf: 20,
      historicalPe: { peMin: 15, peMedian: 25, peMax: 40, currentPercentile: 80, sampleCount: 100 },
      historicalPb: { pbMin: 20, pbMedian: 30, pbMax: 45, currentPercentile: 90, sampleCount: 100 },
      latestAnnual: { year: 2025, revenue: 100, netIncome: 20, operatingCashFlow: 30, capEx: 5, freeCashFlow: 25 },
      missing: [],
    })));

    const output = await executeValuation("test", { company: "AAPL" });
    expect(output.content[0].text).toContain("Valuation");
    expect(output.content[0].text).toContain("Current PE");
    expect(output.content[0].text).toContain("2026-10-18");
    expect(output.content[0].text).toContain("not a recommendation");
    expect(output.content[0].text).not.toContain("买入");
  });

  it("surfaces endpoint errors without returning stale analysis", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: "Unauthorized" }, 401)));

    const output = await executeCapital("test", { company: "AAPL" });

    expect(output.content[0].text).toContain("Capital allocation lookup failed");
    expect(output.content[0].text).toContain("Unauthorized");
  });
});
