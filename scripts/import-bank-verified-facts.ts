/**
 * Fixture-only import for manually reviewed bank facts.
 *
 * Usage:
 *   npm run import:bank-fixtures
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import db from "../src/lib/prisma";
import { upsertFinancialRows } from "./lib/upsert-financial-rows";

type BankFact = {
  ticker: string;
  periodEnd: string;
  sourcePeriodYear: number;
  values: Record<string, number>;
  evidence: string;
  note: string;
  sourceUrl?: string;
};

type BankFactFile = {
  version: number;
  facts: BankFact[];
};

const INPUT_PATH = path.join(
  process.cwd(),
  "scripts",
  "lib",
  "bank-verified-facts.json",
);

async function main() {
  if (!process.argv.includes("--allow-fixture")) {
    throw new Error(
      "Refusing to import fixture facts without --allow-fixture. Production facts must be extracted from onboarded sources.",
    );
  }
  const input = JSON.parse(
    readFileSync(INPUT_PATH, "utf8"),
  ) as BankFactFile;
  if (input.version !== 1) {
    throw new Error(`Unsupported bank fact version: ${input.version}`);
  }

  for (const fact of input.facts) {
    const bare = fact.ticker.replace(/\.(SS|SZ)$/, "");
    const entity = await db.entity.findFirst({
      where: {
        type: "company",
        OR: [
          { ticker: fact.ticker },
          { ticker: bare },
          { code: bare },
        ],
      },
      select: { id: true, market: true },
    });
    if (!entity) throw new Error(`Entity not found: ${fact.ticker}`);

    const source = await db.extSource.findFirst({
      where: {
        filerEntityId: entity.id,
        periodYear: fact.sourcePeriodYear,
        kind: {
          in: ["10k", "cn-annual-report", "hk-annual-report", "akshare"],
        },
      },
      select: { id: true, kind: true, url: true },
      orderBy: { kind: "desc" },
    });
    if (!source) {
      throw new Error(`Source not found for ${fact.ticker}`);
    }
    const rows = Object.entries(fact.values).map(([lineItem, value]) => ({
      entityId: entity.id,
      sourceId: source.id,
      periodEnd: new Date(`${fact.periodEnd}T00:00:00.000Z`),
      periodType: "FY",
      lineItem,
      value,
      unit: lineItem.endsWith("Ratio") || lineItem === "ProvisionCoverage"
        ? "ratio"
        : lineItem === "NIM"
          ? "ratio"
          : entity.market === "us"
            ? "USD"
            : entity.market === "hk"
              ? fact.ticker.startsWith("2388") ? "HKD" : "CNY"
              : "CNY",
      mappingRule: `fixture:bank-report:${fact.evidence}`,
      confidence: 0.5,
    }));
    await upsertFinancialRows(db, rows, { skipInterimGc: true });
    console.log(
      `${fact.ticker} ${fact.periodEnd}: wrote ${rows.length} bank facts. ${fact.note}`,
    );
  }
}

main()
  .catch((error) => {
    console.error("Bank facts import failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
