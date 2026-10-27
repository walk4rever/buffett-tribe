/**
 * Materialize OperatingRevenue and InvestmentGains for the validation suite.
 *
 * Usage:
 *   npm run backfill:revenue
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import db from "../src/lib/prisma";
import { upsertFinancialRows } from "./lib/upsert-financial-rows";
import { resolveInvestmentGains } from "../src/lib/revenue-semantics";

type ValidationCompany = {
  ticker: string;
  role: string;
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
const PASS_THROUGH_ROLES = new Set([
  "consumer_brand",
  "healthcare",
  "software_platform",
  "semiconductor_hardware",
  "energy_materials",
  "utilities",
  "telecommunications",
  "asset_mgmt",
  "reit_property",
  "developer",
]);

async function main() {
  const suite = JSON.parse(
    readFileSync(SUITE_PATH, "utf8"),
  ) as ValidationSuite;

  for (const company of suite.companies) {
    const bare = company.ticker.replace(/\.(SS|SZ)$/, "");
    const entity = await db.entity.findFirst({
      where: {
        type: "company",
        OR: [
          { ticker: company.ticker },
          { ticker: bare },
          { code: bare },
        ],
      },
      select: { id: true },
    });
    if (!entity) throw new Error(`Entity not found: ${company.ticker}`);

    const rows = await db.financial.findMany({
      where: {
        entityId: entity.id,
        periodType: "FY",
        lineItem: {
          in: [
            "Revenue",
            "OperatingRevenue",
            "InvestmentGains",
            "InvestmentIncome",
            "NetInvestmentIncome",
            "FairValueChangeIncome",
            "NetInterestIncome",
            "NonInterestIncome",
          ],
        },
      },
      select: {
        periodEnd: true,
        lineItem: true,
        value: true,
        unit: true,
        sourceId: true,
      },
    });
    const byPeriod = new Map<string, typeof rows>();
    for (const row of rows) {
      const periodEnd = row.periodEnd.toISOString();
      const periodRows = byPeriod.get(periodEnd) ?? [];
      periodRows.push(row);
      byPeriod.set(periodEnd, periodRows);
    }

    const writes = [];
    for (const [periodEnd, periodRows] of byPeriod.entries()) {
      const revenue = periodRows.find((row) => row.lineItem === "Revenue");
      if (!revenue?.value) continue;
      const items = Object.fromEntries(
        periodRows.map((row) => [
          row.lineItem,
          row.value == null ? null : row.value.toString(),
        ]),
      );
      const itemUnits = Object.fromEntries(
        periodRows.map((row) => [row.lineItem, row.unit]),
      );
      const investmentGains = resolveInvestmentGains(items, itemUnits);

      if (!items.InvestmentGains && investmentGains != null) {
        writes.push({
          entityId: entity.id,
          sourceId: revenue.sourceId,
          periodEnd: new Date(periodEnd),
          periodType: "FY",
          lineItem: "InvestmentGains",
          value: investmentGains,
          unit: revenue.unit,
          mappingRule:
            "derived:NetInvestmentIncome or InvestmentIncome + FairValueChangeIncome",
          confidence: 0.9,
        });
      }

      if (!items.OperatingRevenue) {
        let operatingRevenue: number | null = null;
        let rule: string | null = null;
        if (company.role === "bank") {
          const netInterest = Number(items.NetInterestIncome);
          const nonInterest = Number(items.NonInterestIncome);
          if (
            Number.isFinite(netInterest) &&
            Number.isFinite(nonInterest)
          ) {
            operatingRevenue =
              netInterest + nonInterest - (investmentGains ?? 0);
            rule =
              "derived:NetInterestIncome + NonInterestIncome - InvestmentGains";
          }
        } else if (PASS_THROUGH_ROLES.has(company.role)) {
          operatingRevenue = Number(revenue.value);
          rule = "derived:Revenue (operating role)";
        } else {
          operatingRevenue = Number(revenue.value) - (investmentGains ?? 0);
          rule = investmentGains == null
            ? "derived:Revenue (no investment gain line)"
            : "derived:Revenue - InvestmentGains";
        }

        if (
          operatingRevenue != null &&
          Number.isFinite(operatingRevenue) &&
          rule != null
        ) {
          writes.push({
            entityId: entity.id,
            sourceId: revenue.sourceId,
            periodEnd: new Date(periodEnd),
            periodType: "FY",
            lineItem: "OperatingRevenue",
            value: operatingRevenue,
            unit: revenue.unit,
            mappingRule: rule,
            confidence: 0.9,
          });
        }
      }
    }

    await upsertFinancialRows(db, writes, { skipInterimGc: true });
    console.log(`${company.ticker}: wrote ${writes.length} revenue rows`);
  }
}

main()
  .catch((error) => {
    console.error("Revenue backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
