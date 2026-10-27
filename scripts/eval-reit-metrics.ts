/**
 * Audit REIT-specific facts, source provenance, and deterministic formulas.
 *
 * Usage:
 *   npm run eval:reit-metrics
 *   npm run eval:reit-metrics -- --strict
 *   npm run eval:reit-metrics -- --certification
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import db from "../src/lib/prisma";
import {
  classifyFinancialLineage,
  combineFinancialLineage,
} from "./lib/financial-lineage";
import {
  calculateFfoPerShare,
  calculateNoi,
  calculateOccupancy,
} from "../src/lib/reit-metrics";

type ReitFact = {
  ticker: string;
  periodEnd: string;
  sourcePeriodYear: number;
  values: Record<string, number>;
  requiredMetrics: string[];
  evidence: string;
  note: string;
};

type ReitFactFile = {
  version: number;
  facts: ReitFact[];
};

const INPUT_PATH = path.join(
  process.cwd(),
  "scripts",
  "lib",
  "reit-verified-facts.json",
);
const FIELDS = [
  "PropertyRevenue",
  "PropertyOperatingExpenses",
  "NOI",
  "FFO",
  "AFFO",
  "SameStoreNOIGrowth",
  "Occupancy",
  "FFOPerShare",
  "WeightedAverageSharesDiluted",
  "LeasedArea",
  "AvailableArea",
] as const;
const OUTPUT_FIELDS = new Set([
  "NOI",
  "FFO",
  "AFFO",
  "SameStoreNOIGrowth",
  "Occupancy",
  "FFOPerShare",
]);
const PERIOD_FIELD_BY_METRIC = {
  NOI: "noi",
  FFO: "ffo",
  AFFO: "affo",
  SameStoreNOIGrowth: "sameStoreNoiGrowth",
  Occupancy: "occupancy",
  FFOPerShare: "ffoPerShare",
} as const;

function withinTolerance(actual: number | null, expected: number | null) {
  if (actual == null || expected == null) return false;
  return Math.abs(actual - expected) <= Math.max(0.001, Math.abs(expected) * 0.02);
}

function entityCandidates(ticker: string) {
  const bare = ticker.replace(/\..*$/, "");
  return [{ ticker }, { ticker: bare }, { code: bare }];
}

async function main() {
  const strict = process.argv.includes("--strict");
  const certification = process.argv.includes("--certification");
  const fixtureMode =
    process.argv.includes("--allow-fixtures") ||
    process.argv.includes("--fixture-certification");
  const fixtureCertification =
    process.argv.includes("--fixture-certification");
  const input = JSON.parse(readFileSync(INPUT_PATH, "utf8")) as ReitFactFile;
  const tickers = [...new Set(input.facts.map((fact) => fact.ticker))];
  const latestFactByTicker = new Map<string, ReitFact>();
  for (const fact of input.facts) {
    const current = latestFactByTicker.get(fact.ticker);
    if (!current || fact.periodEnd > current.periodEnd) {
      latestFactByTicker.set(fact.ticker, fact);
    }
  }

  const entities = await db.entity.findMany({
    where: {
      type: "company",
      OR: tickers.flatMap(entityCandidates),
    },
    select: { id: true, ticker: true, code: true, market: true },
  });
  if (entities.length !== tickers.length) {
    throw new Error(`Expected ${tickers.length} REIT entities, got ${entities.length}`);
  }

  const results = [];
  for (const ticker of tickers) {
    const entity = entities.find(
      (candidate) =>
        candidate.ticker === ticker ||
        candidate.ticker === ticker.replace(/\..*$/, "") ||
        candidate.code === ticker.replace(/\..*$/, ""),
    );
    if (!entity) throw new Error(`Entity not found: ${ticker}`);
    const latestFact = latestFactByTicker.get(ticker);
    if (!latestFact) throw new Error(`Latest fact not found: ${ticker}`);

    const rows = await db.financial.findMany({
      where: {
        entityId: entity.id,
        periodType: "FY",
        lineItem: { in: [...FIELDS] },
      },
      select: {
        periodEnd: true,
        lineItem: true,
        value: true,
        mappingRule: true,
        source: { select: { kind: true } },
      },
    });
    const byPeriod = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = row.periodEnd.toISOString().slice(0, 10);
      const periodRows = byPeriod.get(key) ?? [];
      periodRows.push(row);
      byPeriod.set(key, periodRows);
    }

    const periods = [...byPeriod.entries()]
      .sort(([left], [right]) => right.localeCompare(left))
      .map(([periodEnd, periodRows]) => {
        const outputRows = periodRows.filter((row) =>
          OUTPUT_FIELDS.has(row.lineItem),
        );
        const values = Object.fromEntries(
          periodRows.map((row) => [
            row.lineItem,
            row.value == null ? null : Number(row.value),
          ]),
        );
        return {
          periodEnd,
          propertyRevenue: values.PropertyRevenue ?? null,
          propertyOperatingExpenses: values.PropertyOperatingExpenses ?? null,
          noi: values.NOI ?? null,
          calculatedNoi: calculateNoi(
            values.PropertyRevenue ?? null,
            values.PropertyOperatingExpenses ?? null,
          ),
          ffo: values.FFO ?? null,
          affo: values.AFFO ?? null,
          sameStoreNoiGrowth: values.SameStoreNOIGrowth ?? null,
          occupancy: values.Occupancy ?? null,
          calculatedOccupancy: calculateOccupancy(
            values.LeasedArea ?? null,
            values.AvailableArea ?? null,
          ),
          ffoPerShare: values.FFOPerShare ?? null,
          calculatedFfoPerShare: calculateFfoPerShare(
            values.FFO ?? null,
            values.WeightedAverageSharesDiluted ?? null,
          ),
          sourceComplete:
            outputRows.length > 0 &&
            outputRows.every((row) => row.source?.kind != null),
          mappingComplete:
            outputRows.length > 0 &&
            outputRows.every(
              (row) => row.mappingRule != null && row.mappingRule.trim() !== "",
            ),
          inputLineage:
            outputRows.length === 0
              ? "missing"
              : combineFinancialLineage(
                  outputRows.map((row) =>
                    classifyFinancialLineage({
                      sourceKind: row.source?.kind ?? null,
                      mappingRule: row.mappingRule,
                    }),
                  ),
                ),
        };
      });

    const latest = periods[0] ?? null;
    const latestYear =
      latest == null ? null : Number(latest.periodEnd.slice(0, 4));
    const fiveYear =
      latestYear == null
        ? []
        : Array.from({ length: 5 }, (_, offset) =>
            periods.find(
              (period) =>
                Number(period.periodEnd.slice(0, 4)) === latestYear - offset,
            ),
          );
    const coverage: Record<string, number> = {};
    for (const metric of latestFact.requiredMetrics) {
      const key =
        PERIOD_FIELD_BY_METRIC[
          metric as keyof typeof PERIOD_FIELD_BY_METRIC
        ];
      coverage[metric] =
        key == null
          ? 0
          : fiveYear.filter((period) => period?.[key] != null).length;
    }
    const pipelineYears = fiveYear.filter(
      (period) => period?.inputLineage === "pipeline",
    ).length;

    results.push({
      ticker,
      latest,
      requiredMetrics: latestFact.requiredMetrics,
      fiveYearTotal: fiveYear.filter(Boolean).length,
      fiveYearCoverage: coverage,
      pipelineYears,
    });
  }

  for (const result of results) {
    const latest = result.latest;
    console.log(
      `${result.ticker} ${latest?.periodEnd ?? "-"} NOI=${latest?.noi ?? "-"} FFO=${latest?.ffo ?? "-"} occupancy=${latest?.occupancy ?? "-"} FFO/share=${latest?.ffoPerShare ?? "-"} source=${latest?.sourceComplete ? "complete" : "incomplete"} mapping=${latest?.mappingComplete ? "complete" : "incomplete"} lineage=${latest?.inputLineage ?? "missing"}`,
    );
    console.log(
      `${result.ticker} 5y coverage ${JSON.stringify(result.fiveYearCoverage)}`,
    );
    console.log(`${result.ticker} pipeline years ${result.pipelineYears}/5`);
  }

  if (strict) {
    const failures = results.filter((result) => {
      const latest = result.latest;
      return (
        latest == null ||
        result.requiredMetrics.some((metric) => {
          const key =
            PERIOD_FIELD_BY_METRIC[
              metric as keyof typeof PERIOD_FIELD_BY_METRIC
            ];
          return key == null || latest[key] == null;
        }) ||
        (latest.noi != null &&
          latest.calculatedNoi != null &&
          !withinTolerance(latest.noi, latest.calculatedNoi)) ||
        (latest.occupancy != null &&
          latest.calculatedOccupancy != null &&
          !withinTolerance(latest.occupancy, latest.calculatedOccupancy)) ||
        (latest.ffoPerShare != null &&
          latest.calculatedFfoPerShare != null &&
          !withinTolerance(
            latest.ffoPerShare,
            latest.calculatedFfoPerShare,
          )) ||
        !latest.sourceComplete ||
        !latest.mappingComplete ||
        (!fixtureMode && latest.inputLineage !== "pipeline")
      );
    });
    if (failures.length) {
      console.error(
        `Strict REIT audit failed: ${failures
          .map((result) => result.ticker)
          .join(", ")}`,
      );
      process.exitCode = 1;
    }
  }

  if (certification || fixtureCertification) {
    const failures = results.filter(
      (result) =>
        result.fiveYearTotal < 5 ||
        Object.values(result.fiveYearCoverage).some(
          (count) => count / result.fiveYearTotal < 0.8,
        ) ||
        (!fixtureMode && result.pipelineYears < 5),
    );
    if (failures.length) {
      console.error(
        `REIT certification failed: ${failures
          .map((result) => result.ticker)
          .join(", ")}`,
      );
      process.exitCode = 1;
    }
  }
}

main()
  .catch((error) => {
    console.error("REIT audit failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
