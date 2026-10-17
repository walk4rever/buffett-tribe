import { describe, expect, it, vi } from "vitest";
import type db from "@/lib/prisma";
import { resolveCompanyReportingCurrency } from "../scripts/lib/cn-hk-currency-resolve";

describe("resolveCompanyReportingCurrency", () => {
  it("resolves from CN_HK_SEEDS first", async () => {
    // 1299.HK (AIA) reports in USD
    const aia = await resolveCompanyReportingCurrency({
      ticker: "1299.HK",
      market: "hk",
    });
    expect(aia).toBe("USD");

    // 9992.HK (Pop Mart) reports in CNY
    const popmart = await resolveCompanyReportingCurrency({
      ticker: "9992.HK",
      market: "hk",
    });
    expect(popmart).toBe("CNY");
  });

  it("prefers registered reportingCurrency on Entity if valid", async () => {
    const res = await resolveCompanyReportingCurrency({
      ticker: "0700.HK",
      market: "hk",
      reportingCurrency: "CNY",
    });
    expect(res).toBe("CNY");
  });

  it("defaults US market and US tickers to USD", async () => {
    const us1 = await resolveCompanyReportingCurrency({
      ticker: "AAPL",
      market: "us",
    });
    expect(us1).toBe("USD");

    const us2 = await resolveCompanyReportingCurrency({
      ticker: "MSFT",
    });
    expect(us2).toBe("USD");
  });

  it("defaults CN market and A-share ticker suffixes to CNY", async () => {
    const cn1 = await resolveCompanyReportingCurrency({
      ticker: "600519.SS",
      market: "cn",
    });
    expect(cn1).toBe("CNY");

    const cn2 = await resolveCompanyReportingCurrency({
      ticker: "300750.SZ",
    });
    expect(cn2).toBe("CNY");

    const cn3 = await resolveCompanyReportingCurrency({
      ticker: "830001.BJ",
    });
    expect(cn3).toBe("CNY");
  });

  it("inspects existing Financial table unit when id is provided for HK company", async () => {
    const mockDb = {
      financial: {
        findFirst: vi.fn().mockResolvedValue({ unit: "USD" }),
      },
      extSource: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      filingSection: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    } as unknown as typeof db;

    const hkFin = await resolveCompanyReportingCurrency(
      {
        id: "mock_hk_entity",
        ticker: "9999.HK",
        market: "hk",
      },
      mockDb,
    );
    expect(hkFin).toBe("USD");
    expect(mockDb.financial.findFirst).toHaveBeenCalledWith({
      where: { entityId: "mock_hk_entity", unit: { in: ["CNY", "HKD", "USD"] } },
      select: { unit: true },
    });
  });

  it("falls back to HKD for unspecified HK company when no unit or report exists", async () => {
    const mockDb = {
      financial: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      extSource: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      filingSection: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    } as unknown as typeof db;

    const hkDefault = await resolveCompanyReportingCurrency(
      {
        id: "mock_hk_entity_empty",
        ticker: "0000.HK",
        market: "hk",
      },
      {
        dbClient: mockDb,
        yfResolver: vi.fn().mockReturnValue(null),
      },
    );
    expect(hkDefault).toBe("HKD");
  });

  it("uses yfResolver when available for HK company", async () => {
    const mockDb = {
      financial: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      extSource: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      filingSection: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    } as unknown as typeof db;

    const hkYf = await resolveCompanyReportingCurrency(
      {
        id: "mock_hk_entity_yf",
        ticker: "0992.HK",
        market: "hk",
      },
      {
        dbClient: mockDb,
        yfResolver: vi.fn().mockReturnValue("USD"),
      },
    );
    expect(hkYf).toBe("USD");
  });
});
