import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { transaction, upsert } = vi.hoisted(() => ({
  transaction: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: { $transaction: transaction },
}));

import { refreshFxRates } from "../src/lib/fx-rates";

describe("refreshFxRates", () => {
  beforeEach(() => {
    transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        $executeRaw: vi.fn(async () => 0),
        fxRate: { upsert },
      }),
    );
    upsert.mockResolvedValue({});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("fetches quotes via Frankfurter ECB as primary", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          amount: 1,
          base: "EUR",
          date: "2026-10-12",
          rates: { USD: 1.1181 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await refreshFxRates(["eur"]);

    expect(result).toEqual({ updated: ["EUR"], failed: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0].toString()).toContain("api.frankfurter.app/latest?from=EUR&to=USD");
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { currency: "EUR" },
        create: expect.objectContaining({
          currency: "EUR",
          rateToUsd: expect.anything(),
          ticker: "EURUSD",
          source: "frankfurter-ecb",
        }),
      }),
    );
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("falls back to Yahoo when Frankfurter fails", async () => {
    const timestamp = Math.floor(Date.UTC(2026, 9, 9) / 1000);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("error", { status: 500 })) // Frankfurter fails
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            chart: {
              result: [
                {
                  timestamp: [timestamp],
                  indicators: { quote: [{ close: [1.16] }] },
                },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await refreshFxRates(["eur"]);

    expect(result).toEqual({ updated: ["EUR"], failed: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0].toString()).toContain("api.frankfurter.app");
    expect(new URL(String(fetchMock.mock.calls[1][0])).hostname).toBe("query1.finance.yahoo.com");
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { currency: "EUR" },
        create: expect.objectContaining({
          currency: "EUR",
          rateToUsd: expect.anything(),
          ticker: "EURUSD=X",
          source: "yahoo-chart",
        }),
      }),
    );
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("does not query Yahoo for USD or invalid currency codes", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(refreshFxRates(["USD", "shares", ""])).resolves.toEqual({
      updated: [],
      failed: [],
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
});
