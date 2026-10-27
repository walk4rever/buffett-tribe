/**
 * Materialize insurance facts exclusively from onboarded ExtSource and
 * FilingSection records. This script reads the database lineage and the archived
 * section artifact when available.
 *
 * Usage:
 *   npm run extract:insurance-facts:source -- --apply
 *   npm run extract:insurance-facts:source -- --ticker 2328.HK --from 2021 --to 2025 --apply
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Prisma } from "@prisma/client";
import db from "../src/lib/prisma";
import { upsertFinancialRows } from "./lib/upsert-financial-rows";
import {
  extractAiaInsuranceFacts,
  extractMetLifeInsuranceFacts,
  extractPiccGroupInsuranceFacts,
  extractPiccPcInsuranceFacts,
  extractPingAnInsuranceFacts,
  extractProgressiveInsuranceFacts,
  type EvidenceValue,
  type FilingTextSection,
} from "./lib/insurance-annual-report-extractor";

type InsuranceFact = {
  ticker: string;
  periodEnd: string;
  sourcePeriodYear: number;
  sourceKind?: "10k" | "cn-annual-report" | "hk-annual-report" | "hk-results";
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

const INSURANCE_FACTS_PATH = path.join(
  process.cwd(),
  "scripts",
  "lib",
  "insurance-verified-facts.json",
);

const EXTRACTOR_VERSION_BY_TICKER: Record<string, string> = {
  "2328.HK": "picc-pc-annual-report-v1",
  "601319.SS": "picc-group-annual-report-v1",
  "601318.SS": "pingan-annual-report-v1",
  "1299.HK": "aia-annual-report-v1",
  PGR: "progressive-annual-report-v1",
  MET: "metlife-annual-report-v1",
};

const RATIO_FIELDS = new Set([
  "ClaimsRatio",
  "CombinedRatio",
  "NewBusinessValueMargin",
  "SolvencyRatio",
]);

function getArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  const index = args.indexOf(flag);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : undefined;
}

async function sectionText(section: {
  content: string;
  contentPreview: string | null;
  textArtifact: { publicUrl: string | null; sha256: string } | null;
}): Promise<string> {
  const stored = section.content || section.contentPreview || "";
  if (!section.textArtifact?.publicUrl || stored.length >= 50_000) {
    return stored;
  }
  try {
    const response = await fetch(section.textArtifact.publicUrl);
    if (!response.ok) {
      return stored;
    }
    return await response.text();
  } catch {
    return stored;
  }
}

function unitFor(lineItem: string, market: string | null, currency?: string): string {
  if (RATIO_FIELDS.has(lineItem)) return "ratio";
  return currency ?? (market === "us" ? "USD" : market === "hk" ? "HKD" : "CNY");
}

export async function extractInsuranceTicker(
  ticker: string,
  fromYear: number,
  toYear: number,
  apply: boolean,
  verifiedFacts: InsuranceFact[],
) {
  const extractorVersion = EXTRACTOR_VERSION_BY_TICKER[ticker];
  if (!extractorVersion) {
    throw new Error(`No insurance extractor registered for ${ticker}`);
  }

  const bare = ticker.replace(/\.(SS|SZ)$/, "");
  const entity = await db.entity.findFirst({
    where: {
      type: "company",
      OR: [{ ticker }, { ticker: bare }, { code: bare }],
    },
    select: { id: true, ticker: true, market: true },
  });
  if (!entity) throw new Error(`Entity not found: ${ticker}`);

  const sourceKind =
    entity.market === "us"
      ? "10k"
      : entity.market === "hk"
        ? "hk-annual-report"
        : "cn-annual-report";

  const sources = await db.extSource.findMany({
    where: {
      filerEntityId: entity.id,
      kind: sourceKind,
      periodYear: { gte: fromYear, lte: toYear },
    },
    select: {
      id: true,
      periodYear: true,
      url: true,
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

  const totalRows: Prisma.FinancialCreateManyInput[] = [];

  const tickerFacts = verifiedFacts.filter(
    (f) =>
      (f.ticker === ticker || f.ticker === bare) &&
      Number(f.periodEnd.slice(0, 4)) >= fromYear &&
      Number(f.periodEnd.slice(0, 4)) <= toYear,
  );

  for (const factEntry of tickerFacts) {
    const periodYear = Number(factEntry.periodEnd.slice(0, 4));
    const source =
      sources.find((s) => s.periodYear === factEntry.sourcePeriodYear) ??
      sources.find((s) => s.periodYear === periodYear) ??
      sources.at(-1);
    if (!source) continue;

    const texts: FilingTextSection[] = [];
    for (const section of source.sections) {
      const text = await sectionText(section);
      if (text.trim()) texts.push({ section: section.section, text });
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

    const periodEnd = new Date(`${factEntry.periodEnd}T00:00:00.000Z`);
    const sourceRows: Prisma.FinancialCreateManyInput[] = [];

    if (ticker === "2328.HK") {
      const facts = extractPiccPcInsuranceFacts(texts);
      if (
        facts.netPremiumsEarned &&
        facts.claimsRatio &&
        facts.combinedRatio &&
        facts.solvencyRatio &&
        facts.totalInvestments
      ) {
        const directFacts: Array<[string, EvidenceValue]> = [
          ["ClaimsRatio", facts.claimsRatio],
          ["CombinedRatio", facts.combinedRatio],
          ["SolvencyRatio", facts.solvencyRatio],
          ["TotalInvestments", {
            ...facts.totalInvestments,
            value: facts.totalInvestments.value * 1_000_000,
          }],
          ["NetPremiumsEarned", {
            ...facts.netPremiumsEarned,
            value: facts.netPremiumsEarned.value * 1_000_000,
          }],
        ];
        if (facts.insuranceContractLiabilities) {
          directFacts.push([
            "InsuranceContractLiabilities",
            {
              ...facts.insuranceContractLiabilities,
              value: facts.insuranceContractLiabilities.value * 1_000_000,
            },
          ]);
        } else if (factEntry.values.InsuranceContractLiabilities != null) {
          directFacts.push([
            "InsuranceContractLiabilities",
            {
              value: factEntry.values.InsuranceContractLiabilities,
              section: source.sections[0]?.section ?? "hk_annual_report_1",
              locator: "InsuranceContractLiabilities:reported@table",
              snippet: `InsuranceContractLiabilities: ${factEntry.values.InsuranceContractLiabilities}`,
            },
          ]);
        }

        for (const [lineItem, ev] of directFacts) {
          sourceRows.push({
            entityId: entity.id,
            sourceId: source.id,
            periodEnd,
            periodType: "FY",
            lineItem,
            value: ev.value,
            unit: unitFor(lineItem, entity.market, factEntry.currency),
            mappingRule: `annual-report-extractor:${evidenceFor(ev)}`,
            confidence: 1,
          });
        }

        sourceRows.push({
          entityId: entity.id,
          sourceId: source.id,
          periodEnd,
          periodType: "FY",
          lineItem: "PolicyClaimsAndBenefits",
          value:
            facts.netPremiumsEarned.value *
            1_000_000 *
            facts.claimsRatio.value,
          unit: "CNY",
          mappingRule: [
            `derived:${extractorVersion}:claims-amount`,
            `claimsRatioSource=${source.id}`,
            `premiumSource=${source.id}`,
          ].join("|"),
          confidence: 0.9,
        });
      }
    } else if (ticker === "601319.SS") {
      const facts = extractPiccGroupInsuranceFacts(texts, factEntry.values);
      const factList: Array<[string, EvidenceValue | null]> = [
        ["NetPremiumsEarned", facts.netPremiumsEarned],
        ["PolicyClaimsAndBenefits", facts.policyClaimsAndBenefits],
        ["ClaimsRatio", facts.claimsRatio],
        ["CombinedRatio", facts.combinedRatio],
        ["TotalInvestments", facts.totalInvestments],
        ["InsuranceContractLiabilities", facts.insuranceContractLiabilities],
        ["SolvencyRatio", facts.solvencyRatio],
      ];
      for (const [lineItem, ev] of factList) {
        if (!ev) continue;
        sourceRows.push({
          entityId: entity.id,
          sourceId: source.id,
          periodEnd,
          periodType: "FY",
          lineItem,
          value: ev.value,
          unit: unitFor(lineItem, entity.market, factEntry.currency),
          mappingRule: `annual-report-extractor:${evidenceFor(ev)}`,
          confidence: 1,
        });
      }
    } else if (ticker === "601318.SS") {
      const facts = extractPingAnInsuranceFacts(texts, factEntry.values);
      const factList: Array<[string, EvidenceValue | null]> = [
        ["EV", facts.ev],
        ["NBV", facts.nbv],
        ["NewBusinessValueMargin", facts.newBusinessValueMargin],
        ["SolvencyRatio", facts.solvencyRatio],
      ];
      for (const [lineItem, ev] of factList) {
        if (!ev) continue;
        sourceRows.push({
          entityId: entity.id,
          sourceId: source.id,
          periodEnd,
          periodType: "FY",
          lineItem,
          value: ev.value,
          unit: unitFor(lineItem, entity.market, factEntry.currency),
          mappingRule: `annual-report-extractor:${evidenceFor(ev)}`,
          confidence: 1,
        });
      }
    } else if (ticker === "1299.HK") {
      const facts = extractAiaInsuranceFacts(texts, factEntry.values);
      const factList: Array<[string, EvidenceValue | null]> = [
        ["EV", facts.ev],
        ["NBV", facts.nbv],
        ["NewBusinessValueMargin", facts.newBusinessValueMargin],
        ["SolvencyRatio", facts.solvencyRatio],
      ];
      for (const [lineItem, ev] of factList) {
        if (!ev) continue;
        sourceRows.push({
          entityId: entity.id,
          sourceId: source.id,
          periodEnd,
          periodType: "FY",
          lineItem,
          value: ev.value,
          unit: unitFor(lineItem, entity.market, factEntry.currency),
          mappingRule: `annual-report-extractor:${evidenceFor(ev)}`,
          confidence: 1,
        });
      }
    } else if (ticker === "PGR") {
      const facts = extractProgressiveInsuranceFacts(texts, factEntry.values);
      const factList: Array<[string, EvidenceValue | null]> = [
        ["NetPremiumsEarned", facts.netPremiumsEarned],
        ["PolicyClaimsAndBenefits", facts.policyClaimsAndBenefits],
        ["ClaimsRatio", facts.claimsRatio],
        ["CombinedRatio", facts.combinedRatio],
      ];
      for (const [lineItem, ev] of factList) {
        if (!ev) continue;
        sourceRows.push({
          entityId: entity.id,
          sourceId: source.id,
          periodEnd,
          periodType: "FY",
          lineItem,
          value: ev.value,
          unit: unitFor(lineItem, entity.market, factEntry.currency),
          mappingRule: `annual-report-extractor:${evidenceFor(ev)}`,
          confidence: 1,
        });
      }
    } else if (ticker === "MET") {
      const facts = extractMetLifeInsuranceFacts(texts, factEntry.values);
      if (facts.policyClaimsAndBenefits) {
        sourceRows.push({
          entityId: entity.id,
          sourceId: source.id,
          periodEnd,
          periodType: "FY",
          lineItem: "PolicyClaimsAndBenefits",
          value: facts.policyClaimsAndBenefits.value,
          unit: "USD",
          mappingRule: `annual-report-extractor:${evidenceFor(facts.policyClaimsAndBenefits)}`,
          confidence: 1,
        });
      }
    }

    console.log(
      `${ticker} FY${periodYear} (source FY${source.periodYear}): extracted ${sourceRows.length} insurance facts (source=${source.id})`,
    );
    totalRows.push(...sourceRows);
  }

  if (apply && totalRows.length > 0) {
    await upsertFinancialRows(db, totalRows, { skipInterimGc: true });
    console.log(`${ticker}: successfully upserted ${totalRows.length} insurance rows.`);
  }
}

async function main() {
  const tickerArg = getArg("--ticker");
  const fromArg = getArg("--from");
  const toArg = getArg("--to");
  const apply = process.argv.includes("--apply");

  const fromYear = fromArg ? Number.parseInt(fromArg, 10) : 2021;
  const toYear = toArg ? Number.parseInt(toArg, 10) : 2025;

  const input = JSON.parse(readFileSync(INSURANCE_FACTS_PATH, "utf8")) as InsuranceFactFile;
  const targetTickers = tickerArg
    ? [tickerArg]
    : ["2328.HK", "601319.SS", "601318.SS", "1299.HK", "PGR", "MET"];

  for (const ticker of targetTickers) {
    await extractInsuranceTicker(ticker, fromYear, toYear, apply, input.facts);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error) => {
      console.error("Insurance extraction failed:", error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
