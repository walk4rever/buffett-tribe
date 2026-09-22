/**
 * Fast SEC CompanyFacts & Financials Backfill (Pure TypeScript, Zero Python, Zero LLM)
 *
 * Fetches audited 10-K/20-F financial statement facts and filing references directly
 * from SEC EDGAR official REST APIs (submissions and companyfacts JSON), and batch-upserts
 * ExtSource and Financial records.
 *
 * Usage:
 *   npx tsx scripts/backfill-company-financials-fast.ts --ticker ACN
 *   npx tsx scripts/backfill-company-financials-fast.ts --ticker HD --from 2020
 *   npx tsx scripts/backfill-company-financials-fast.ts --all-pending --limit 5
 *   npx tsx scripts/backfill-company-financials-fast.ts --all-pending
 *   npx tsx scripts/backfill-company-financials-fast.ts --all-pending --dry-run
 */

import { PrismaClient, Prisma } from "@prisma/client";
import { pathToFileURL } from "node:url";
import {
  ANNUAL_FORMS,
  LINE_ITEMS,
  decimalFromNumber,
  getCompanyFacts,
} from "./lib/annual-report-import-core";
import {
  fetchSecSubmissionFile,
  fetchSecSubmissions,
  mapSectorFromSic,
  pickAnnualFilingsFromRecent,
  pickCompanyProfile,
  pickRecentAnnualFilings,
  type SecRecentFiling,
} from "./lib/sec-company-profile";

const db = new PrismaClient();

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Enhanced fact value resolution:
 * Enforces duration >= 300 days for duration concepts (e.g. Revenue, Net Income),
 * preventing accidental selection of Q4 3-month figures that share the 10-K reportDate.
 */
function findBestAnnualFactValue(
  facts: Awaited<ReturnType<typeof getCompanyFacts>>,
  tagsUsGaap: string[],
  tagsIfrs: string[],
  unitCandidates: string[],
  reportDate: string,
  periodType: "instant" | "duration",
): number | null {
  const gaap = facts.facts?.["us-gaap"] ?? {};
  const ifrs = facts.facts?.["ifrs-full"] ?? {};
  const candidates: Array<{ filed: string; val: number }> = [];

  const conceptSets = [
    { concepts: gaap, tags: tagsUsGaap },
    { concepts: ifrs, tags: tagsIfrs },
  ];

  for (const set of conceptSets) {
    for (const tag of set.tags) {
      const concept = set.concepts[tag];
      if (!concept?.units) continue;

      const preferredUnitRows = unitCandidates.flatMap((unit) => concept.units?.[unit] ?? []);
      const rowsToCheck = preferredUnitRows.length > 0 ? preferredUnitRows : Object.values(concept.units).flat();

      for (const row of rowsToCheck) {
        if (!row || row.end !== reportDate || typeof row.val !== "number") continue;
        if (!ANNUAL_FORMS.has(row.form ?? "")) continue;

        // Ensure duration facts span a full annual period (~365 days), not a single quarter (~90 days)
        if (periodType === "duration" && row.start) {
          const days = (new Date(row.end).getTime() - new Date(row.start).getTime()) / 86400000;
          if (days < 300) continue;
        }

        candidates.push({
          filed: row.filed ?? "0000-00-00",
          val: row.val,
        });
      }

      if (candidates.length) break;
    }
    if (candidates.length) break;
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => (a.filed < b.filed ? 1 : -1));
  return candidates[0].val;
}

/**
 * Efficiently fetch annual filings from SEC submissions:
 * Only fetches older submission files if the target fromYear is not already
 * covered in the primary 'recent' filings list.
 */
async function fetchTargetAnnualFilings(cik: string, fromYear: number): Promise<SecRecentFiling[]> {
  const root = await fetchSecSubmissions(cik);
  const filings = pickRecentAnnualFilings(root);

  const minRecentYear = filings.reduce((min, f) => {
    const y = new Date(f.reportDate).getUTCFullYear();
    return y < min ? y : min;
  }, 9999);

  if (minRecentYear > fromYear && root.filings?.files) {
    for (const ref of root.filings.files) {
      const fileToYear = ref.filingTo ? Number(ref.filingTo.slice(0, 4)) : 0;
      if (fileToYear < fromYear) continue;

      try {
        const payload = await fetchSecSubmissionFile(ref.name);
        filings.push(...pickAnnualFilingsFromRecent(payload));
      } catch (err) {
        console.warn(`Warning: failed to fetch historical filings file ${ref.name}:`, err);
      }
    }
  }

  const deduped = new Map<string, SecRecentFiling>();
  for (const filing of filings) {
    deduped.set(filing.accession, filing);
  }

  return [...deduped.values()].sort((a, b) => (a.reportDate < b.reportDate ? 1 : -1));
}

export type BackfillResult = {
  ticker: string;
  cik: string;
  name: string;
  filingsCount: number;
  financialRowsUpserted: number;
  years: number[];
  durationMs: number;
  error?: string;
};

export async function backfillCompanyFinancialsFast(params: {
  entityId: string;
  cik: string;
  ticker: string;
  fromYear?: number;
  toYear?: number;
  dryRun?: boolean;
}): Promise<BackfillResult> {
  const start = Date.now();
  const fromYear = params.fromYear ?? 2020;
  const toYear = params.toYear ?? new Date().getFullYear();
  const paddedCik = params.cik.replace(/^CIK/i, "").padStart(10, "0");

  // 1. Fetch SEC submissions & profile in parallel with company facts
  const [subData, facts] = await Promise.all([
    fetchSecSubmissions(paddedCik),
    getCompanyFacts(paddedCik),
  ]);

  const profile = pickCompanyProfile(subData);

  // 2. Fetch annual filings (10-K, 20-F) within range
  const allAnnuals = await fetchTargetAnnualFilings(paddedCik, fromYear);
  const targetFilings = allAnnuals.filter((f) => {
    const y = new Date(f.reportDate).getUTCFullYear();
    return y >= fromYear && y <= toYear;
  });

  if (!targetFilings.length) {
    return {
      ticker: params.ticker,
      cik: paddedCik,
      name: profile.name ?? params.ticker,
      filingsCount: 0,
      financialRowsUpserted: 0,
      years: [],
      durationMs: Date.now() - start,
      error: `No annual filings found in range ${fromYear}-${toYear}`,
    };
  }

  if (params.dryRun) {
    return {
      ticker: params.ticker,
      cik: paddedCik,
      name: profile.name ?? params.ticker,
      filingsCount: targetFilings.length,
      financialRowsUpserted: targetFilings.length * LINE_ITEMS.length,
      years: targetFilings.map((f) => new Date(f.reportDate).getUTCFullYear()),
      durationMs: Date.now() - start,
    };
  }

  // 3. Update Entity metadata (Sector, Industry, Exchange, State of Incorporation)
  const sector = mapSectorFromSic(profile.sic, profile.sicDescription);
  const existingEntity = await db.entity.findUnique({
    where: { id: params.entityId },
    select: { sector: true, metadata: true },
  });

  const existingMeta = (existingEntity?.metadata as Record<string, unknown>) ?? {};
  const updatedMeta = {
    ...existingMeta,
    industry: profile.sicDescription ?? existingMeta.industry,
    exchange: profile.exchanges[0] ?? existingMeta.exchange,
    exchanges: profile.exchanges.length ? profile.exchanges : existingMeta.exchanges,
    sic: profile.sic ?? existingMeta.sic,
    secCategory: profile.category ?? existingMeta.secCategory,
    fiscalYearEnd: profile.fiscalYearEnd ?? existingMeta.fiscalYearEnd,
    stateOfIncorporation: profile.stateOfIncorporation ?? existingMeta.stateOfIncorporation,
    stateOfIncorporationDescription:
      profile.stateOfIncorporationDescription ?? existingMeta.stateOfIncorporationDescription,
  };

  await db.entity.update({
    where: { id: params.entityId },
    data: {
      sector: existingEntity?.sector ?? sector,
      metadata: updatedMeta,
    },
  });

  // 4. Batch resolve ExtSources
  const accessions = targetFilings.map((f) => f.accession);
  const existingSources = await db.extSource.findMany({
    where: { filerEntityId: params.entityId, accessionNumber: { in: accessions } },
  });
  const sourceByAccession = new Map(existingSources.map((s) => [s.accessionNumber, s]));

  const extSourcesToCreate: Prisma.ExtSourceCreateManyInput[] = [];
  for (const filing of targetFilings) {
    if (!sourceByAccession.has(filing.accession)) {
      const year = new Date(filing.reportDate).getUTCFullYear();
      const quarter = Math.ceil((new Date(filing.reportDate).getUTCMonth() + 1) / 3);
      const accnoPath = filing.accession.replace(/-/g, "");
      const kind = filing.form.startsWith("20-F") ? "20f" : filing.form.startsWith("40-F") ? "40f" : "10k";

      extSourcesToCreate.push({
        kind,
        filerEntityId: params.entityId,
        accessionNumber: filing.accession,
        periodYear: year,
        periodQuarter: quarter,
        ts: new Date(filing.reportDate),
        filedAt: new Date(filing.filedAt),
        url: `https://www.sec.gov/Archives/edgar/data/${paddedCik}/${accnoPath}/${filing.primaryDocument}`,
        metadata: {
          accession: filing.accession,
          primaryDocument: filing.primaryDocument,
          form: filing.form,
        },
      });
    }
  }

  if (extSourcesToCreate.length) {
    await db.extSource.createMany({ data: extSourcesToCreate, skipDuplicates: true });
    const refreshed = await db.extSource.findMany({
      where: { filerEntityId: params.entityId, accessionNumber: { in: accessions } },
    });
    for (const s of refreshed) {
      sourceByAccession.set(s.accessionNumber!, s);
    }
  }

  // 5. Extract all financial rows across all filings in-memory
  const financialRowsToInsert: Array<{
    entityId: string;
    sourceId: string;
    periodEnd: Date;
    periodType: string;
    lineItem: string;
    value: Prisma.Decimal;
    unit: string;
  }> = [];

  const processedYears: number[] = [];

  for (const filing of targetFilings) {
    const year = new Date(filing.reportDate).getUTCFullYear();
    processedYears.push(year);
    const extSource = sourceByAccession.get(filing.accession);
    if (!extSource) continue;

    let totalAssets: number | null = null;
    let shareholdersEquity: number | null = null;

    for (const item of LINE_ITEMS) {
      let value = findBestAnnualFactValue(
        facts,
        item.tagsUsGaap,
        item.tagsIfrs,
        item.unitCandidates,
        filing.reportDate,
        item.periodType,
      );

      if (item.key === "TotalAssets" && value != null) totalAssets = value;
      if (item.key === "ShareholdersEquity" && value != null) shareholdersEquity = value;

      if (item.key === "TotalLiabilities" && value == null && totalAssets != null && shareholdersEquity != null) {
        value = totalAssets - shareholdersEquity;
      }

      if (value == null) continue;

      const unit = item.unitCandidates[0] ?? "USD";
      const decimalVal = decimalFromNumber(value);
      if (!decimalVal) continue;

      financialRowsToInsert.push({
        entityId: params.entityId,
        sourceId: extSource.id,
        periodEnd: new Date(filing.reportDate),
        periodType: "FY",
        lineItem: item.key,
        value: decimalVal,
        unit,
      });
    }
  }

  // 6. Fast batch transaction: delete target range & insert in one roundtrip
  if (financialRowsToInsert.length) {
    const periodEnds = targetFilings.map((f) => new Date(f.reportDate));
    await db.$transaction([
      db.financial.deleteMany({
        where: {
          entityId: params.entityId,
          periodEnd: { in: periodEnds },
          periodType: "FY",
        },
      }),
      db.financial.createMany({
        data: financialRowsToInsert,
        skipDuplicates: true,
      }),
    ]);
  }

  return {
    ticker: params.ticker,
    cik: paddedCik,
    name: profile.name ?? params.ticker,
    filingsCount: targetFilings.length,
    financialRowsUpserted: financialRowsToInsert.length,
    years: processedYears.sort((a, b) => a - b),
    durationMs: Date.now() - start,
  };
}

async function main() {
  const tickerArg = getArg("--ticker")?.toUpperCase();
  const cikArg = getArg("--cik");
  const allPending = hasFlag("--all-pending");
  const dryRun = hasFlag("--dry-run");
  const fromYear = getArg("--from") ? Number(getArg("--from")) : 2020;
  const toYear = getArg("--to") ? Number(getArg("--to")) : 2026;
  const limit = getArg("--limit") ? Number(getArg("--limit")) : undefined;
  const delayMs = getArg("--delay") ? Number(getArg("--delay")) : 100;

  console.log("=== Fast SEC CompanyFacts & Financials Backfill ===");
  console.log(`Config: from=${fromYear}, to=${toYear}, dryRun=${dryRun}, delay=${delayMs}ms\n`);

  if (tickerArg || cikArg) {
    const entity = await db.entity.findFirst({
      where: tickerArg ? { ticker: tickerArg } : { cik: cikArg },
      select: { id: true, ticker: true, cik: true, canonicalName: true },
    });

    if (!entity || !entity.cik) {
      console.error(`Error: Entity not found or missing CIK for ${tickerArg ?? cikArg}`);
      process.exit(1);
    }

    console.log(`Backfilling [${entity.ticker ?? entity.canonicalName}] (CIK ${entity.cik})...`);
    try {
      const res = await backfillCompanyFinancialsFast({
        entityId: entity.id,
        cik: entity.cik,
        ticker: entity.ticker ?? entity.canonicalName,
        fromYear,
        toYear,
        dryRun,
      });
      console.log(`✅ Completed in ${res.durationMs}ms:`);
      console.log(`   - Name: ${res.name}`);
      console.log(`   - Filings: ${res.filingsCount} annual filings`);
      console.log(`   - Financials upserted: ${res.financialRowsUpserted} rows`);
      console.log(`   - Years covered: [${res.years.join(", ")}]`);
    } catch (err) {
      console.error("❌ Failed:", err);
      process.exit(1);
    }
    return;
  }

  if (allPending) {
    const pendingEntities = await db.entity.findMany({
      where: {
        type: "company",
        cik: { not: null },
        financials: { none: {} },
      },
      select: {
        id: true,
        ticker: true,
        cik: true,
        canonicalName: true,
      },
      orderBy: { canonicalName: "asc" },
      take: limit,
    });

    console.log(`Found ${pendingEntities.length} pending companies with CIK and 0 financials.\n`);

    if (pendingEntities.length === 0) {
      console.log("No pending companies to backfill!");
      return;
    }

    let successCount = 0;
    let failCount = 0;
    let totalRows = 0;
    const startTime = Date.now();

    for (let i = 0; i < pendingEntities.length; i++) {
      const entity = pendingEntities[i];
      const ticker = entity.ticker ?? entity.canonicalName;
      process.stdout.write(`[${i + 1}/${pendingEntities.length}] ${ticker} (CIK ${entity.cik})... `);

      try {
        const res = await backfillCompanyFinancialsFast({
          entityId: entity.id,
          cik: entity.cik!,
          ticker,
          fromYear,
          toYear,
          dryRun,
        });

        if (res.error) {
          console.log(`⚠️  ${res.error} (${res.durationMs}ms)`);
        } else {
          successCount++;
          totalRows += res.financialRowsUpserted;
          console.log(
            `✅ ${res.filingsCount} filings, ${res.financialRowsUpserted} facts [${res.years.join(",")}] (${res.durationMs}ms)`,
          );
        }
      } catch (err) {
        failCount++;
        console.log(`❌ Error: ${err instanceof Error ? err.message : String(err)}`);
      }

      if (delayMs > 0 && i < pendingEntities.length - 1) {
        await sleep(delayMs);
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log("\n==========================================");
    console.log(`Backfill finished in ${elapsed}s:`);
    console.log(`  - Successful: ${successCount}`);
    console.log(`  - Failed/Skipped: ${failCount}`);
    console.log(`  - Total financial facts upserted: ${totalRows}`);
    console.log("==========================================");
    return;
  }

  console.log("Please specify either --ticker <TICKER> or --all-pending");
  console.log("Examples:");
  console.log("  npx tsx scripts/backfill-company-financials-fast.ts --ticker ACN");
  console.log("  npx tsx scripts/backfill-company-financials-fast.ts --all-pending --limit 5");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
