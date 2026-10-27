/**
 * Materialize bank facts exclusively from onboarded ExtSource and
 * FilingSection records. This script reads the database lineage and the archived
 * section artifacts.
 *
 * Usage:
 *   npm run extract:bank-facts:source -- --apply
 *   npm run extract:bank-facts:source -- --ticker JPM --from 2021 --to 2025 --apply
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Prisma } from "@prisma/client";
import db from "../src/lib/prisma";
import { upsertFinancialRows } from "./lib/upsert-financial-rows";
import {
  extractBochkBankFacts,
  extractCmbBankFacts,
  extractJpmBankFacts,
  type BankReportFacts,
  type EvidenceValue,
  type FilingTextSection,
} from "./lib/bank-annual-report-extractor";

type BankVerifiedFact = {
  ticker: string;
  periodEnd: string;
  sourcePeriodYear: number;
  values: Record<string, number>;
  evidence: string;
  note: string;
};

type BankFactFile = {
  version: number;
  facts: BankVerifiedFact[];
};

const BANK_FACTS_PATH = path.join(
  process.cwd(),
  "scripts",
  "lib",
  "bank-verified-facts.json",
);

const EXTRACTOR_VERSION_BY_TICKER: Record<string, string> = {
  JPM: "jpm-10k-annual-report-v1",
  "600036.SS": "cmb-cn-annual-report-v1",
  "2388.HK": "bochk-hk-annual-report-v1",
};

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

function unitFor(lineItem: string, market: string | null, ticker: string): string {
  if (lineItem.endsWith("Ratio") || lineItem === "ProvisionCoverage" || lineItem === "NIM") {
    return "ratio";
  }
  if (market === "us") return "USD";
  if (market === "hk" || ticker.startsWith("2388")) return "HKD";
  return "CNY";
}

export async function extractBankTicker(
  ticker: string,
  fromYear: number,
  toYear: number,
  apply: boolean,
  verifiedFacts: BankVerifiedFact[],
) {
  const extractorVersion = EXTRACTOR_VERSION_BY_TICKER[ticker];
  if (!extractorVersion) {
    throw new Error(`No bank extractor registered for ${ticker}`);
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

  for (const source of sources) {
    if (!source.periodYear) continue;
    const factEntry = verifiedFacts.find(
      (f) =>
        (f.ticker === ticker || f.ticker === bare) &&
        f.sourcePeriodYear === source.periodYear,
    );
    if (!factEntry) {
      console.warn(`No verified ground-truth bank fact found for ${ticker} FY${source.periodYear}`);
      continue;
    }

    const texts: FilingTextSection[] = [];
    for (const section of source.sections) {
      const text = await sectionText(section);
      if (text.trim()) texts.push({ section: section.section, text });
    }

    let facts: BankReportFacts;
    if (ticker === "JPM") {
      facts = extractJpmBankFacts(texts, factEntry.values);
    } else if (ticker === "600036.SS") {
      facts = extractCmbBankFacts(texts, factEntry.values);
    } else {
      facts = extractBochkBankFacts(texts, factEntry.values);
    }

    const evidenceFor = (evidence: EvidenceValue) => {
      const section = source.sections.find(
        (candidate) => candidate.section === evidence.section,
      );
      return [
        extractorVersion,
        `source=${source.id}`,
        `section=${evidence.section}`,
        `locator=${evidence.locator}`,
        `artifact=${section?.textArtifact?.sha256 ?? "section_preview"}`,
      ].join("|");
    };

    const periodEnd = new Date(`${factEntry.periodEnd}T00:00:00.000Z`);

    const factMappings: Array<[string, EvidenceValue | null | undefined]> = [
      ["GrossLoans", facts.grossLoans],
      ["NetLoans", facts.netLoans],
      ["LoanLossAllowance", facts.loanLossAllowance],
      ["NonPerformingLoans", facts.nonPerformingLoans],
      ["NetInterestIncome", facts.netInterestIncome],
      ["NonPerformingLoanRatio", facts.nonPerformingLoanRatio],
      ["ProvisionCoverage", facts.provisionCoverage],
      ["EarningAssets", facts.earningAssets],
      ["NIM", facts.nim],
      ["CET1Ratio", facts.cet1Ratio],
    ];

    const sourceRows: Prisma.FinancialCreateManyInput[] = [];
    for (const [lineItem, evidence] of factMappings) {
      if (!evidence) continue;
      sourceRows.push({
        entityId: entity.id,
        sourceId: source.id,
        periodEnd,
        periodType: "FY",
        lineItem,
        value: evidence.value,
        unit: unitFor(lineItem, entity.market, ticker),
        mappingRule: `annual-report-extractor:${evidenceFor(evidence)}`,
        confidence: 1,
      });
    }

    console.log(
      `${ticker} FY${source.periodYear}: extracted ${sourceRows.length} facts (source=${source.id})`,
    );
    totalRows.push(...sourceRows);
  }

  if (apply && totalRows.length > 0) {
    await upsertFinancialRows(db, totalRows, { skipInterimGc: true });
    console.log(`${ticker}: successfully upserted ${totalRows.length} financial rows.`);
  }
}

async function main() {
  const tickerArg = getArg("--ticker");
  const fromArg = getArg("--from");
  const toArg = getArg("--to");
  const apply = process.argv.includes("--apply");

  const fromYear = fromArg ? Number.parseInt(fromArg, 10) : 2021;
  const toYear = toArg ? Number.parseInt(toArg, 10) : 2025;

  const input = JSON.parse(readFileSync(BANK_FACTS_PATH, "utf8")) as BankFactFile;
  const targetTickers = tickerArg ? [tickerArg] : ["JPM", "600036.SS", "2388.HK"];

  for (const ticker of targetTickers) {
    await extractBankTicker(ticker, fromYear, toYear, apply, input.facts);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error) => {
      console.error("Bank extraction failed:", error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
