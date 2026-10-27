/**
 * Fixture-only import for manually reviewed insurance facts.
 *
 * Usage:
 *   npm run import:insurance-fixtures
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import db from "../src/lib/prisma";
import { upsertFinancialRows } from "./lib/upsert-financial-rows";

type InsuranceFact = {
  ticker: string;
  periodEnd: string;
  sourcePeriodYear: number;
  sourceKind?: "10k" | "cn-annual-report" | "hk-annual-report" | "hk-results";
  sourceUrl?: string;
  annualReportUrl?: string;
  currency?: string;
  values: Record<string, number>;
  derivedFields?: string[];
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
const RATIO_FIELDS = new Set([
  "ClaimsRatio",
  "CombinedRatio",
  "NewBusinessValueMargin",
  "SolvencyRatio",
]);

function unitFor(lineItem: string, market: string | null, currency?: string) {
  if (RATIO_FIELDS.has(lineItem)) return "ratio";
  return (
    currency ??
    (market === "us" ? "USD" : market === "hk" ? "HKD" : "CNY")
  );
}

async function main() {
  if (!process.argv.includes("--allow-fixture")) {
    throw new Error(
      "Refusing to import fixture facts without --allow-fixture. Production facts must be extracted from onboarded sources.",
    );
  }
  const input = JSON.parse(
    readFileSync(INPUT_PATH, "utf8"),
  ) as InsuranceFactFile;
  if (input.version !== 1) {
    throw new Error(`Unsupported insurance fact version: ${input.version}`);
  }

  for (const fact of input.facts) {
    const bare = fact.ticker.replace(/\..*$/, "");
    const entity = await db.entity.findFirst({
      where: {
        type: "company",
        OR: [{ ticker: fact.ticker }, { ticker: bare }, { code: bare }],
      },
      select: { id: true, market: true },
    });
    if (!entity) throw new Error(`Entity not found: ${fact.ticker}`);

    const sourceKind = fact.sourceKind ?? (
      entity.market === "us"
        ? "10k"
        : entity.market === "hk"
          ? "hk-annual-report"
          : "cn-annual-report"
    );
    const source = await db.extSource.findFirst({
      where: {
        filerEntityId: entity.id,
        periodYear: fact.sourcePeriodYear,
        kind: sourceKind,
      },
      select: { id: true, url: true },
    });
    if (!source) {
      throw new Error(
        `Onboarded source not found for ${fact.ticker} FY${fact.sourcePeriodYear} (${sourceKind})`,
      );
    }

    const derivedFields = new Set(fact.derivedFields ?? []);
    const rows = Object.entries(fact.values).map(([lineItem, value]) => ({
      entityId: entity.id,
      sourceId: source.id,
      periodEnd: new Date(`${fact.periodEnd}T00:00:00.000Z`),
      periodType: "FY",
      lineItem,
      value,
      unit: unitFor(lineItem, entity.market, fact.currency),
      mappingRule: `fixture:insurance-report:${fact.evidence}`,
      confidence: derivedFields.has(lineItem) ? 0.4 : 0.5,
    }));
    await upsertFinancialRows(db, rows, { skipInterimGc: true });
    console.log(
      `${fact.ticker} ${fact.periodEnd}: wrote ${rows.length} insurance facts. ${fact.note}`,
    );
  }
}

main()
  .catch((error) => {
    console.error("Insurance facts import failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
