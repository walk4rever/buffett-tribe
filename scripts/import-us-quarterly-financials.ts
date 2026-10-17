/**
 * scripts/import-us-quarterly-financials.ts
 *
 * Fetches SEC CompanyFacts for US filers and extracts quarterly financial statements
 * (10-Q) into the Financial table (periodType: 'Q1' | 'Q2' | 'Q3').
 *
 * Usage:
 *   node --env-file=.env.local ./node_modules/.bin/tsx scripts/import-us-quarterly-financials.ts --ticker AAPL
 *   node --env-file=.env.local ./node_modules/.bin/tsx scripts/import-us-quarterly-financials.ts --all
 */

import { pathToFileURL } from "node:url";
import prisma from "@/lib/prisma";
import { normalizeCurrencyCode } from "@/lib/fx-rates-core";
import { persistReportingCurrency } from "@/lib/reporting-currency";
import { getCompanyFacts, LINE_ITEMS } from "./lib/annual-report-import-core";
import { archiveFilingArtifact, fetchFilingIndexFiles, fetchSecText } from "./lib/filing-archive";
import { upsertFinancialRows } from "./lib/upsert-financial-rows";

const db = prisma;

function getArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  return args.find((_, i) => args[i - 1] === flag);
}

function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}


type QuarterFiling = {
  accn: string;
  fy: number;
  fp: "Q1" | "Q2" | "Q3";
  periodEnd: string;
  filedAt: string;
};

export async function importUsQuarterlyFinancialsForEntity(
  entityId: string,
  cik: string,
  ticker: string,
  options?: { archiveHtml?: boolean; archiveFromYear?: number; fromYear?: number },
) {
  const paddedCik = cik.padStart(10, "0");
  const facts = await getCompanyFacts(paddedCik);
  const gaap = facts.facts?.["us-gaap"] ?? {};
  const ifrs = facts.facts?.["ifrs-full"] ?? {};

  // 1. Discover all 10-Q filings from CompanyFacts
  const filingsByQuarter = new Map<string, QuarterFiling>(); // key: `${fy}-${fp}`
  const allConceptSets = [
    { concepts: gaap, isGaap: true },
    { concepts: ifrs, isGaap: false },
  ];

  for (const set of allConceptSets) {
    for (const item of LINE_ITEMS) {
      const tags = set.isGaap ? item.tagsUsGaap : item.tagsIfrs;
      for (const tag of tags) {
        const concept = set.concepts[tag];
        if (!concept?.units) continue;
        for (const rows of Object.values(concept.units)) {
          for (const r of rows) {
            if (r.form === "10-Q" && r.accn && r.fy && (r.fp === "Q1" || r.fp === "Q2" || r.fp === "Q3")) {
              const key = `${r.fy}-${r.fp}`;
              const existing = filingsByQuarter.get(key);
              const filed = r.filed ?? "0000-00-00";
              const end = r.end ?? "";
              if (!existing || (r.filed && r.filed > existing.filedAt) || (r.filed === existing.filedAt && end > existing.periodEnd)) {
                filingsByQuarter.set(key, {
                  accn: r.accn,
                  fy: r.fy,
                  fp: r.fp as "Q1" | "Q2" | "Q3",
                  periodEnd: end,
                  filedAt: filed,
                });
              }
            }
          }
        }
      }
    }
  }

  const minYear = options?.fromYear ?? 2020;
  const maxFyAgg = await db.financial.aggregate({
    where: { entityId, periodType: "FY" },
    _max: { periodEnd: true },
  });
  const maxFyDateStr = maxFyAgg._max.periodEnd
    ? maxFyAgg._max.periodEnd.toISOString().slice(0, 10)
    : null;

  const allDiscovered = [...filingsByQuarter.values()].filter((f) => f.fy >= minYear);
  const maxDiscoveredFy = allDiscovered.reduce((max, f) => (f.fy > max ? f.fy : max), 0);

  const sortedFilings = allDiscovered
    .filter((f) => {
      if (!f.periodEnd) return false;
      if (maxFyDateStr) {
        return f.periodEnd > maxFyDateStr;
      }
      return f.fy === maxDiscoveredFy;
    })
    .sort((a, b) => {
      if (a.fy !== b.fy) return a.fy - b.fy;
      return a.fp.localeCompare(b.fp);
    });

  if (!sortedFilings.length) {
    console.log(
      `  ${ticker} (${cik}): no newer 10-Q filings after max FY date (${maxFyDateStr ?? "none"}).`,
    );
    return 0;
  }

  // Pre-load existing ExtSource records to avoid redundant DB / network index lookups
  const existingSources = await db.extSource.findMany({
    where: { filerEntityId: entityId },
    select: { id: true, accessionNumber: true, url: true },
  });
  const existingSourceMap = new Map(existingSources.map((s) => [s.accessionNumber, s]));

  const financialRowsToInsert: Array<{
    entityId: string;
    sourceId: string;
    periodEnd: Date;
    periodType: string;
    lineItem: string;
    value: number;
    unit: string | null;
  }> = [];

  for (const filing of sortedFilings) {
    const quarterNum = filing.fp === "Q1" ? 1 : filing.fp === "Q2" ? 2 : 3;

    // Use cached/existing ExtSource if available, else create ExtSource
    const existing = existingSourceMap.get(filing.accn);
    let extSourceId: string;
    if (existing) {
      extSourceId = existing.id;
    } else {
      const filingUrl = `https://www.sec.gov/cgi-bin/viewer?action=view&cik=${cik}&accession_number=${filing.accn}&xbrl_type=v`;
      const created = await db.extSource.create({
        data: {
          kind: "10q",
          filerEntityId: entityId,
          accessionNumber: filing.accn,
          periodYear: filing.fy,
          periodQuarter: quarterNum,
          filedAt: filing.filedAt ? new Date(filing.filedAt) : null,
          url: filingUrl,
          metadata: {
            ticker,
            form: "10-Q",
            fy: filing.fy,
            fp: filing.fp,
            periodEnd: filing.periodEnd,
          },
        },
      });
      extSourceId = created.id;
      existingSourceMap.set(filing.accn, created);
    }

    if (options?.archiveHtml && (!options.archiveFromYear || filing.fy >= options.archiveFromYear)) {
      try {
        const existingArtifact = await db.filingArtifact.findFirst({
          where: { sourceId: extSourceId, kind: "primary_html" },
          select: { id: true },
        });
        if (!existingArtifact) {
          const { files } = await fetchFilingIndexFiles(paddedCik, filing.accn);
          const primaryDoc = files.find(
            (f) =>
              f.documentType === "10-Q" ||
              (f.sequence === "1" && (f.documentName.endsWith(".htm") || f.documentName.endsWith(".html"))),
          );
          if (primaryDoc) {
            const html = await fetchSecText(primaryDoc.url);
            await archiveFilingArtifact(db, {
              sourceId: extSourceId,
              kind: "primary_html",
              cik: paddedCik,
              accession: filing.accn,
              originalName: primaryDoc.documentName,
              contentType: "text/html",
              body: Buffer.from(html, "utf-8"),
              sourceUrl: primaryDoc.url,
            });
            await db.extSource.update({
              where: { id: extSourceId },
              data: { url: primaryDoc.url },
            });
            console.log(`    archived 10-Q HTML for ${ticker} ${filing.fy} ${filing.fp} (${primaryDoc.documentName})`);
          }
        }
      } catch (archiveErr) {
        console.warn(`    warning: failed to archive 10-Q HTML for ${ticker} ${filing.fy} ${filing.fp}:`, archiveErr);
      }
    }

    for (const item of LINE_ITEMS) {
      let candidateVal: number | null = null;
      let candidateUnit: string | null = null;

      for (const set of allConceptSets) {
        const tags = set.isGaap ? item.tagsUsGaap : item.tagsIfrs;
        for (const tag of tags) {
          const concept = set.concepts[tag];
          if (!concept?.units) continue;

          for (const [unit, rows] of Object.entries(concept.units)) {
            const matching = rows.filter((r) => r.accn === filing.accn && r.end === filing.periodEnd && r.val != null);
            if (!matching.length) continue;

            if (item.periodType === "instant") {
              // Point-in-time snapshot
              candidateVal = matching[0].val!;
              candidateUnit = unit;
              break;
            } else {
              // Duration item: preserve native YTD cumulative value (longest duration: Q1=3M, Q2=6M YTD, Q3=9M YTD)
              // to align Income Statement and Cash Flow Statement on the same YTD basis without cross-quarter subtraction noise.
              matching.sort((a, b) => {
                const durA = a.start && a.end ? new Date(a.end).getTime() - new Date(a.start).getTime() : 0;
                const durB = b.start && b.end ? new Date(b.end).getTime() - new Date(b.start).getTime() : 0;
                return durA - durB;
              });
              const longest = matching[matching.length - 1];
              candidateVal = longest.val!;
              candidateUnit = unit;
              break;
            }
          }
          if (candidateVal != null) break;
        }
        if (candidateVal != null) break;
      }

      if (candidateVal == null || !filing.periodEnd) continue;

      const periodEndDate = new Date(filing.periodEnd);
      if (Number.isNaN(periodEndDate.getTime())) continue;

      financialRowsToInsert.push({
        entityId,
        sourceId: extSourceId,
        periodEnd: periodEndDate,
        periodType: filing.fp,
        lineItem: item.key,
        value: candidateVal,
        unit: candidateUnit,
      });
    }
  }

  let totalUpserted = 0;
  if (financialRowsToInsert.length > 0) {
    const revenueCurrency = normalizeCurrencyCode(
      financialRowsToInsert.find((row) => row.lineItem === "Revenue")?.unit,
    );
    if (revenueCurrency) {
      const entity = await db.entity.findUnique({
        where: { id: entityId },
        select: { market: true },
      });
      await persistReportingCurrency(entityId, entity?.market ?? "us", revenueCurrency);
    }

    await upsertFinancialRows(db, financialRowsToInsert);
    totalUpserted = financialRowsToInsert.length;
  }

  console.log(
    `  ${ticker} (${cik}): upserted ${totalUpserted} Financial rows across ${sortedFilings.length} 10-Q filings.`,
  );
  return totalUpserted;
}

async function main() {
  const tickerArg = getArg("--ticker");
  const allArg = process.argv.includes("--all");

  if (!tickerArg && !allArg) {
    console.error("Usage: tsx scripts/import-us-quarterly-financials.ts --ticker <TICKER> | --all");
    process.exit(1);
  }

  const archiveHtml = hasFlag("--archive-html");
  const archiveFromArg = getArg("--archive-from");
  const archiveFromYear = archiveFromArg ? Number.parseInt(archiveFromArg, 10) : undefined;
  const options = { archiveHtml, archiveFromYear };

  if (tickerArg) {
    const entity = await db.entity.findFirst({
      where: { ticker: tickerArg, type: "company" },
      select: { id: true, cik: true, ticker: true },
    });
    if (!entity || !entity.cik) {
      console.error(`Entity not found or missing CIK for ticker ${tickerArg}`);
      process.exit(1);
    }
    await importUsQuarterlyFinancialsForEntity(entity.id, entity.cik, entity.ticker ?? tickerArg, options);
  } else if (allArg) {
    const entities = await db.entity.findMany({
      where: { type: "company", cik: { not: null } },
      select: { id: true, cik: true, ticker: true },
    });
    console.log(`Found ${entities.length} US entities with CIK.`);
    for (const [idx, e] of entities.entries()) {
      console.log(`[${idx + 1}/${entities.length}] Processing ${e.ticker ?? e.id} (CIK ${e.cik})...`);
      try {
        await importUsQuarterlyFinancialsForEntity(e.id, e.cik!, e.ticker ?? "UNKNOWN", options);
      } catch (err) {
        console.error(`  Failed for ${e.ticker ?? e.id}:`, err);
      }
    }
  }

  await db.$disconnect();
  console.log("Done.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(async (err) => {
    console.error(err);
    await db.$disconnect();
    process.exit(1);
  });
}
