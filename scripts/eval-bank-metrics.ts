/**
 * Audit the bank-specific fact and calculation chain for the three bank
 * representatives in the validation suite.
 *
 * Usage:
 *   npm run eval:bank-metrics
 *   npm run eval:bank-metrics -- --strict
 *   npm run eval:bank-metrics -- --certification
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import db from "../src/lib/prisma";
import {
  classifyFinancialLineage,
  combineFinancialLineage,
} from "./lib/financial-lineage";
import {
  calculateNim,
  calculateNplRatio,
  calculateProvisionCoverage,
} from "../src/lib/bank-metrics";

type ValidationSuite = {
  companies: Array<{
    ticker: string;
    market: "us" | "cn" | "hk";
    role: string;
  }>;
};

const SUITE_PATH = path.join(
  process.cwd(),
  "scripts",
  "lib",
  "metric-validation-suite.json",
);
const FIELDS = [
  "GrossLoans",
  "NetLoans",
  "LoanLossAllowance",
  "NonPerformingLoans",
  "EarningAssets",
  "NetInterestIncome",
  "NIM",
  "NonPerformingLoanRatio",
  "ProvisionCoverage",
  "CET1Ratio",
] as const;

function candidates(ticker: string) {
  const bare = ticker.replace(/\.(SS|SZ)$/, "");
  return [{ ticker }, { ticker: bare }, { code: bare }];
}

function withinTolerance(actual: number | null, expected: number | null) {
  if (actual == null || expected == null) return false;
  return Math.abs(actual - expected) <= Math.max(0.001, Math.abs(expected) * 0.02);
}

async function main() {
  const strict = process.argv.includes("--strict");
  const certification = process.argv.includes("--certification");
  const fixtureMode =
    process.argv.includes("--allow-fixtures") ||
    process.argv.includes("--fixture-certification");
  const fixtureCertification =
    process.argv.includes("--fixture-certification");
  const suite = JSON.parse(
    readFileSync(SUITE_PATH, "utf8"),
  ) as ValidationSuite;
  const companies = suite.companies.filter((company) => company.role === "bank");
  const entities = await db.entity.findMany({
    where: {
      type: "company",
      OR: companies.flatMap((company) => candidates(company.ticker)),
    },
    select: { id: true, ticker: true, code: true },
  });
  if (entities.length !== companies.length) {
    throw new Error(`Expected ${companies.length} bank entities, got ${entities.length}`);
  }

  const results = [];
  for (const company of companies) {
    const bare = company.ticker.replace(/\.(SS|SZ)$/, "");
    const entity =
      entities.find((candidate) => candidate.ticker === company.ticker) ??
      entities.find((candidate) => candidate.code === bare) ??
      entities.find((candidate) => candidate.ticker === bare);
    if (!entity) throw new Error(`Entity not found: ${company.ticker}`);

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
        unit: true,
        mappingRule: true,
        source: { select: { kind: true, url: true } },
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
        const values = Object.fromEntries(
          periodRows.map((row) => [
            row.lineItem,
            row.value == null ? null : Number(row.value),
          ]),
        );
        const calculatedNim = calculateNim(
          values.NetInterestIncome ?? null,
          values.EarningAssets ?? null,
        );
        const calculatedNplRatio = calculateNplRatio(
          values.NonPerformingLoans ?? null,
          values.GrossLoans ?? null,
        );
        const calculatedCoverage = calculateProvisionCoverage(
          values.LoanLossAllowance ?? null,
          values.NonPerformingLoans ?? null,
        );
        const sourceComplete =
          periodRows.length > 0 &&
          periodRows.every((row) => row.source?.kind != null);
        const mappingComplete =
          periodRows.length > 0 &&
          periodRows.every(
            (row) => row.mappingRule != null && row.mappingRule.trim() !== "",
          );
        const inputLineage =
          periodRows.length === 0
            ? "missing"
            : combineFinancialLineage(
                periodRows.map((row) =>
                  classifyFinancialLineage({
                    sourceKind: row.source?.kind ?? null,
                    mappingRule: row.mappingRule,
                  }),
                ),
              );

        return {
          periodEnd,
          grossLoans: values.GrossLoans ?? null,
          netLoans: values.NetLoans ?? null,
          nonPerformingLoans: values.NonPerformingLoans ?? null,
          loanLossAllowance: values.LoanLossAllowance ?? null,
          earningAssets: values.EarningAssets ?? null,
          nim: values.NIM ?? null,
          calculatedNim,
          nplRatio: values.NonPerformingLoanRatio ?? null,
          calculatedNplRatio,
          provisionCoverage: values.ProvisionCoverage ?? null,
          calculatedCoverage,
          cet1Ratio: values.CET1Ratio ?? null,
          sourceComplete,
          mappingComplete,
          inputLineage,
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
                Number(period.periodEnd.slice(0, 4)) ===
                latestYear - offset,
            ),
          );
    const coverage = (field: keyof NonNullable<typeof latest>) =>
      fiveYear.filter((period) => period?.[field] != null).length;
    const pipelineYears = fiveYear.filter(
      (period) => period?.inputLineage === "pipeline",
    ).length;

    results.push({
      ticker: company.ticker,
      market: company.market,
      latest,
      fiveYearTotal: fiveYear.filter(Boolean).length,
      pipelineYears,
      fiveYearCoverage: {
        grossLoans: coverage("grossLoans"),
        netLoans: coverage("netLoans"),
        npl: coverage("nonPerformingLoans"),
        allowance: coverage("loanLossAllowance"),
        earningAssets: coverage("earningAssets"),
        nim: coverage("nim"),
        nplRatio: coverage("nplRatio"),
        provisionCoverage: coverage("provisionCoverage"),
        cet1: coverage("cet1Ratio"),
      },
    });
  }

  for (const result of results) {
    const latest = result.latest;
    console.log(
      [
        result.ticker,
        latest?.periodEnd ?? "-",
        `grossLoans=${latest?.grossLoans ?? "-"}`,
        `npl=${latest?.nonPerformingLoans ?? "-"}`,
        `allowance=${latest?.loanLossAllowance ?? "-"}`,
        `nim=${latest?.nim ?? "-"} (calc=${latest?.calculatedNim ?? "-"})`,
        `nplRatio=${latest?.nplRatio ?? "-"} (calc=${latest?.calculatedNplRatio ?? "-"})`,
        `coverage=${latest?.provisionCoverage ?? "-"} (calc=${latest?.calculatedCoverage ?? "-"})`,
        `cet1=${latest?.cet1Ratio ?? "-"}`,
        `source=${latest?.sourceComplete ? "complete" : "incomplete"}`,
        `mapping=${latest?.mappingComplete ? "complete" : "incomplete"}`,
        `lineage=${latest?.inputLineage ?? "missing"}`,
      ].join(" "),
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
        latest.grossLoans == null ||
        latest.netLoans == null ||
        latest.nonPerformingLoans == null ||
        latest.loanLossAllowance == null ||
        latest.nim == null ||
        latest.nplRatio == null ||
        latest.provisionCoverage == null ||
        latest.cet1Ratio == null ||
        !withinTolerance(latest.nim, latest.calculatedNim) ||
        !withinTolerance(latest.nplRatio, latest.calculatedNplRatio) ||
        !withinTolerance(
          latest.provisionCoverage,
          latest.calculatedCoverage,
        ) ||
        !latest.sourceComplete ||
        !latest.mappingComplete ||
        (!fixtureMode && latest.inputLineage !== "pipeline")
      );
    });
    if (failures.length) {
      console.error(
        `Strict bank audit failed: ${failures
          .map((result) => result.ticker)
          .join(", ")}`,
      );
      process.exitCode = 1;
    }
  }
  if (certification || fixtureCertification) {
    const failures = results.filter((result) =>
      Object.values(result.fiveYearCoverage).some(
        (count) =>
          result.fiveYearTotal < 5 ||
          count / result.fiveYearTotal < 0.8,
      ) ||
      (!fixtureMode && result.pipelineYears < 5),
    );
    if (failures.length) {
      console.error(
        `Bank certification failed: ${failures
          .map((result) => result.ticker)
          .join(", ")}`,
      );
      process.exitCode = 1;
    }
  }
}

main()
  .catch((error) => {
    console.error("Bank audit failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
