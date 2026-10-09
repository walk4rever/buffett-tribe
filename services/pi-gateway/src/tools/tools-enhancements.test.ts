import { describe, expect, it } from "vitest";
import { resolveArtifactType } from "./get-company-analysis.js";
import { formatPriceHistory } from "./get-stock-price-history.js";
import { formatHoldingsAcrossMasters } from "./search-holdings.js";

describe("resolveArtifactType", () => {
  it("resolves primary artifact types directly", () => {
    expect(resolveArtifactType("overview")).toBe("overview");
    expect(resolveArtifactType("canvas")).toBe("canvas");
    expect(resolveArtifactType("moat")).toBe("moat");
    expect(resolveArtifactType("management")).toBe("management");
    expect(resolveArtifactType("valuation")).toBe("valuation");
  });

  it("normalizes case and resolves aliases", () => {
    expect(resolveArtifactType("company_profile")).toBe("overview");
    expect(resolveArtifactType("BUSINESS_OVERVIEW")).toBe("canvas");
    expect(resolveArtifactType("value_analysis")).toBe("moat");
    expect(resolveArtifactType("management_analysis")).toBe("management");
    expect(resolveArtifactType("valuation_analysis")).toBe("valuation");
  });

  it("returns null for unknown artifact types or undefined", () => {
    expect(resolveArtifactType(undefined)).toBeNull();
    expect(resolveArtifactType("unknown_type")).toBeNull();
  });
});

describe("formatPriceHistory", () => {
  it("returns notice when price rows are empty", () => {
    const res = formatPriceHistory("Apple (AAPL)", []);
    expect(res).toContain("未在数据库中找到 Apple (AAPL) 的历史股价记录");
  });

  it("formats price statistics and 52-week metrics correctly", () => {
    const mockRows = [
      { ticker: "AAPL", date: "2024-03-20", close: "180.00", high: "182.00", low: "179.00", volume: "10000" },
      { ticker: "AAPL", date: "2024-02-20", close: "150.00", high: "155.00", low: "148.00", volume: "10000" },
      { ticker: "AAPL", date: "2023-10-20", close: "200.00", high: "205.00", low: "195.00", volume: "10000" },
      { ticker: "AAPL", date: "2023-03-20", close: "120.00", high: "125.00", low: "115.00", volume: "10000" },
    ];
    const res = formatPriceHistory("Apple (AAPL)", mockRows);
    expect(res).toContain("Apple (AAPL) 股价与走势概况");
    expect(res).toContain("**最新收盘价**: 180.00");
    expect(res).toContain("52周价格区间");
    expect(res).toContain("205.00");
    expect(res).toContain("115.00");
    expect(res).toContain("115.00");
  });
});

describe("formatHoldingsAcrossMasters", () => {
  it("returns notice when no holdings are found", () => {
    const res = formatHoldingsAcrossMasters([], "TSLA");
    expect(res).toContain('未发现任何追踪的投资大师持有 "TSLA"');
  });

  it("formats holding list across multiple investors", () => {
    const mockRows = [
      {
        holder_tribe_id: "buffett",
        holder_name: "沃伦·巴菲特 (Warren Buffett)",
        security_ticker: "AAPL",
        title_of_class: "COM",
        pct: 42.5,
        shares: "915000000",
        value_usd: "150000000000",
        change_pct: -1.2,
        is_new: false,
        company_name: "Apple Inc.",
        company_ticker: "AAPL",
        period_year: 2024,
        period_quarter: 2,
      },
    ];
    const res = formatHoldingsAcrossMasters(mockRows, "AAPL");
    expect(res).toContain("Apple Inc.");
    expect(res).toContain("沃伦·巴菲特 (Warren Buffett)");
    expect(res).toContain("42.50%");
    expect(res).toContain("变动: -1.2%");
  });
});
