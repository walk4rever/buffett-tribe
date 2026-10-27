/**
 * Audit insurance-specific facts, source provenance, and deterministic formulas.
 *
 * Usage:
 *   npm run eval:insurance-metrics
 *   npm run eval:insurance-metrics -- --strict
 *   npm run eval:insurance-metrics -- --certification
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import db from "../src/lib/prisma";
import {
  classifyFinancialLineage,
  combineFinancialLineage,
} from "./lib/financial-lineage";
import {
  calculateClaimsRatio,
  calculateCombinedRatio,
  calculateSolvencyRatio,
} from "../src/lib/insurance-metrics";

type InsuranceFact = {
  ticker: string;
  periodEnd: string;
  sourcePeriodYear: number;
  values: Record<string, number>;
  requiredMetrics: string[];
  evidence: string;
  note: string;
};

type InsuranceFactFile = {
  version: number;
  facts: InsuranceFact[];
};

const INPUT_PATH = path.join(
  process.cwd(),
  "scripts",
  "lib",
  "insurance-verified-facts.json",
);
const FIELDS = [
  "NetPremiumsEarned",
  "PolicyClaimsAndBenefits",
  "UnderwritingExpenses",
  "ClaimsRatio",
  "CombinedRatio",
  "TotalInvestments",
  "NetInvestmentIncome",
  "InsuranceContractLiabilities",
  "Float",
  "EV",
  "NBV",
  "NewBusinessValueMargin",
  "SolvencyRatio",
  "ActualCapital",
  "MinimumCapital",
] as const;
const OUTPUT_FIELDS_BY_METRIC: Record<string, string[]> = {
  净已赚保费: ["NetPremiumsEarned"],
  赔付与保单利益: ["PolicyClaimsAndBenefits"],
  赔付率: ["PolicyClaimsAndBenefits", "NetPremiumsEarned", "ClaimsRatio"],
  综合成本率: ["CombinedRatio"],
  投资资产组合: ["TotalInvestments"],
  保险合同负债: ["InsuranceContractLiabilities"],
  EV: ["EV"],
  NBV: ["NBV"],
  新业务价值率: ["NewBusinessValueMargin"],
  偿付能力充足率: ["SolvencyRatio"],
};
const PERIOD_FIELD_BY_METRIC = {
  净已赚保费: "netPremiumsEarned",
  赔付与保单利益: "policyClaimsAndBenefits",
  赔付率: "claimsRatio",
  综合成本率: "combinedRatio",
  投资资产组合: "totalInvestments",
  保险合同负债: "insuranceContractLiabilities",
  EV: "ev",
  NBV: "nbv",
  新业务价值率: "newBusinessValueMargin",
  偿付能力充足率: "solvencyRatio",
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
  const input = JSON.parse(readFileSync(INPUT_PATH, "utf8")) as InsuranceFactFile;
  const tickers = [...new Set(input.facts.map((fact) => fact.ticker))];
  const latestFactByTicker = new Map<string, InsuranceFact>();
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
    throw new Error(
      `Expected ${tickers.length} insurance entities, got ${entities.length}`,
    );
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
    const requiredOutputFields = new Set(
      latestFact.requiredMetrics.flatMap(
        (metric) => OUTPUT_FIELDS_BY_METRIC[metric] ?? [],
      ),
    );

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
          requiredOutputFields.has(row.lineItem),
        );
        const values = Object.fromEntries(
          periodRows.map((row) => [
            row.lineItem,
            row.value == null ? null : Number(row.value),
          ]),
        );
        return {
          periodEnd,
          netPremiumsEarned: values.NetPremiumsEarned ?? null,
          policyClaimsAndBenefits:
            values.PolicyClaimsAndBenefits ?? null,
          claimsRatio: values.ClaimsRatio ?? null,
          calculatedClaimsRatio: calculateClaimsRatio(
            values.PolicyClaimsAndBenefits ?? null,
            values.NetPremiumsEarned ?? null,
          ),
          combinedRatio: values.CombinedRatio ?? null,
          calculatedCombinedRatio: calculateCombinedRatio(
            values.PolicyClaimsAndBenefits ?? null,
            values.UnderwritingExpenses ?? null,
            values.NetPremiumsEarned ?? null,
          ),
          totalInvestments: values.TotalInvestments ?? null,
          insuranceContractLiabilities:
            values.InsuranceContractLiabilities ?? null,
          ev: values.EV ?? null,
          nbv: values.NBV ?? null,
          newBusinessValueMargin: values.NewBusinessValueMargin ?? null,
          solvencyRatio: values.SolvencyRatio ?? null,
          calculatedSolvencyRatio: calculateSolvencyRatio(
            values.ActualCapital ?? null,
            values.MinimumCapital ?? null,
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
      `${result.ticker} ${latest?.periodEnd ?? "-"} EV=${latest?.ev ?? "-"} NBV=${latest?.nbv ?? "-"} NBV-margin=${latest?.newBusinessValueMargin ?? "-"} claims=${latest?.claimsRatio ?? "-"} combined=${latest?.combinedRatio ?? "-"} solvency=${latest?.solvencyRatio ?? "-"} source=${latest?.sourceComplete ? "complete" : "incomplete"} mapping=${latest?.mappingComplete ? "complete" : "incomplete"} lineage=${latest?.inputLineage ?? "missing"}`,
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
        (latest.claimsRatio != null &&
          latest.calculatedClaimsRatio != null &&
          !withinTolerance(
            latest.claimsRatio,
            latest.calculatedClaimsRatio,
          )) ||
        (latest.combinedRatio != null &&
          latest.calculatedCombinedRatio != null &&
          !withinTolerance(
            latest.combinedRatio,
            latest.calculatedCombinedRatio,
          )) ||
        (latest.solvencyRatio != null &&
          latest.calculatedSolvencyRatio != null &&
          !withinTolerance(
            latest.solvencyRatio,
            latest.calculatedSolvencyRatio,
          )) ||
        !latest.sourceComplete ||
        !latest.mappingComplete ||
        (!fixtureMode && latest.inputLineage !== "pipeline")
      );
    });
    if (failures.length) {
      console.error(
        `Strict insurance audit failed: ${failures
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
        `Insurance certification failed: ${failures
          .map((result) => result.ticker)
          .join(", ")}`,
      );
      process.exitCode = 1;
    }
  }
}

main()
  .catch((error) => {
    console.error("Insurance audit failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
