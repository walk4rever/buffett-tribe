import { describe, expect, it } from "vitest";
import {
  GOLDEN_18_MATRIX,
  GOLDEN_23_SUITE,
  GOLDEN_MODIFIER_EXTENSION,
  verifyRoicSafetyBoundaries,
} from "../scripts/eval-golden-18";
import {
  buildCompanyFinancialDashboard,
  type FinancialYearItems,
} from "../src/lib/company-financial-dashboard";
import {
  FINANCIAL_MODEL_TEMPLATES,
  type FinancialModelModifier,
  type FinancialSubModel,
} from "../src/lib/financial-model";

const ALL_SUB_MODELS: FinancialSubModel[] = [
  "reit_property",
  "developer",
  "asset_mgmt",
  "broker_exchange",
  "property_casualty",
  "life_health",
];

const ALL_MODIFIERS: FinancialModelModifier[] = [
  "consumer_brand",
  "healthcare",
  "software_platform",
  "semiconductor_hardware",
  "energy_materials",
  "utilities",
  "telecommunications",
];

describe("Golden Benchmark Suite (18 Core Orthogonal + 5 Modifier Extension = 23 Flagships)", () => {
  it("enforces exact 3 Markets × 6 Templates = 18 orthogonal core matrix without duplicates", () => {
    expect(GOLDEN_18_MATRIX).toHaveLength(18);
    expect(GOLDEN_MODIFIER_EXTENSION).toHaveLength(5);
    expect(GOLDEN_23_SUITE).toHaveLength(23);

    const markets = ["us", "cn", "hk"] as const;
    for (const market of markets) {
      for (const template of FINANCIAL_MODEL_TEMPLATES) {
        const matches = GOLDEN_18_MATRIX.filter(
          (spec) => spec.market === market && spec.expectedTemplate === template,
        );
        expect(
          matches,
          `Expected exactly 1 flagship for market=${market}, template=${template}`,
        ).toHaveLength(1);
      }
    }

    const uniqueTickers = new Set(GOLDEN_23_SUITE.map((s) => s.ticker));
    expect(uniqueTickers.size).toBe(23);
  });

  it("achieves 100% coverage of all 6 templates, 6 subModels, and 7 industrial modifiers across the 23 flagships", () => {
    const coveredTemplates = new Set(GOLDEN_23_SUITE.map((s) => s.expectedTemplate));
    for (const t of FINANCIAL_MODEL_TEMPLATES) {
      expect(coveredTemplates.has(t), `Template ${t} should be covered`).toBe(true);
    }

    const coveredSubModels = new Set(
      GOLDEN_23_SUITE.map((s) => s.expectedSubModel).filter(Boolean),
    );
    for (const sub of ALL_SUB_MODELS) {
      expect(coveredSubModels.has(sub), `SubModel ${sub} should be covered`).toBe(true);
    }

    const coveredModifiers = new Set(
      GOLDEN_23_SUITE.map((s) => s.expectedModifier).filter(Boolean),
    );
    for (const mod of ALL_MODIFIERS) {
      expect(coveredModifiers.has(mod), `Modifier ${mod} should be covered`).toBe(true);
    }
  });

  it("requires official annual report Ground-Truth metrics, requiredFacts, requiredDashboardRows, and non-overlapping forbiddenDashboardRows for all 23 flagships", () => {
    for (const spec of GOLDEN_23_SUITE) {
      // 1. Ground-Truth completeness
      expect(spec.groundTruth.fiscalYear).toBeGreaterThanOrEqual(2024);
      const gtKeys = Object.keys(spec.groundTruth.metrics);
      expect(
        gtKeys.length,
        `${spec.ticker} must specify at least 4 Ground-Truth metrics`,
      ).toBeGreaterThanOrEqual(4);

      for (const [k, v] of Object.entries(spec.groundTruth.metrics)) {
        expect(
          v != null && typeof v.value === "number" && Number.isFinite(v.value),
          `${spec.ticker} Ground-Truth ${k} must be a finite number`,
        ).toBe(true);
      }

      // 2. Statutory required facts
      expect(spec.requiredFacts.length).toBeGreaterThanOrEqual(4);

      // 3. Dashboard whitelist & blacklist
      expect(
        spec.requiredDashboardRows.length,
        `${spec.ticker} must specify at least 5 requiredDashboardRows`,
      ).toBeGreaterThanOrEqual(5);
      expect(
        spec.forbiddenDashboardRows.length,
        `${spec.ticker} must specify at least 4 forbiddenDashboardRows`,
      ).toBeGreaterThanOrEqual(4);

      const reqSet = new Set(spec.requiredDashboardRows);
      for (const forbidden of spec.forbiddenDashboardRows) {
        expect(
          reqSet.has(forbidden),
          `${spec.ticker} has overlapping row ${forbidden} in requiredDashboardRows and forbiddenDashboardRows`,
        ).toBe(false);
      }
    }
  });

  it("enforces 4-quarter completeness check on all 8 A-share flagships and quarterly-reporting HK flagships (0700.HK, 0941.HK)", () => {
    const cnSpecs = GOLDEN_23_SUITE.filter((s) => s.market === "cn");
    expect(cnSpecs.length).toBe(8);
    for (const spec of cnSpecs) {
      expect(spec.checkQuarterly, `${spec.ticker} must enable checkQuarterly`).toBe(true);
    }

    const tencent = GOLDEN_23_SUITE.find((s) => s.ticker === "0700.HK");
    const chinaMobile = GOLDEN_23_SUITE.find((s) => s.ticker === "0941.HK");
    expect(tencent?.checkQuarterly).toBe(true);
    expect(chinaMobile?.checkQuarterly).toBe(true);
  });

  it("verifies deterministic L3 ROIC safety fuse boundary conditions (IC <= 0 returns null)", () => {
    const errors = verifyRoicSafetyBoundaries();
    expect(errors).toEqual([]);
  });

  it("synthesizes a realistic multi-year financial record from Ground-Truth for each of the 23 flagships and verifies Tab 2 required/forbidden rows", () => {
    for (const spec of GOLDEN_23_SUITE) {
      const baseMetrics = spec.groundTruth.metrics;
      const tradingCurrency =
        spec.market === "us" ? "USD" : spec.market === "hk" ? "HKD" : "CNY";

      const syntheticYears: FinancialYearItems[] = [2022, 2023, 2024].map((year, idx) => {
        const scale = 0.9 + idx * 0.05;
        const items: Record<string, string> = {};
        const itemUnits: Record<string, string> = {};

        const setItem = (key: string, val: number) => {
          items[key] = String(Math.round(val * scale));
          itemUnits[key] = spec.groundTruth.dataCurrency;
        };

        for (const fact of spec.requiredFacts) {
          const baseVal = baseMetrics[fact]?.value ?? 10_000_000_000;
          setItem(fact, baseVal);
        }
        for (const [fact, metricSpec] of Object.entries(baseMetrics)) {
          if (metricSpec != null) {
            setItem(fact, metricSpec.value);
          }
        }
        for (const reqRow of spec.requiredDashboardRows) {
          if (!(reqRow in items)) {
            setItem(reqRow, 5_000_000_000);
          }
        }

        const revBase = baseMetrics.Revenue?.value ?? 50_000_000_000;
        const taBase = baseMetrics.TotalAssets?.value ?? 100_000_000_000;
        const ocfBase = baseMetrics.OperatingCashFlow?.value ?? 15_000_000_000;

        if (spec.expectedTemplate === "industrial" || spec.expectedTemplate === "conglomerate") {
          items.CostOfRevenue ??= String(Math.round(revBase * 0.55 * scale));
          items.GrossProfit ??= String(Math.round(revBase * 0.45 * scale));
          items.OperatingIncome ??= String(Math.round(revBase * 0.25 * scale));
          items.CapEx ??= String(Math.round(ocfBase * 0.25 * scale));
          items.TotalDebt ??= String(Math.round(taBase * 0.2 * scale));
          items.CashAndCashEquivalents ??= String(Math.round(taBase * 0.15 * scale));
          items.TotalLiabilities ??= String(Math.round(taBase * 0.45 * scale));
        }
        if (spec.expectedTemplate === "real_estate") {
          items.OperatingIncome ??= String(Math.round(revBase * 0.35 * scale));
          items.TotalDebt ??= String(Math.round(taBase * 0.35 * scale));
          items.CashAndCashEquivalents ??= String(Math.round(taBase * 0.08 * scale));
          items.TotalLiabilities ??= String(Math.round(taBase * 0.65 * scale));
          // Even if raw data contains CapEx, real_estate/reit_property must shield CapEx & FreeCashFlow
          setItem("CapEx", 1_500_000_000);
        }
        if (spec.expectedTemplate === "insurance") {
          const premBase = baseMetrics.NetPremiumsEarned?.value ?? revBase;
          items.NetPremiumsEarned ??= String(Math.round(premBase * scale));
          items.PolicyClaimsAndBenefits ??= String(Math.round(premBase * 0.65 * scale));
          items.TotalLiabilities ??= String(Math.round(taBase * 0.85 * scale));
        }

        return {
          year,
          periodEnd: new Date(Date.UTC(year, 11, 31)),
          items,
          itemUnits,
        };
      });

      const sectorModelType =
        spec.expectedTemplate === "bank"
          ? "banks"
          : spec.expectedTemplate === "financial_services"
            ? "capital_markets"
            : spec.expectedModifier ?? spec.expectedTemplate;

      const subModelReasonHint =
        spec.expectedSubModel === "reit_property"
          ? "reit property trust"
          : spec.expectedSubModel === "developer"
            ? "property development"
            : spec.expectedSubModel === "asset_mgmt"
              ? "asset management"
              : spec.expectedSubModel === "broker_exchange"
                ? "brokerage exchange"
                : spec.expectedSubModel === "property_casualty"
                  ? "property and casualty"
                  : spec.expectedSubModel === "life_health"
                    ? "life and health insurance"
                    : spec.expectedModifier ?? "";

      const dashboard = buildCompanyFinancialDashboard(
        {
          sectorModelType,
          metadata: {
            nameZh: spec.name,
            sectorModel: {
              reason: subModelReasonHint,
            },
          },
        },
        syntheticYears,
        tradingCurrency,
        {
          reportingCurrency: spec.groundTruth.dataCurrency,
          tradingCurrency,
          fxRates: new Map([
            ["USD", 1],
            ["HKD", 0.128],
            ["CNY", 0.14],
          ]),
        },
      );

      const renderedKeys = new Set(dashboard.rows.map((r) => r.key));
      for (const reqRow of spec.requiredDashboardRows) {
        expect(
          renderedKeys.has(reqRow),
          `${spec.ticker} (${spec.expectedTemplate}) missing required row ${reqRow}`,
        ).toBe(true);
      }
      for (const forbiddenRow of spec.forbiddenDashboardRows) {
        expect(
          renderedKeys.has(forbiddenRow),
          `${spec.ticker} (${spec.expectedTemplate}) leaked forbidden row ${forbiddenRow}`,
        ).toBe(false);
      }
    }
  });
});
