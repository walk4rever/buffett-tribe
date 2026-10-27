/**
 * Audit total, operating, and investment-gain revenue semantics.
 *
 * Usage:
 *   npm run eval:revenue
 *   npm run eval:revenue -- --strict
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import db from "../src/lib/prisma";
import {
  resolveInvestmentGains,
  resolveOperatingRevenue,
} from "../src/lib/revenue-semantics";

type ValidationCompany = {
  ticker: string;
  market: "us" | "cn" | "hk";
};

type ValidationSuite = {
  companies: ValidationCompany[];
};

const SUITE_PATH = path.join(
  process.cwd(),
  "scripts",
  "lib",
  "metric-validation-suite.json",
);
const FIELDS = [
  "Revenue",
  "OperatingRevenue",
  "InvestmentGains",
  "InvestmentIncome",
  "NetInvestmentIncome",
  "FairValueChangeIncome",
] as const;

function candidates(ticker: string) {
  const bare = ticker.replace(/\.(SS|SZ)$/, "");
  return [{ ticker }, { ticker: bare }, { code: bare }];
}

async function main() {
  const strict = process.argv.includes("--strict");
  const suite = JSON.parse(
    readFileSync(SUITE_PATH, "utf8"),
  ) as ValidationSuite;
  const entities = await db.entity.findMany({
    where: {
      type: "company",
      OR: suite.companies.flatMap((company) => candidates(company.ticker)),
    },
    select: { id: true, ticker: true, code: true },
  });
  if (entities.length !== suite.companies.length) {
    throw new Error(
      `Expected ${suite.companies.length} company entities, got ${entities.length}`,
    );
  }

  const results = [];
  for (const company of suite.companies) {
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
        const items = Object.fromEntries(
          periodRows.map((row) => [
            row.lineItem,
            row.value == null ? null : row.value.toString(),
          ]),
        );
        const units = Object.fromEntries(
          periodRows.map((row) => [row.lineItem, row.unit]),
        );
        return {
          periodEnd,
          revenue:
            items.Revenue == null ? null : Number(items.Revenue),
          operating: resolveOperatingRevenue(items, units),
          investmentGains: resolveInvestmentGains(items, units),
          sourceComplete:
            periodRows.length > 0 &&
            periodRows.every((row) => row.source?.kind != null),
          mappingComplete:
            periodRows.length > 0 &&
            periodRows.every(
              (row) => row.mappingRule != null && row.mappingRule.trim() !== "",
            ),
        };
      });
    const latest = periods[0] ?? null;
    const fiveYear = periods.slice(0, 5);
    const covered = fiveYear.filter(
      (period) => period.operating != null,
    ).length;
    results.push({
      ticker: company.ticker,
      market: company.market,
      period: latest?.periodEnd ?? null,
      revenue: latest?.revenue ?? null,
      operating: latest?.operating ?? null,
      gains: latest?.investmentGains ?? null,
      source: latest?.sourceComplete ?? false,
      mapping: latest?.mappingComplete ?? false,
      covered,
      total: fiveYear.length,
    });
  }

  console.log(
    "ticker\tperiod\trevenue\toperating\tinvestmentGains\tsource\tmapping\t5yCoverage",
  );
  for (const result of results) {
    console.log(
      [
        result.ticker,
        result.period ?? "-",
        result.revenue ?? "-",
        result.operating ?? "-",
        result.gains ?? "-",
        result.source ? "complete" : "incomplete",
        result.mapping ? "complete" : "incomplete",
        `${result.covered}/${result.total}`,
      ].join("\t"),
    );
  }
  for (const market of ["us", "cn", "hk"] as const) {
    const marketResults = results.filter(
      (result) => result.market === market,
    );
    console.log(
      [
        market.toUpperCase(),
        `companies=${marketResults.length}`,
        `revenue=${marketResults.filter((result) => result.revenue != null).length}`,
        `operating=${marketResults.filter((result) => result.operating != null).length}`,
        `source=${marketResults.filter((result) => result.source).length}`,
        `mapping=${marketResults.filter((result) => result.mapping).length}`,
        `fiveYear80=${marketResults.filter((result) => result.total > 0 && result.covered / result.total >= 0.8).length}`,
      ].join(" "),
    );
  }

  if (strict) {
    const failures = results.filter(
      (result) =>
        result.operating == null ||
        !result.source ||
        !result.mapping ||
        result.total === 0 ||
        result.covered / result.total < 0.8,
    );
    if (failures.length) {
      console.error(
        `Strict revenue audit failed: ${failures
          .map((result) => result.ticker)
          .join(", ")}`,
      );
      process.exitCode = 1;
    }
  }
}

main()
  .catch((error) => {
    console.error("Revenue audit failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
