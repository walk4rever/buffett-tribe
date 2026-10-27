/**
 * Audit parent, common, and total equity across the 45-company suite.
 *
 * Usage:
 *   npm run eval:equity
 *   npm run eval:equity -- --strict
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import db from "../src/lib/prisma";
import {
  resolveShareholdersCommonEquity,
  resolveShareholdersEquity,
  resolveTotalEquity,
} from "../src/lib/equity-semantics";

type ValidationCompany = {
  ticker: string;
  market: "us" | "cn" | "hk";
};

type ValidationSuite = {
  companies: ValidationCompany[];
};

type SemanticsStatus = "reported" | "derived" | "insufficient";

const SUITE_PATH = path.join(
  process.cwd(),
  "scripts",
  "lib",
  "metric-validation-suite.json",
);
const SEMANTIC_FIELDS = [
  "ShareholdersEquity",
  "ShareholdersCommonEquity",
  "PreferredStockValue",
  "MinorityInterest",
  "TotalEquity",
] as const;

function entityCandidates(ticker: string) {
  const bare = ticker.replace(/\.(SS|SZ)$/, "");
  return [{ ticker }, { ticker: bare }, { code: bare }];
}

function statusFor(
  direct: number | null,
  resolved: number | null,
): SemanticsStatus {
  if (resolved == null) return "insufficient";
  if (
    direct != null &&
    Math.abs(direct - resolved) <= Math.max(1, Math.abs(resolved) * 1e-6)
  ) {
    return "reported";
  }
  return "derived";
}

async function main() {
  const strict = process.argv.includes("--strict");
  const suite = JSON.parse(
    readFileSync(SUITE_PATH, "utf8"),
  ) as ValidationSuite;
  const entities = await db.entity.findMany({
    where: {
      type: "company",
      OR: suite.companies.flatMap((company) =>
        entityCandidates(company.ticker),
      ),
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
    if (!entity) {
      throw new Error(`Company entity not found: ${company.ticker}`);
    }

    const rows = await db.financial.findMany({
      where: {
        entityId: entity.id,
        periodType: "FY",
        lineItem: { in: [...SEMANTIC_FIELDS] },
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
        const itemUnits = Object.fromEntries(
          periodRows.map((row) => [row.lineItem, row.unit]),
        );
        const directParent =
          items.ShareholdersEquity == null
            ? null
            : Number(items.ShareholdersEquity);
        const directCommon =
          items.ShareholdersCommonEquity == null
            ? null
            : Number(items.ShareholdersCommonEquity);
        const directTotal =
          items.TotalEquity == null ? null : Number(items.TotalEquity);
        const parent = resolveShareholdersEquity(items, itemUnits);
        const common = resolveShareholdersCommonEquity(items, itemUnits);
        const total = resolveTotalEquity(items, itemUnits);
        const semanticRows = periodRows.filter((row) =>
          [
            "ShareholdersEquity",
            "ShareholdersCommonEquity",
            "PreferredStockValue",
            "MinorityInterest",
            "TotalEquity",
          ].includes(row.lineItem),
        );
        const sourceComplete =
          semanticRows.length > 0 &&
          semanticRows.every((row) => row.source?.kind != null);
        const mappingComplete =
          semanticRows.length > 0 &&
          semanticRows.every(
            (row) => row.mappingRule != null && row.mappingRule.trim() !== "",
          );

        return {
          periodEnd,
          parent,
          common,
          total,
          parentStatus: statusFor(directParent, parent),
          commonStatus: statusFor(directCommon, common),
          totalStatus: statusFor(directTotal, total),
          sourceComplete,
          mappingComplete,
        };
      });

    const latest = periods[0] ?? null;
    const fiveYear = periods.slice(0, 5);
    const fiveYearCovered = fiveYear.filter(
      (period) => period.common != null,
    ).length;
    results.push({
      ticker: company.ticker,
      market: company.market,
      latestPeriod: latest?.periodEnd ?? null,
      parent: latest?.parent ?? null,
      common: latest?.common ?? null,
      total: latest?.total ?? null,
      parentStatus: latest?.parentStatus ?? "insufficient",
      commonStatus: latest?.commonStatus ?? "insufficient",
      totalStatus: latest?.totalStatus ?? "insufficient",
      sourceComplete: latest?.sourceComplete ?? false,
      mappingComplete: latest?.mappingComplete ?? false,
      fiveYearCovered,
      fiveYearTotal: fiveYear.length,
      fiveYearCoverage: fiveYear.length
        ? fiveYearCovered / fiveYear.length
        : 0,
    });
  }

  console.log(
    "ticker\tperiod\tparent\tcommon\ttotal\tcommonStatus\tsource\tmapping\t5yCoverage",
  );
  for (const result of results) {
    console.log(
      [
        result.ticker,
        result.latestPeriod ?? "-",
        result.parent ?? "-",
        result.common ?? "-",
        result.total ?? "-",
        result.commonStatus,
        result.sourceComplete ? "complete" : "incomplete",
        result.mappingComplete ? "complete" : "incomplete",
        `${result.fiveYearCovered}/${result.fiveYearTotal}`,
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
        `parent=${marketResults.filter((result) => result.parent != null).length}`,
        `common=${marketResults.filter((result) => result.common != null).length}`,
        `total=${marketResults.filter((result) => result.total != null).length}`,
        `source=${marketResults.filter((result) => result.sourceComplete).length}`,
        `mapping=${marketResults.filter((result) => result.mappingComplete).length}`,
        `fiveYear80=${marketResults.filter((result) => result.fiveYearCoverage >= 0.8).length}`,
      ].join(" "),
    );
  }

  if (strict) {
    const failures = results.filter(
      (result) =>
        result.common == null ||
        !result.sourceComplete ||
        result.fiveYearCoverage < 0.8,
    );
    if (failures.length) {
      console.error(
        `Strict equity audit failed: ${failures
          .map((result) => result.ticker)
          .join(", ")}`,
      );
      process.exitCode = 1;
    }
  }
}

main()
  .catch((error) => {
    console.error("Equity audit failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
