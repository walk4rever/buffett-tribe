/**
 * Validate the metric certification universe against the current database.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/eval-metric-contract.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import db from "../src/lib/prisma";
import {
  parseMetricContract,
  rolesForMetric,
} from "./lib/metric-contract-registry";

type ValidationCompany = {
  ticker: string;
  name: string;
  market: "us" | "cn" | "hk";
  template: string;
  sectorModelType: string;
  subModel: string | null;
  modifier: string | null;
  role: string;
  onboardingStatus: "available" | "onboarding_required";
};

type ValidationSuite = {
  version: number;
  name: string;
  companies: ValidationCompany[];
};

const SUITE_PATH = path.join(
  process.cwd(),
  "scripts",
  "lib",
  "metric-validation-suite.json",
);
const METRICS_PATH = path.join(process.cwd(), "METRICS.md");

function loadSuite(): ValidationSuite {
  return JSON.parse(readFileSync(SUITE_PATH, "utf8")) as ValidationSuite;
}

async function main() {
  const suite = loadSuite();
  const metricRows = parseMetricContract(
    readFileSync(METRICS_PATH, "utf8"),
  );
  const inScopeMetrics = metricRows.filter((row) => row.status !== "排除");
  const excludedMetrics = metricRows.filter((row) => row.status === "排除");
  const implementedMetrics = inScopeMetrics.filter(
    (row) => row.status === "已实现",
  );
  const partialMetrics = inScopeMetrics.filter((row) => row.status === "部分");
  const missingMetrics = inScopeMetrics.filter((row) => row.status === "缺失");
  const metricsWithoutRole = inScopeMetrics.filter(
    (row) => rolesForMetric(row).length === 0,
  );
  const companyCandidates = suite.companies.flatMap((company) => {
    const bare = company.ticker.replace(/\.(SS|SZ)$/, "");
    return [
      { ticker: company.ticker },
      { ticker: bare },
      { code: bare },
    ];
  });
  const entities = await db.entity.findMany({
    where: { type: "company", OR: companyCandidates },
    select: {
      id: true,
      ticker: true,
      code: true,
      canonicalName: true,
      sectorModelType: true,
      _count: { select: { financials: true } },
    },
  });
  if (entities.length !== suite.companies.length) {
    throw new Error(
      `Expected ${suite.companies.length} unique company entities, got ${entities.length}`,
    );
  }
  const entityIds = entities.map((entity) => entity.id);
  const annualRows = entityIds.length
    ? await db.financial.findMany({
        where: {
          entityId: { in: entityIds },
          periodType: "FY",
        },
        select: { entityId: true, periodEnd: true },
      })
    : [];
  const annualYearsByEntity = new Map<string, Set<string>>();
  for (const row of annualRows) {
    const key = row.periodEnd.toISOString().slice(0, 10);
    const years = annualYearsByEntity.get(row.entityId) ?? new Set<string>();
    years.add(key);
    annualYearsByEntity.set(row.entityId, years);
  }
  const priceTickerCandidates = suite.companies.flatMap((company) => {
    const bare = company.ticker.replace(/\.(SS|SZ)$/, "");
    return [company.ticker, bare];
  });
  const priceCounts = await db.stockPrice.groupBy({
    by: ["ticker"],
    where: { ticker: { in: priceTickerCandidates } },
    _count: { _all: true },
  });
  const pricesByTicker = new Map(
    priceCounts.map((row) => [row.ticker, row._count._all]),
  );

  const results: Array<{
    ticker: string;
    market: string;
    role: string;
    entity: boolean;
    annualYears: number;
    priceRows: number;
    sectorModelType: string | null;
    pass: boolean;
    reason: string | null;
  }> = [];

  for (const company of suite.companies) {
    const bare = company.ticker.replace(/\.(SS|SZ)$/, "");
    const entity =
      entities.find((candidate) => candidate.ticker === company.ticker) ??
      entities.find((candidate) => candidate.code === bare) ??
      entities.find((candidate) => candidate.ticker === bare);
    if (!entity) {
      results.push({
        ticker: company.ticker,
        market: company.market,
        role: company.role,
        entity: false,
        annualYears: 0,
        priceRows: 0,
        sectorModelType: null,
        pass: false,
        reason: "entity_or_financials_missing",
      });
      continue;
    }

    const annualYears = annualYearsByEntity.get(entity.id)?.size ?? 0;
    const priceRows =
      (entity.ticker ? pricesByTicker.get(entity.ticker) : undefined) ??
      pricesByTicker.get(company.ticker) ??
      pricesByTicker.get(bare) ??
      0;
    const sectorMatches =
      entity.sectorModelType === company.sectorModelType ||
      (company.sectorModelType === "capital_markets" &&
        entity.sectorModelType === "capital_markets");

    results.push({
      ticker: company.ticker,
      market: company.market,
      role: company.role,
      entity: true,
      annualYears,
      priceRows,
      sectorModelType: entity.sectorModelType,
      pass: annualYears >= 5 && priceRows > 0 && sectorMatches,
      reason: !sectorMatches
        ? `sector_mismatch:${entity.sectorModelType ?? "null"}`
        : annualYears < 5
          ? "insufficient_annual_years"
          : priceRows === 0
            ? "stock_prices_missing"
            : null,
    });
  }

  const missing = results.filter((result) => !result.entity);
  const failed = results.filter((result) => result.entity && !result.pass);
  const passed = results.filter((result) => result.pass);

  console.log(
    [
      `Metric validation suite v${suite.version}`,
      `Companies: ${suite.companies.length}`,
      `Metric rows: ${metricRows.length}`,
      `In-scope metrics: ${inScopeMetrics.length}`,
      `Excluded metrics: ${excludedMetrics.length}`,
      `Implemented metrics: ${implementedMetrics.length}`,
      `Partial metrics: ${partialMetrics.length}`,
      `Missing metrics: ${missingMetrics.length}`,
      `Metrics without validation role: ${metricsWithoutRole.length}`,
      `Passed current baseline: ${passed.length}`,
      `Failed current baseline: ${failed.length}`,
      `Missing entities: ${missing.length}`,
      "",
      "Current failures:",
      ...failed.map(
        (result) =>
          `${result.ticker} (${result.market}/${result.role}): ${result.reason}`,
      ),
      ...missing.map(
        (result) =>
          `${result.ticker} (${result.market}/${result.role}): ${result.reason}`,
      ),
      ...metricsWithoutRole.map((metric) => `ORPHAN METRIC: ${metric.name}`),
    ].join("\n"),
  );

  if (failed.length || missing.length || metricsWithoutRole.length) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("Metric validation suite failed to run:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
