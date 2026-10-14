import { describe, expect, it } from "vitest";
import { DERIVED_RULES, deriveForPeriod, derivedMappingRule, type FactRow } from "../scripts/lib/derived-metrics";

const row = (lineItem: string, value: number, unit: string | null = "USD"): FactRow => ({
  lineItem,
  value,
  unit,
  sourceId: "src-1",
});

describe("deriveForPeriod", () => {
  it("补出缺失的毛利", () => {
    const { derived, skipped } = deriveForPeriod([row("Revenue", 1000), row("CostOfRevenue", 400)]);
    expect(derived).toHaveLength(1);
    expect(derived[0].key).toBe("GrossProfit");
    expect(derived[0].value).toBe(600);
    expect(skipped.some((s) => s.key === "GrossProfit")).toBe(false);
  });

  it("已有值时不覆盖", () => {
    const { derived, skipped } = deriveForPeriod([row("Revenue", 1000), row("CostOfRevenue", 400), row("GrossProfit", 555)]);
    expect(derived).toHaveLength(0);
    expect(skipped.find((s) => s.key === "GrossProfit")?.reason).toContain("已有");
  });

  it("输入缺失时留空，不拿半个数拼", () => {
    expect(deriveForPeriod([row("Revenue", 1000)]).derived).toHaveLength(0);
    expect(deriveForPeriod([row("CostOfRevenue", 400)]).derived).toHaveLength(0);
    // 银行、保险这类没有营业成本的业务线，天然不参与派生
    const bank = deriveForPeriod([row("TotalAssets", 1), row("NetInterestIncome", 2)]);
    expect(bank.derived).toHaveLength(0);
  });

  it("单位不一致时拒绝派生", () => {
    const { derived, skipped } = deriveForPeriod([row("Revenue", 1000, "USD"), row("CostOfRevenue", 400, "CNY")]);
    expect(derived).toHaveLength(0);
    expect(skipped.find((s) => s.key === "GrossProfit")?.reason).toContain("单位不一致");
  });

  it("负毛利照算，不当成异常", () => {
    const { derived } = deriveForPeriod([row("Revenue", 100), row("CostOfRevenue", 150)]);
    expect(derived[0].value).toBe(-50);
  });

  it("派生值自带溯源标记", () => {
    const { derived } = deriveForPeriod([row("Revenue", 1000), row("CostOfRevenue", 400)]);
    expect(derivedMappingRule(derived[0].rule)).toBe("derived:Revenue - CostOfRevenue");
    expect(derived[0].rule.confidence).toBeLessThan(1);
    expect(derived[0].sourceId).toBe("src-1");
  });

  it("规则表里的公式引用的都是真实存在的科目", async () => {
    const { CANONICAL_FINANCIAL_DICTIONARY } = await import("../src/lib/canonical-financial-dictionary");
    const keys = new Set(CANONICAL_FINANCIAL_DICTIONARY.map((i) => i.key));
    for (const rule of DERIVED_RULES) {
      expect(keys.has(rule.key)).toBe(true);
      for (const token of rule.formula) {
        if (token === "+" || token === "-") continue;
        expect(keys.has(token)).toBe(true);
      }
    }
  });
});
