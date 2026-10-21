import { describe, expect, it, vi } from "vitest";
import {
  formatPriceHistory,
  queryStockPrices,
  type PriceRow,
} from "./get-stock-price-history.js";

describe("formatPriceHistory", () => {
  it("returns not found message when rows are empty", () => {
    const text = formatPriceHistory("可口可乐 (KO)", []);
    expect(text).toContain("未在数据库中找到 可口可乐 (KO) 的历史股价记录。");
  });

  it("calculates 52-week high, low and percentages correctly for a clean series", () => {
    const mockRows: PriceRow[] = [
      { ticker: "KO", date: "2026-10-16", close: "93.90", high: "93.90", low: "91.50", volume: "10000" },
      { ticker: "KO", date: "2026-10-15", close: "92.00", high: "94.10", low: "91.80", volume: "10000" },
      { ticker: "KO", date: "2026-09-30", close: "86.08", high: "87.52", low: "85.90", volume: "10000" },
      { ticker: "KO", date: "2026-09-18", close: "88.25", high: "88.29", low: "87.50", volume: "10000" },
      { ticker: "KO", date: "2025-10-20", close: "80.00", high: "81.00", low: "79.00", volume: "10000" },
    ];

    const text = formatPriceHistory("可口可乐 (KO)", mockRows);

    // Latest close should be 93.90
    expect(text).toContain("**最新收盘价**: 93.90");
    // 52-week high is 94.10, low is 79.00
    expect(text).toContain("最高 94.10");
    expect(text).toContain("最低 79.00");
    // diff to high: (93.90 - 94.10) / 94.10 ≈ -0.2%
    expect(text).toContain("距52周最高点 -0.2%");
  });
});

describe("queryStockPrices candidate resolution", () => {
  it("strictly isolates KO from TKO and does not use wildcard matching", async () => {
    let capturedCandidateQuery: unknown[] | null = null;
    let capturedFinalQueryTicker: string | null = null;

    const mockPool = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        if (sql.includes('WHERE ticker = ANY($1)')) {
          capturedCandidateQuery = params[0] as unknown[];
          // Simulate database having KO and TKO
          return { rows: [{ ticker: "KO" }] };
        }
        if (sql.includes('WHERE ticker = $1')) {
          capturedFinalQueryTicker = params[0] as string;
          return {
            rows: [
              { ticker: "KO", date: "2026-10-16", close: "93.90", high: "93.90", low: "91.50", volume: "10000" },
              { ticker: "KO", date: "2026-09-18", close: "88.25", high: "88.29", low: "87.50", volume: "10000" },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    const rows = await queryStockPrices("KO", mockPool as unknown as import("pg").Pool);

    // Verified: Candidate tickers must NOT contain % or TKO
    expect(capturedCandidateQuery).toBeDefined();
    expect(capturedCandidateQuery).toContain("KO");
    for (const c of capturedCandidateQuery as string[]) {
      expect(c).not.toContain("%");
      expect(c).not.toBe("TKO");
    }

    // Verified: Final query must strictly lock to KO
    expect(capturedFinalQueryTicker).toBe("KO");
    expect(rows).toHaveLength(2);
    expect(rows[0].ticker).toBe("KO");
  });

  it("pads pure digits for HK stocks to 5 digits", async () => {
    let capturedCandidates: string[] = [];

    const mockPool = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        if (sql.includes('WHERE ticker = ANY($1)')) {
          capturedCandidates = params[0] as string[];
          return { rows: [{ ticker: "00700" }] };
        }
        return { rows: [] };
      }),
    };

    await queryStockPrices("700", mockPool as unknown as import("pg").Pool);
    expect(capturedCandidates).toContain("00700");
    expect(capturedCandidates).toContain("00700.HK");
  });
});
