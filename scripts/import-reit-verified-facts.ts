/**
 * Fixture-only import for manually reviewed REIT facts.
 *
 * Usage:
 *   npm run import:reit-fixtures
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import db from "../src/lib/prisma";
import { upsertFinancialRows } from "./lib/upsert-financial-rows";

type ReitFact = {
  ticker: string;
  periodEnd: string;
  sourcePeriodYear: number;
  sourceUrl?: string;
  values: Record<string, number>;
  derivedFields?: string[];
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
const RATIO_FIELDS = new Set([
  "Occupancy",
  "SameStoreNOIGrowth",
]);

function unitFor(lineItem: string, market: string | null) {
  if (RATIO_FIELDS.has(lineItem)) return "ratio";
  if (lineItem === "FFOPerShare") {
    return market === "us" ? "USD/share" : market === "hk" ? "HKD/share" : "CNY/share";
  }
  return market === "us" ? "USD" : market === "hk" ? "HKD" : "CNY";
}

async function main() {
  if (!process.argv.includes("--allow-fixture")) {
    throw new Error(
      "Refusing to import fixture facts without --allow-fixture. Production facts must be extracted from onboarded sources.",
    );
  }
  const input = JSON.parse(
    readFileSync(INPUT_PATH, "utf8"),
  ) as ReitFactFile;
  if (input.version !== 1) {
    throw new Error(`Unsupported REIT fact version: ${input.version}`);
  }

  for (const fact of input.facts) {
    const entity = await db.entity.findFirst({
      where: {
        type: "company",
        OR: [{ ticker: fact.ticker }, { code: fact.ticker.replace(/\..*$/, "") }],
      },
      select: { id: true, market: true },
    });
    if (!entity) throw new Error(`Entity not found: ${fact.ticker}`);

    const source = await db.extSource.findFirst({
      where: {
        filerEntityId: entity.id,
        periodYear: fact.sourcePeriodYear,
        kind: { in: ["10k", "cn-annual-report", "hk-annual-report"] },
      },
      select: { id: true, url: true },
      orderBy: { kind: "desc" },
    });
    if (!source) throw new Error(`Source not found for ${fact.ticker}`);
    const derivedFields = new Set(fact.derivedFields ?? []);
    const rows = Object.entries(fact.values).map(([lineItem, value]) => ({
      entityId: entity.id,
      sourceId: source.id,
      periodEnd: new Date(`${fact.periodEnd}T00:00:00.000Z`),
      periodType: "FY",
      lineItem,
      value,
      unit: unitFor(lineItem, entity.market),
      mappingRule: `fixture:reit-report:${fact.evidence}`,
      confidence: derivedFields.has(lineItem) ? 0.4 : 0.5,
    }));
    await upsertFinancialRows(db, rows, { skipInterimGc: true });
    console.log(
      `${fact.ticker} ${fact.periodEnd}: wrote ${rows.length} REIT facts. ${fact.note}`,
    );
  }
}

main()
  .catch((error) => {
    console.error("REIT facts import failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
