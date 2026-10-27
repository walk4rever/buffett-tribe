/**
 * Materialize REIT facts from onboarded SEC 10-K FilingSections.
 *
 * Usage:
 *   npm run extract:reit-facts:source -- --ticker SPG --from 2021 --to 2025 --apply
 */
import { pathToFileURL } from "node:url";
import type { Prisma } from "@prisma/client";
import db from "../src/lib/prisma";
import { upsertFinancialRows } from "./lib/upsert-financial-rows";
import {
  extractCnReitFacts,
  extractCnReitPairFacts,
  extractLinkReitFacts,
  extractLinkReitSeriesFacts,
  extractSpgReitFacts,
} from "./lib/reit-report-extractor";
import type {
  EvidenceValue,
  FilingTextSection,
} from "./lib/insurance-annual-report-extractor";

const EXTRACTOR_VERSION_BY_TICKER: Record<string, string> = {
  SPG: "spg-10k-v1",
  "508000.SS": "cn-public-reit-annual-report-v1",
  "0823.HK": "link-reit-annual-report-v1",
};

function getArg(flag: string) {
  const args = process.argv.slice(2);
  return args.find((_, index) => args[index - 1] === flag);
}

async function sectionText(section: {
  content: string;
  contentPreview: string | null;
  textArtifact: { publicUrl: string | null; sha256: string } | null;
}) {
  const stored = section.content || section.contentPreview || "";
  if (!section.textArtifact?.publicUrl) return stored;
  const response = await fetch(section.textArtifact.publicUrl);
  if (!response.ok) {
    throw new Error(
      `Archived section fetch failed: HTTP ${response.status} ${section.textArtifact.publicUrl}`,
    );
  }
  return response.text();
}

export async function extractTicker(
  ticker: string,
  fromYear: number,
  toYear: number,
  apply: boolean,
) {
  const extractorVersion = EXTRACTOR_VERSION_BY_TICKER[ticker];
  if (!extractorVersion) {
    throw new Error(`No source-backed REIT extractor registered for ${ticker}`);
  }
  const sourceKind =
    ticker === "SPG"
      ? "10k"
      : ticker === "508000.SS"
        ? "cn-annual-report"
        : "hk-annual-report";
  const entity = await db.entity.findFirst({
    where: { type: "company", ticker },
    select: { id: true },
  });
  if (!entity) throw new Error(`Entity not found: ${ticker}`);

  const sources = await db.extSource.findMany({
    where: {
      filerEntityId: entity.id,
      kind: sourceKind,
      periodYear: { gte: fromYear, lte: toYear },
    },
    select: {
      id: true,
      periodYear: true,
      sections: {
        select: {
          section: true,
          content: true,
          contentPreview: true,
          textArtifact: { select: { publicUrl: true, sha256: true } },
        },
      },
    },
    orderBy: { periodYear: "asc" },
  });
  const expectedYears = toYear - fromYear + 1;
  if (ticker !== "0823.HK" && sources.length < expectedYears) {
    throw new Error(
      `Expected ${expectedYears} onboarded 10-K sources, got ${sources.length}`,
    );
  }

  if (ticker === "0823.HK") {
    const source = sources.at(-1);
    if (!source?.periodYear) {
      throw new Error("No onboarded Link REIT annual report found");
    }
    const texts: FilingTextSection[] = [];
    for (const section of source.sections) {
      const text = await sectionText(section);
      if (text.trim()) texts.push({ section: section.section, text });
    }
    const series = extractLinkReitSeriesFacts(texts);
    if (series.noi.length !== 5 || series.occupancy.length !== 5) {
      throw new Error(
        `Link REIT five-year series unresolved: NOI=${series.noi.length}, occupancy=${series.occupancy.length}`,
      );
    }
    const evidenceFor = (fact: EvidenceValue) => {
      const section = source.sections.find(
        (candidate) => candidate.section === fact.section,
      );
      return [
        extractorVersion,
        `source=${source.id}`,
        `section=${fact.section}`,
        `locator=${fact.locator}`,
        `artifact=${section?.textArtifact?.sha256 ?? "section_preview"}`,
      ].join("|");
    };
    const rows: Prisma.FinancialCreateManyInput[] = [];
    for (let index = 0; index < 5; index += 1) {
      const periodEnd = new Date(
        `${source.periodYear + 1 - index}-03-31T00:00:00.000Z`,
      );
      const noiFact = series.noi[index];
      const occupancyFact = series.occupancy[index];
      rows.push(
        {
          entityId: entity.id,
          sourceId: source.id,
          periodEnd,
          periodType: "FY",
          lineItem: "NOI",
          value: noiFact.value * 1_000_000,
          unit: "HKD",
          mappingRule: `annual-report-extractor:${evidenceFor(noiFact)}`,
          confidence: 1,
        },
        {
          entityId: entity.id,
          sourceId: source.id,
          periodEnd,
          periodType: "FY",
          lineItem: "Occupancy",
          value: occupancyFact.value,
          unit: "ratio",
          mappingRule: `annual-report-extractor:${evidenceFor(
            occupancyFact,
          )}`,
          confidence: 1,
        },
      );
      console.log(
        `${ticker} FY${source.periodYear + 1 - index}: NOI=${noiFact.value} occupancy=${occupancyFact.value.toFixed(3)}`,
      );
    }
    if (apply) {
      await upsertFinancialRows(db, rows, { skipInterimGc: true });
    }
    return;
  }

  if (ticker === "508000.SS") {
    const evidenceFor = (
      sourceId: string,
      fact: EvidenceValue,
      sourceSections: typeof sources[number]["sections"],
    ) => {
      const section = sourceSections.find(
        (candidate) => candidate.section === fact.section,
      );
      return [
        extractorVersion,
        `source=${sourceId}`,
        `section=${fact.section}`,
        `locator=${fact.locator}`,
        `artifact=${section?.textArtifact?.sha256 ?? "section_preview"}`,
      ].join("|");
    };
    for (const source of sources) {
      if (!source.periodYear || source.periodYear === 2024) continue;
      const texts: FilingTextSection[] = [];
      for (const section of source.sections) {
        const text = await sectionText(section);
        if (text.trim()) texts.push({ section: section.section, text });
      }

      const rows: Prisma.FinancialCreateManyInput[] = [];
      if (source.periodYear <= 2023) {
        const facts = extractCnReitFacts(texts, source.periodYear);
        if (
          !facts.propertyRevenue ||
          !facts.noi ||
          !facts.occupancy
        ) {
          console.warn(
            `${ticker} FY${source.periodYear}: unresolved`,
            JSON.stringify(facts),
          );
          continue;
        }
        const periodEnd = new Date(
          `${source.periodYear}-12-31T00:00:00.000Z`,
        );
        rows.push(
          {
            entityId: entity.id,
            sourceId: source.id,
            periodEnd,
            periodType: "FY",
            lineItem: "PropertyRevenue",
            value: facts.propertyRevenue.value,
            unit: "CNY",
            mappingRule: `annual-report-extractor:${evidenceFor(
              source.id,
              facts.propertyRevenue,
              source.sections,
            )}`,
            confidence: 1,
          },
          ...(facts.propertyOperatingExpenses
            ? [{
                entityId: entity.id,
                sourceId: source.id,
                periodEnd,
                periodType: "FY",
                lineItem: "PropertyOperatingExpenses",
                value: facts.propertyOperatingExpenses.value,
                unit: "CNY",
                mappingRule: [
                  `derived:${extractorVersion}:excluding-depreciation`,
                  `source=${source.id}`,
                  `evidence=${facts.propertyOperatingExpenses.locator}`,
                ].join("|"),
                confidence: 0.9,
              }]
            : []),
          {
            entityId: entity.id,
            sourceId: source.id,
            periodEnd,
            periodType: "FY",
            lineItem: "NOI",
            value: facts.noi.value,
            unit: "CNY",
            mappingRule: [
              `derived:${extractorVersion}:NOI`,
              `source=${source.id}`,
              `evidence=${facts.noi.locator}`,
            ].join("|"),
            confidence: 0.9,
          },
          {
            entityId: entity.id,
            sourceId: source.id,
            periodEnd,
            periodType: "FY",
            lineItem: "Occupancy",
            value: facts.occupancy.value,
            unit: "ratio",
            mappingRule: `annual-report-extractor:${evidenceFor(
              source.id,
              facts.occupancy,
              source.sections,
            )}`,
            confidence: 1,
          },
        );
        console.log(
          `${ticker} FY${source.periodYear}: revenue=${facts.propertyRevenue.value.toFixed(2)} NOI=${facts.noi.value.toFixed(2)} occupancy=${facts.occupancy.value.toFixed(4)}`,
        );
      } else {
        const pair = extractCnReitPairFacts(texts);
        if (
          pair.propertyRevenue.length !== 2 ||
          pair.propertyOperatingExpenses.length !== 2 ||
          pair.noi.length !== 2 ||
          pair.occupancy.length !== 2
        ) {
          console.warn(
            `${ticker} FY${source.periodYear}: comparative pair unresolved`,
            JSON.stringify(pair),
          );
          continue;
        }
        for (let index = 0; index < 2; index += 1) {
          const periodYear = source.periodYear - index;
          const periodEnd = new Date(
            `${periodYear}-12-31T00:00:00.000Z`,
          );
          const revenue = pair.propertyRevenue[index];
          const expenses = pair.propertyOperatingExpenses[index];
          const noi = pair.noi[index];
          const occupancy = pair.occupancy[index];
          rows.push(
            {
              entityId: entity.id,
              sourceId: source.id,
              periodEnd,
              periodType: "FY",
              lineItem: "PropertyRevenue",
              value: revenue.value,
              unit: "CNY",
              mappingRule: `annual-report-extractor:${evidenceFor(
                source.id,
                revenue,
                source.sections,
              )}`,
              confidence: 1,
            },
            {
              entityId: entity.id,
              sourceId: source.id,
              periodEnd,
              periodType: "FY",
              lineItem: "PropertyOperatingExpenses",
              value: expenses.value,
              unit: "CNY",
              mappingRule: `annual-report-extractor:${evidenceFor(
                source.id,
                expenses,
                source.sections,
              )}`,
              confidence: 1,
            },
            {
              entityId: entity.id,
              sourceId: source.id,
              periodEnd,
              periodType: "FY",
              lineItem: "NOI",
              value: noi.value,
              unit: "CNY",
              mappingRule: [
                `derived:${extractorVersion}:NOI`,
                `source=${source.id}`,
                `evidence=${noi.locator}`,
              ].join("|"),
              confidence: 0.9,
            },
            {
              entityId: entity.id,
              sourceId: source.id,
              periodEnd,
              periodType: "FY",
              lineItem: "Occupancy",
              value: occupancy.value,
              unit: "ratio",
              mappingRule: `annual-report-extractor:${evidenceFor(
                source.id,
                occupancy,
                source.sections,
              )}`,
              confidence: 1,
            },
          );
          console.log(
            `${ticker} FY${periodYear}: revenue=${revenue.value.toFixed(2)} expenses=${expenses.value.toFixed(2)} NOI=${noi.value.toFixed(2)} occupancy=${occupancy.value.toFixed(4)}`,
          );
        }
      }
      if (apply) {
        await upsertFinancialRows(db, rows, { skipInterimGc: true });
      }
    }
    return;
  }

  for (const source of sources) {
    if (source.periodYear == null) continue;
    const sourceYear = source.periodYear;
    const texts: FilingTextSection[] = [];
    for (const section of source.sections) {
      const text = await sectionText(section);
      if (text.trim()) texts.push({ section: section.section, text });
    }
    const spgFacts =
      ticker === "SPG" ? extractSpgReitFacts(texts) : null;
    const cnFacts =
      ticker === "508000.SS" && source.periodYear
        ? extractCnReitFacts(texts, source.periodYear)
        : null;
    const linkFacts =
      ticker === "0823.HK" ? extractLinkReitFacts(texts) : null;
    const resolved =
      (spgFacts?.noi &&
        spgFacts.ffo &&
        spgFacts.occupancy &&
        spgFacts.ffoPerShare) ||
      (cnFacts?.propertyRevenue && cnFacts.noi && cnFacts.occupancy) ||
      (linkFacts?.noi && linkFacts.occupancy);
    if (!resolved) {
      console.warn(
        `${ticker} FY${source.periodYear}: unresolved`,
        JSON.stringify({
          spgFacts,
          cnFacts,
          linkFacts,
        }),
      );
      continue;
    }

    const evidenceFor = (fact: EvidenceValue) => {
      const section = source.sections.find(
        (candidate) => candidate.section === fact.section,
      );
      return [
        extractorVersion,
        `source=${source.id}`,
        `section=${fact.section}`,
        `locator=${fact.locator}`,
        `artifact=${section?.textArtifact?.sha256 ?? "section_preview"}`,
      ].join("|");
    };
    const periodEnd =
      ticker === "0823.HK"
        ? new Date(
            `${sourceYear + 1}-03-31T00:00:00.000Z`,
          )
        : new Date(`${sourceYear}-12-31T00:00:00.000Z`);
    let rows: Prisma.FinancialCreateManyInput[] = [];
    let logMessage = "";

    if (spgFacts?.noi && spgFacts.ffo && spgFacts.occupancy && spgFacts.ffoPerShare) {
      rows = [
        ["NOI", spgFacts.noi, spgFacts.noi.value * 1_000, "USD"],
        ["FFO", spgFacts.ffo, spgFacts.ffo.value * 1_000, "USD"],
        ["Occupancy", spgFacts.occupancy, spgFacts.occupancy.value, "ratio"],
        [
          "FFOPerShare",
          spgFacts.ffoPerShare,
          spgFacts.ffoPerShare.value,
          "USD/share",
        ],
      ].map(([lineItem, fact, value, unit]) => ({
        entityId: entity.id,
        sourceId: source.id,
        periodEnd,
        periodType: "FY",
        lineItem: String(lineItem),
        value: Number(value),
        unit: String(unit),
        mappingRule: `annual-report-extractor:${evidenceFor(
          fact as EvidenceValue,
        )}`,
        confidence: 1,
      }));
      logMessage = `NOI=${spgFacts.noi.value} FFO=${spgFacts.ffo.value} occupancy=${spgFacts.occupancy.value.toFixed(3)} FFO/share=${spgFacts.ffoPerShare.value}`;
    } else if (
      cnFacts?.propertyRevenue &&
      cnFacts.noi &&
      cnFacts.occupancy
    ) {
      const noi = cnFacts.noi.value;
      rows = [
        ["PropertyRevenue", cnFacts.propertyRevenue, "CNY"],
        ["Occupancy", cnFacts.occupancy, "ratio"],
      ].map(([lineItem, fact, unit]) => ({
        entityId: entity.id,
        sourceId: source.id,
        periodEnd,
        periodType: "FY",
        lineItem: String(lineItem),
        value: Number((fact as EvidenceValue).value),
        unit: String(unit),
        mappingRule: `annual-report-extractor:${evidenceFor(
          fact as EvidenceValue,
        )}`,
        confidence: 1,
      }));
      rows.push({
        entityId: entity.id,
        sourceId: source.id,
        periodEnd,
        periodType: "FY",
        lineItem: "NOI",
        value: noi,
        unit: "CNY",
        mappingRule: [
          `derived:${extractorVersion}:NOI`,
          `revenueSource=${source.id}`,
          `expenseSource=${source.id}`,
        ].join("|"),
        confidence: 0.9,
      });
      logMessage = `NOI=${noi.toFixed(2)} occupancy=${cnFacts.occupancy.value.toFixed(4)}`;
    } else if (linkFacts?.noi && linkFacts.occupancy) {
      rows = [
        ["NOI", linkFacts.noi, linkFacts.noi.value * 1_000_000, "HKD"],
        ["Occupancy", linkFacts.occupancy, linkFacts.occupancy.value, "ratio"],
      ].map(([lineItem, fact, value, unit]) => ({
        entityId: entity.id,
        sourceId: source.id,
        periodEnd,
        periodType: "FY",
        lineItem: String(lineItem),
        value: Number(value),
        unit: String(unit),
        mappingRule: `annual-report-extractor:${evidenceFor(
          fact as EvidenceValue,
        )}`,
        confidence: 1,
      }));
      logMessage = `NOI=${linkFacts.noi.value} occupancy=${linkFacts.occupancy.value.toFixed(3)}`;
    }

    console.log(`${ticker} FY${source.periodYear}: ${logMessage}`);
    if (apply) {
      await upsertFinancialRows(db, rows, { skipInterimGc: true });
    }
  }
}

async function main() {
  const ticker = getArg("--ticker");
  const fromYear = Number.parseInt(getArg("--from") ?? "", 10);
  const toYear = Number.parseInt(getArg("--to") ?? "", 10);
  const apply = process.argv.includes("--apply");
  if (!ticker || !Number.isFinite(fromYear) || !Number.isFinite(toYear)) {
    throw new Error(
      "Usage: --ticker <TICKER> --from <YYYY> --to <YYYY> [--apply]",
    );
  }
  await extractTicker(ticker, fromYear, toYear, apply);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error) => {
      console.error("Source-backed REIT extraction failed:", error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
