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

import { PrismaClient } from "@prisma/client";
import { getCompanyFacts, LINE_ITEMS } from "./lib/annual-report-import-core";
import { archiveFilingArtifact, fetchFilingIndexFiles, fetchSecText } from "./lib/filing-archive";

const db = new PrismaClient();

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
  options?: { archiveHtml?: boolean; archiveFromYear?: number },
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
              if (!existing || (r.filed && r.filed > existing.filedAt)) {
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

  const sortedFilings = [...filingsByQuarter.values()].sort((a, b) => {
    if (a.fy !== b.fy) return a.fy - b.fy;
    return a.fp.localeCompare(b.fp);
  });

  if (!sortedFilings.length) {
    console.log(`  ${ticker} (${cik}): no 10-Q filings discovered in SEC CompanyFacts.`);
    return 0;
  }

  // YTD cash-flow values for calculating discrete quarter values:
  // Map `${fy}-${fp}-${lineItem}` -> cumulative YTD value
  const ytdValues = new Map<string, number>();

  let totalUpserted = 0;

  for (const filing of sortedFilings) {
    const quarterNum = filing.fp === "Q1" ? 1 : filing.fp === "Q2" ? 2 : 3;

    // Upsert ExtSource
    const extSource = await db.extSource.upsert({
      where: {
        ExtSource_filer_accession_unique: {
          filerEntityId: entityId,
          accessionNumber: filing.accn,
        },
      },
      create: {
        kind: "10q",
        filerEntityId: entityId,
        accessionNumber: filing.accn,
        periodYear: filing.fy,
        periodQuarter: quarterNum,
        filedAt: filing.filedAt ? new Date(filing.filedAt) : null,
        metadata: {
          ticker,
          form: "10-Q",
          fy: filing.fy,
          fp: filing.fp,
          periodEnd: filing.periodEnd,
        },
      },
      update: {
        periodYear: filing.fy,
        periodQuarter: quarterNum,
        filedAt: filing.filedAt ? new Date(filing.filedAt) : null,
      },
    });

    if (options?.archiveHtml && (!options.archiveFromYear || filing.fy >= options.archiveFromYear)) {
      try {
        const existingArtifact = await db.filingArtifact.findFirst({
          where: { sourceId: extSource.id, kind: "primary_html" },
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
              sourceId: extSource.id,
              kind: "primary_html",
              cik: paddedCik,
              accession: filing.accn,
              originalName: primaryDoc.documentName,
              contentType: "text/html",
              body: Buffer.from(html, "utf-8"),
              sourceUrl: primaryDoc.url,
            });
            await db.extSource.update({
              where: { id: extSource.id },
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
            const matching = rows.filter((r) => r.accn === filing.accn && r.val != null);
            if (!matching.length) continue;

            if (item.periodType === "instant") {
              // Point-in-time snapshot
              candidateVal = matching[0].val!;
              candidateUnit = unit;
              break;
            } else {
              // Duration item:
              // Sort by duration ascending so discrete 3-month is preferred over 6-month / 9-month YTD
              matching.sort((a, b) => {
                const durA = a.start && a.end ? new Date(a.end).getTime() - new Date(a.start).getTime() : 0;
                const durB = b.start && b.end ? new Date(b.end).getTime() - new Date(b.start).getTime() : 0;
                return durA - durB;
              });
              const shortest = matching[0];
              const longest = matching[matching.length - 1];

              const durationDays =
                shortest.start && shortest.end
                  ? (new Date(shortest.end).getTime() - new Date(shortest.start).getTime()) / 86400000
                  : 0;

              // If duration is <= 110 days, it is a single quarter (~3 months)
              if (durationDays > 0 && durationDays <= 110) {
                candidateVal = shortest.val!;
                candidateUnit = unit;
              } else {
                // Cash flow statement or YTD: record YTD value and subtract prior quarter if available
                const ytdVal = longest.val!;
                ytdValues.set(`${filing.fy}-${filing.fp}-${item.key}`, ytdVal);

                let discreteVal = ytdVal;
                if (filing.fp === "Q2") {
                  const q1Val = ytdValues.get(`${filing.fy}-Q1-${item.key}`);
                  if (q1Val != null) discreteVal = ytdVal - q1Val;
                } else if (filing.fp === "Q3") {
                  const q2Val = ytdValues.get(`${filing.fy}-Q2-${item.key}`);
                  if (q2Val != null) discreteVal = ytdVal - q2Val;
                }

                candidateVal = discreteVal;
                candidateUnit = unit;
              }
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

      await db.financial.upsert({
        where: {
          entityId_periodEnd_periodType_lineItem: {
            entityId,
            periodEnd: periodEndDate,
            periodType: filing.fp,
            lineItem: item.key,
          },
        },
        create: {
          entityId,
          sourceId: extSource.id,
          periodEnd: periodEndDate,
          periodType: filing.fp,
          lineItem: item.key,
          value: candidateVal,
          unit: candidateUnit,
        },
        update: {
          sourceId: extSource.id,
          value: candidateVal,
          unit: candidateUnit,
        },
      });

      totalUpserted++;
    }
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

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
