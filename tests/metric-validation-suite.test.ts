import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertMetricContract,
  parseMetricContract,
  rolesForMetric,
  type MetricContractArtifact,
} from "../scripts/lib/metric-contract-registry";
import { requirementForMetric } from "../scripts/lib/metric-contract-rules";

type ValidationCompany = {
  ticker: string;
  market: "us" | "cn" | "hk";
  template: string;
  sectorModelType: string;
  subModel: string | null;
  modifier: string | null;
  role: string;
  onboardingStatus: "available" | "onboarding_required";
  nonApplicableMetrics?: string[];
};

type ValidationSuite = {
  version: number;
  name: string;
  companies: ValidationCompany[];
};

const suite = JSON.parse(
  readFileSync("scripts/lib/metric-validation-suite.json", "utf8"),
) as ValidationSuite;
const metricsMarkdown = readFileSync("METRICS.md", "utf8");
const metricContract = JSON.parse(
  readFileSync("scripts/lib/metric-contract.json", "utf8"),
) as MetricContractArtifact;

const templates = [
  "industrial",
  "bank",
  "insurance",
  "financial_services",
  "real_estate",
  "conglomerate",
] as const;
const modifiers = [
  "consumer_brand",
  "healthcare",
  "software_platform",
  "semiconductor_hardware",
  "energy_materials",
  "utilities",
  "telecommunications",
] as const;
const expectedRoles = [
  ...modifiers,
  "bank",
  "property_casualty",
  "life_health",
  "asset_mgmt",
  "broker_exchange",
  "reit_property",
  "developer",
  "conglomerate",
] as const;

describe("99 metric validation suite", () => {
  it("fixes a 45-company, 15-per-market certification universe", () => {
    expect(suite.version).toBe(1);
    expect(suite.companies).toHaveLength(45);
    expect(new Set(suite.companies.map((company) => company.ticker)).size).toBe(45);

    for (const market of ["us", "cn", "hk"] as const) {
      expect(
        suite.companies.filter((company) => company.market === market),
      ).toHaveLength(15);
    }
  });

  it("covers every market-template combination", () => {
    for (const market of ["us", "cn", "hk"] as const) {
      const marketTemplates = new Set(
        suite.companies
          .filter((company) => company.market === market)
          .map((company) => company.template),
      );
      expect([...marketTemplates].sort()).toEqual([...templates].sort());
    }
  });

  it("covers every market role and every required submodel", () => {
    for (const market of ["us", "cn", "hk"] as const) {
      const roles = new Set(
        suite.companies
          .filter((company) => company.market === market)
          .map((company) => company.role),
      );
      expect([...roles].sort()).toEqual([...expectedRoles].sort());
    }
  });

  it("marks the full certification universe as onboarded", () => {
    const pending = suite.companies
      .filter((company) => company.onboardingStatus === "onboarding_required")
      .map((company) => company.ticker)
      .sort();

    expect(pending).toEqual([]);
  });

  it("contains exactly 99 in-scope metrics and 22 excluded rows", () => {
    const rows = parseMetricContract(metricsMarkdown);

    expect(rows.filter((row) => row.status !== "排除")).toHaveLength(99);
    expect(rows.filter((row) => row.status === "排除")).toHaveLength(22);
  });

  it("assigns every in-scope metric to at least one concrete validation role", () => {
    const rows = parseMetricContract(metricsMarkdown).filter(
      (row) => row.status !== "排除",
    );
    const orphanMetrics = rows.filter((row) => rolesForMetric(row).length === 0);

    expect(orphanMetrics.map((row) => row.name)).toEqual([]);
  });

  it("materializes a complete, stable 99-metric fact contract", () => {
    expect(() => assertMetricContract(metricContract)).not.toThrow();
    expect(new Set(metricContract.metrics.map((metric) => metric.id)).size).toBe(
      99,
    );
    expect(
      new Set(metricContract.metrics.map((metric) => metric.key)).size,
    ).toBe(99);
  });

  it("keeps the generated contract aligned with the audited Markdown", () => {
    const rows = parseMetricContract(metricsMarkdown).filter(
      (row) => row.status !== "排除",
    );

    expect(
      metricContract.metrics.map(({ id, key, name, section, status }) => ({
        id,
        key,
        name,
        section,
        status,
      })),
    ).toEqual(
      rows.map((row, index) => ({
        id: metricContract.metrics[index]?.id,
        key: metricContract.metrics[index]?.key,
        name: row.name,
        section: row.section,
        status: row.status,
      })),
    );

    for (const [index, row] of rows.entries()) {
      const metric = metricContract.metrics[index];
      expect(metric.definition).toBe(row.definition);
      expect(metric.formulaOrRule).toBe(row.formulaOrRule);
      expect(metric.source).toBe(row.source);
      expect(metric.gap).toBe(row.gap);
      expect(metric.detail).toBe(row.detail);
      expect(metric.roles).toEqual(rolesForMetric(row));
      expect(metric.requirement).toEqual(requirementForMetric(row));
    }
  });

  it("normalizes display-name whitespace before resolving direct fields", () => {
    const rows = parseMetricContract(metricsMarkdown);
    const dilutedEps = rows.find((row) => row.name === "摊薄 EPS");
    const basicEps = rows.find((row) => row.name === "基本 EPS");

    expect(dilutedEps).toBeDefined();
    expect(basicEps).toBeDefined();
    expect(requirementForMetric(dilutedEps!)).toEqual({
      alternatives: [["EPSDiluted"]],
      coverageYears: 5,
      minCoverageRatio: 0.8,
    });
    expect(requirementForMetric(basicEps!)).toEqual({
      alternatives: [["EPSBasic"]],
      coverageYears: 5,
      minCoverageRatio: 0.8,
    });
  });
});
