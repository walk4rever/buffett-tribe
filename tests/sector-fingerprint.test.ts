import { describe, expect, it } from "vitest";
import { computeSectorFingerprint, countFingerprintSignals, type FinancialRowInput } from "../src/lib/sector-fingerprint";

function rows(periodEnd: string, periodType: string, values: Record<string, number>): FinancialRowInput[] {
  return Object.entries(values).map(([lineItem, value]) => ({ periodEnd, periodType, lineItem, value }));
}

describe("computeSectorFingerprint", () => {
  it("识别资产负债表型业务（银行）：资产/营收极高、负债率极高", () => {
    const fp = computeSectorFingerprint(
      rows("2026-12-31", "FY", {
        Revenue: 200_000_000_000,
        NetIncome: 50_000_000_000,
        TotalAssets: 4_000_000_000_000,
        TotalLiabilities: 3_700_000_000_000,
        ShareholdersEquity: 300_000_000_000,
      }),
    );

    expect(fp.assetToRevenue).toBe(20);
    expect(fp.liabilitiesToAssets).toBe(0.925);
    expect(fp.netMargin).toBe(0.25);
    expect(fp.roe).toBeCloseTo(0.1667, 4);
    expect(fp.grossMargin).toBeNull();
    expect(fp.isLossMaking).toBe(false);
  });

  it("识别轻资产高毛利业务（软件）：高毛利、低资本开支、现金转化 > 1", () => {
    const fp = computeSectorFingerprint(
      rows("2026-12-31", "FY", {
        Revenue: 10_000_000_000,
        NetIncome: 3_000_000_000,
        GrossProfit: 8_500_000_000,
        TotalAssets: 20_000_000_000,
        TotalLiabilities: 5_000_000_000,
        ShareholdersEquity: 15_000_000_000,
        CapEx: 200_000_000,
        OperatingCashFlow: 3_600_000_000,
      }),
    );

    expect(fp.grossMargin).toBe(0.85);
    expect(fp.capexToRevenue).toBe(0.02);
    expect(fp.assetToRevenue).toBe(2);
    expect(fp.cashConversion).toBe(1.2);
    expect(fp.roe).toBe(0.2);
  });

  it("识别亏损（未盈利生物科技）：净利率为负、现金流为负，比率仍保留", () => {
    const fp = computeSectorFingerprint(
      rows("2026-06-30", "FY", {
        Revenue: 10_000_000,
        NetIncome: -500_000_000,
        GrossProfit: 8_000_000,
        ShareholdersEquity: 2_000_000_000,
        OperatingCashFlow: -400_000_000,
      }),
    );

    expect(fp.netMargin).toBe(-50);
    expect(fp.isLossMaking).toBe(true);
    expect(fp.cashConversion).toBe(0.8);
    expect(fp.roe).toBe(-0.25);
  });

  it("FY 优先于更晚的季报（季报营收未年化会失真）", () => {
    const fp = computeSectorFingerprint([
      ...rows("2026-01-31", "FY", { Revenue: 100, NetIncome: 10 }),
      ...rows("2026-04-30", "Q1", { Revenue: 30, NetIncome: 3 }),
    ]);

    expect(fp.periodLabel).toBe("FY2026");
    expect(fp.revenue).toBe(100);
    expect(fp.netMargin).toBe(0.1);
  });

  it("营收同比取上一个 FY，无上一期则为 null", () => {
    const withPrev = computeSectorFingerprint([
      ...rows("2026-12-31", "FY", { Revenue: 100 }),
      ...rows("2025-12-31", "FY", { Revenue: 80 }),
    ]);
    expect(withPrev.revenueYoY).toBe(0.25);
    expect(withPrev.periods).toBe(2);

    const noPrev = computeSectorFingerprint([...rows("2026-12-31", "FY", { Revenue: 100 })]);
    expect(noPrev.revenueYoY).toBeNull();
  });

  it("分母异常时不产生垃圾比率（营收为 0 / 资产缺失 / 权益为 0）", () => {
    const zeroRevenue = computeSectorFingerprint(
      rows("2026-12-31", "FY", { Revenue: 0, NetIncome: -10, TotalAssets: 5_000_000 }),
    );
    expect(zeroRevenue.assetToRevenue).toBeNull();
    expect(zeroRevenue.netMargin).toBeNull();
    expect(zeroRevenue.revenue).toBe(0);

    const missingAssets = computeSectorFingerprint(rows("2026-12-31", "FY", { Revenue: 100, NetIncome: 5 }));
    expect(missingAssets.assetToRevenue).toBeNull();
    expect(missingAssets.liabilitiesToAssets).toBeNull();

    const zeroEquity = computeSectorFingerprint(
      rows("2026-12-31", "FY", { Revenue: 100, NetIncome: 5, ShareholdersEquity: 0 }),
    );
    expect(zeroEquity.roe).toBeNull();
  });

  it("空输入与无效值不抛错", () => {
    expect(computeSectorFingerprint([]).periodLabel).toBeNull();
    expect(computeSectorFingerprint([]).periods).toBe(0);

    const withNulls = computeSectorFingerprint([
      { periodEnd: "2026-12-31", periodType: "FY", lineItem: "Revenue", value: null },
      { periodEnd: "not-a-date", periodType: "FY", lineItem: "NetIncome", value: 10 },
    ]);
    expect(withNulls.periods).toBe(0);
  });

  it("接受 Decimal 字符串形式（Prisma Decimal 序列化）", () => {
    const fp = computeSectorFingerprint(
      rows("2026-12-31", "FY", { Revenue: "1000", NetIncome: "100", TotalAssets: "5000" }),
    );
    expect(fp.netMargin).toBe(0.1);
    expect(fp.assetToRevenue).toBe(5);
  });

  it("countFingerprintSignals 反映可用信号数量", () => {
    expect(countFingerprintSignals(computeSectorFingerprint([]))).toBe(0);
    const rich = computeSectorFingerprint(
      rows("2026-12-31", "FY", {
        Revenue: 100,
        NetIncome: 10,
        GrossProfit: 60,
        TotalAssets: 300,
        TotalLiabilities: 150,
        CapEx: 5,
        OperatingCashFlow: 12,
      }),
    );
    expect(countFingerprintSignals(rich)).toBe(6);
  });
});
