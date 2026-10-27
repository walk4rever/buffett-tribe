/**
 * Materialize NetIncomeCommon and ShareholdersCommonEquity for periods where
 * evidence shows no deduction for preferred or perpetual-capital instruments.
 *
 * Usage:
 *   npm run backfill:net-income-common
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import db from "../src/lib/prisma";
import { resolveShareholdersEquity } from "../src/lib/equity-semantics";
import { upsertFinancialRows } from "./lib/upsert-financial-rows";

type Policy = {
  ticker: string;
  fromYear: number;
  reason: string;
  evidence: string;
  confidence: number;
};

type PolicyFile = {
  version: number;
  policies: Policy[];
};

const POLICY_PATH = path.join(
  process.cwd(),
  "scripts",
  "lib",
  "net-income-common-no-preference-policy.json",
);

async function main() {
  const policyFile = JSON.parse(
    readFileSync(POLICY_PATH, "utf8"),
  ) as PolicyFile;
  if (policyFile.version !== 1) {
    throw new Error(`Unsupported net-income policy version: ${policyFile.version}`);
  }

  for (const policy of policyFile.policies) {
    const bare = policy.ticker.replace(/\.(SS|SZ)$/, "");
    const entity = await db.entity.findFirst({
      where: {
        type: "company",
        OR: [
          { ticker: policy.ticker },
          { ticker: bare },
          { code: bare },
        ],
      },
      select: { id: true, ticker: true, code: true, market: true },
    });
    if (!entity) {
      throw new Error(`Entity not found: ${policy.ticker}`);
    }

    const rows = await db.financial.findMany({
      where: {
        entityId: entity.id,
        periodType: "FY",
        periodEnd: { gte: new Date(Date.UTC(policy.fromYear, 0, 1)) },
        lineItem: {
          in: [
            "NetIncome",
            "NetIncomeCommon",
            "PreferredDividends",
            "ShareholdersEquity",
            "ShareholdersCommonEquity",
            "PreferredStockValue",
            "MinorityInterest",
            "TotalEquity",
          ],
        },
      },
      select: {
        periodEnd: true,
        lineItem: true,
        value: true,
        unit: true,
      },
      orderBy: { periodEnd: "asc" },
    });
    const byPeriod = new Map<
      string,
      Map<string, { value: number; unit: string | null }>
    >();
    for (const row of rows) {
      if (row.value == null) continue;
      const periodEnd = row.periodEnd.toISOString();
      const values = byPeriod.get(periodEnd) ?? new Map();
      values.set(row.lineItem, {
        value: Number(row.value),
        unit: row.unit,
      });
      byPeriod.set(periodEnd, values);
    }

    const sources = await db.extSource.findMany({
      where: { filerEntityId: entity.id },
      select: { id: true, kind: true, periodYear: true },
      orderBy: { periodYear: "desc" },
    });
    const writes = [];
    for (const [periodEnd, values] of byPeriod.entries()) {
      const parent = values.get("NetIncome");
      const year = new Date(periodEnd).getUTCFullYear();
      const source =
        sources.find(
          (candidate) =>
            candidate.periodYear === year &&
            ["cn-annual-report", "hk-annual-report", "10k"].includes(
              candidate.kind,
            ),
        ) ??
        sources.find((candidate) => candidate.kind === "akshare");
      if (!source) continue;

      if (
        parent &&
        !values.has("NetIncomeCommon") &&
        !values.has("PreferredDividends")
      ) {
        writes.push({
          entityId: entity.id,
          sourceId: source.id,
          periodEnd: new Date(periodEnd),
          periodType: "FY",
          lineItem: "NetIncomeCommon",
          value: parent.value,
          unit: parent.unit,
          mappingRule:
            `derived:NetIncome - 0 (${policy.reason}; ${policy.evidence})`,
          confidence: policy.confidence,
        });
      }

      const equityItems = Object.fromEntries(
        [...values.entries()].map(([key, value]) => [key, value.value]),
      );
      const equityUnits = Object.fromEntries(
        [...values.entries()].map(([key, value]) => [key, value.unit]),
      );
      const parentEquity = resolveShareholdersEquity(equityItems, equityUnits);
      if (
        parentEquity != null &&
        !values.has("ShareholdersCommonEquity") &&
        !values.has("PreferredStockValue")
      ) {
        writes.push({
          entityId: entity.id,
          sourceId: source.id,
          periodEnd: new Date(periodEnd),
          periodType: "FY",
          lineItem: "ShareholdersCommonEquity",
          value: parentEquity,
          unit: values.get("ShareholdersEquity")?.unit ?? null,
          mappingRule:
            `derived:ShareholdersEquity - 0 (${policy.reason}; ${policy.evidence})`,
          confidence: policy.confidence,
        });
      }
    }

    await upsertFinancialRows(db, writes, { skipInterimGc: true });
    console.log(
      `${policy.ticker}: wrote ${writes.length} semantic rows`,
    );
  }
}

main()
  .catch((error) => {
    console.error("Net-income common backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
