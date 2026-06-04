import { PrismaClient } from "@prisma/client";
import { normalizeTicker } from "../src/lib/ticker";
import { fetchAllAnnualFilings } from "./lib/sec-company-profile";

const db = new PrismaClient();

const INVESTORS = [
  { tribeId: "buffett", label: "Buffett" },
  { tribeId: "lilu", label: "Li Lu" },
  { tribeId: "duan", label: "Duan Yongping" },
] as const;

const json = process.argv.includes("--json");
const strict = process.argv.includes("--strict");

type CoverageStatus = "ok" | "missing" | "short-history-assumed" | "no-company-link";

const secAnnualYearsCache = new Map<string, Promise<number[]>>();

function getTargetFiscalWindow(now = new Date()) {
  const endYear = now.getUTCFullYear() - 1;
  return {
    startYear: endYear - 4,
    endYear,
    years: Array.from({ length: 5 }, (_, i) => endYear - 4 + i),
  };
}

function formatList(values: Array<string | number>) {
  return values.length ? values.join(", ") : "—";
}

async function getSecAnnualYears(cik: string) {
  const key = cik.replace(/\D/g, "");
  const cached = secAnnualYearsCache.get(key);
  if (cached) return cached;

  const pending = (async () => {
    const filings = await fetchAllAnnualFilings(key);
    return [...new Set(
      filings
      .map((filing) => new Date(filing.reportDate).getUTCFullYear())
      .filter((year) => Number.isFinite(year)),
    )].sort((a, b) => a - b);
  })();

  secAnnualYearsCache.set(key, pending);
  return pending;
}

async function getLatestQuarter(tribeId: string) {
  const row = await db.extSource.findFirst({
    where: { kind: "13f", filer: { is: { tribeId } } },
    select: { periodYear: true, periodQuarter: true, ts: true },
    orderBy: [{ periodYear: "desc" }, { periodQuarter: "desc" }],
  });
  if (!row?.periodYear || !row.periodQuarter) return null;
  return {
    year: row.periodYear,
    quarter: row.periodQuarter,
    asOfDate: row.ts,
  };
}

async function getLatestQuarterHoldings(tribeId: string, year: number, quarter: number) {
  return db.holding.findMany({
    where: {
      holder: { tribeId },
      source: { is: { kind: "13f", periodYear: year, periodQuarter: quarter } },
    },
    include: {
      security: {
        include: {
          company: true,
        },
      },
    },
    orderBy: { percentOfPortfolio: "desc" },
  });
}

async function main() {
  const fiscalWindow = getTargetFiscalWindow();
  const results: Array<{
    investor: string;
    latestQuarter: string | null;
    companies: Array<{
      entityId: string | null;
      companyName: string;
      ticker: string | null;
      cik: string | null;
      holdingPct: number | null;
      financeStatus: CoverageStatus;
      analysisStatus: CoverageStatus;
      availableFinancialYears: number[];
      expectedFinancialYears: number[];
      missingFinancialYears: number[];
      note: string | null;
      import10kCommand: string | null;
      analysisCommand: string | null;
    }>;
  }> = [];

  for (const investor of INVESTORS) {
    const latest = await getLatestQuarter(investor.tribeId);
    if (!latest) {
      results.push({ investor: investor.label, latestQuarter: null, companies: [] });
      continue;
    }

    const holdings = await getLatestQuarterHoldings(investor.tribeId, latest.year, latest.quarter);
    const deduped = new Map<string, (typeof holdings)[number]>();

    for (const h of holdings) {
      const meta = (h.security.metadata ?? {}) as { companyEntityId?: string };
      const companyEntityId =
        h.security.companyEntityId ??
        (typeof meta.companyEntityId === "string" ? meta.companyEntityId : null);
      const key = companyEntityId ?? `sec:${h.securityId}`;
      const prev = deduped.get(key);
      if (!prev || (h.percentOfPortfolio ?? 0) > (prev.percentOfPortfolio ?? 0)) {
        deduped.set(key, h);
      }
    }

    const linkedCompanyIds = [...new Set(
      [...deduped.values()]
        .map((holding) => {
          const meta = (holding.security.metadata ?? {}) as { companyEntityId?: string };
          return (
            holding.security.companyEntityId ??
            (typeof meta.companyEntityId === "string" ? meta.companyEntityId : null)
          );
        })
        .filter((id): id is string => Boolean(id)),
    )];

    const linkedCompanies = linkedCompanyIds.length
      ? await db.entity.findMany({
          where: { id: { in: linkedCompanyIds } },
          select: { id: true, canonicalName: true, ticker: true, cik: true },
        })
      : [];
    const companyById = new Map(linkedCompanies.map((x) => [x.id, x] as const));

    const normalizedTickers = [...new Set(
      linkedCompanies
        .map((company) => normalizeTicker(company.ticker))
        .filter((ticker): ticker is string => Boolean(ticker)),
    )];
    const familyEntities = normalizedTickers.length
      ? await db.entity.findMany({
          where: {
            type: { in: ["company", "master"] },
            ticker: { in: normalizedTickers, mode: "insensitive" },
          },
          select: { id: true, ticker: true },
        })
      : [];
    const familyIdsByTicker = new Map<string, string[]>();
    for (const entity of familyEntities) {
      const ticker = normalizeTicker(entity.ticker);
      if (!ticker) continue;
      const list = familyIdsByTicker.get(ticker) ?? [];
      list.push(entity.id);
      familyIdsByTicker.set(ticker, list);
    }

    const familyEntityIds = [...new Set(familyEntities.map((x) => x.id).concat(linkedCompanyIds))];
    const financialRows = familyEntityIds.length
      ? await db.financial.findMany({
          where: {
            entityId: { in: familyEntityIds },
            periodType: "FY",
          },
          select: { entityId: true, periodEnd: true },
        })
      : [];
    const financialYearsByEntityId = new Map<string, Set<number>>();
    for (const row of financialRows) {
      const year = row.periodEnd.getUTCFullYear();
      const set = financialYearsByEntityId.get(row.entityId) ?? new Set<number>();
      set.add(year);
      financialYearsByEntityId.set(row.entityId, set);
    }

    const analyses = linkedCompanyIds.length
      ? await db.companyAnalysis.findMany({
          where: { entityId: { in: linkedCompanyIds } },
          select: { entityId: true },
        })
      : [];
    const analyzedEntityIds = new Set(analyses.map((x) => x.entityId));

    const companies = [];
    for (const holding of deduped.values()) {
      const meta = (holding.security.metadata ?? {}) as { companyEntityId?: string };
      const linkedCompany =
        holding.security.company ??
        (typeof meta.companyEntityId === "string" ? companyById.get(meta.companyEntityId) ?? null : null);

      if (!linkedCompany) {
        companies.push({
          entityId: null,
          companyName: holding.security.company?.canonicalName ?? holding.security.titleOfClass ?? holding.security.ticker ?? "Unknown",
          ticker: normalizeTicker(holding.security.ticker),
          cik: null,
          holdingPct: holding.percentOfPortfolio,
          financeStatus: "no-company-link" as CoverageStatus,
          analysisStatus: "no-company-link" as CoverageStatus,
          availableFinancialYears: [],
          expectedFinancialYears: fiscalWindow.years,
          missingFinancialYears: fiscalWindow.years,
          note: "Holding has no linked company entity.",
          import10kCommand: null,
          analysisCommand: null,
        });
        continue;
      }

      const ticker = normalizeTicker(linkedCompany.ticker ?? holding.security.ticker);
      const familyIds = ticker ? familyIdsByTicker.get(ticker) ?? [linkedCompany.id] : [linkedCompany.id];
      const financialYears = [...new Set(
        familyIds.flatMap((id) => [...(financialYearsByEntityId.get(id) ?? new Set<number>()).values()]),
      )].sort((a, b) => a - b);
      const oldestAvailableYear = financialYears[0] ?? null;
      const expectedYears =
        oldestAvailableYear != null && oldestAvailableYear > fiscalWindow.startYear
          ? fiscalWindow.years.filter((y) => y >= oldestAvailableYear)
          : fiscalWindow.years;
      let missingYears = expectedYears.filter((year) => !financialYears.includes(year));
      let financeStatus: CoverageStatus =
        missingYears.length === 0
          ? oldestAvailableYear != null && oldestAvailableYear > fiscalWindow.startYear
            ? "short-history-assumed"
            : "ok"
          : "missing";
      let note: string | null = null;

      if (
        linkedCompany.cik &&
        (financeStatus === "short-history-assumed" || financeStatus === "missing")
      ) {
        try {
          const secAnnualYears = await getSecAnnualYears(linkedCompany.cik);
          const secWindowYears = fiscalWindow.years.filter((year) => secAnnualYears.includes(year));
          const expectedFromSec = secWindowYears.length > 0 ? secWindowYears : expectedYears;
          missingYears = expectedFromSec.filter((year) => !financialYears.includes(year));
          financeStatus = missingYears.length === 0 ? "ok" : "missing";

          if (financeStatus === "ok" && expectedFromSec.length < fiscalWindow.years.length) {
            financeStatus = "short-history-assumed";
            note = `SEC annual filings within window only cover ${formatList(expectedFromSec)}; treating earlier years as short history.`;
          } else if (financeStatus === "missing" && expectedFromSec.length > 0) {
            note = `SEC annual filings exist for ${formatList(expectedFromSec)} but DB is missing ${formatList(missingYears)}.`;
          }
        } catch {
          note =
            financeStatus === "short-history-assumed"
              ? `SEC submissions check failed; fallback to DB-only short-history assumption.`
              : `SEC submissions check failed; keeping DB-only coverage result.`;
        }
      }

      if (!note && financeStatus === "short-history-assumed") {
        note = `Only ${financialYears.length} FY years in DB; treating ${oldestAvailableYear}-${fiscalWindow.endYear} as the expected window.`;
      }

      const import10kCommand =
        ticker && missingYears.length > 0
          ? `npm run import:10k -- --ticker ${ticker} --from ${Math.min(...missingYears)} --to ${Math.max(...missingYears)}`
          : null;
      const analysisCommand =
        !analyzedEntityIds.has(linkedCompany.id) && ticker
          ? `npm run generate:value-analysis -- --company ${ticker}`
          : !analyzedEntityIds.has(linkedCompany.id)
            ? `npm run generate:value-analysis -- --company \"${linkedCompany.canonicalName}\"`
            : null;

      companies.push({
        entityId: linkedCompany.id,
        companyName: linkedCompany.canonicalName,
        ticker,
        cik: linkedCompany.cik,
        holdingPct: holding.percentOfPortfolio,
        financeStatus,
        analysisStatus: analyzedEntityIds.has(linkedCompany.id) ? "ok" : "missing",
        availableFinancialYears: financialYears,
        expectedFinancialYears: expectedYears,
        missingFinancialYears: missingYears,
        note,
        import10kCommand,
        analysisCommand,
      });
    }

    results.push({
      investor: investor.label,
      latestQuarter: `${latest.year}Q${latest.quarter}`,
      companies: companies.sort((a, b) => (b.holdingPct ?? 0) - (a.holdingPct ?? 0)),
    });
  }

  const summary = {
    fiscalWindow,
    investors: results.map((r) => ({
      investor: r.investor,
      latestQuarter: r.latestQuarter,
      totalCompanies: r.companies.length,
      financeMissing: r.companies.filter((x) => x.financeStatus === "missing" || x.financeStatus === "no-company-link").length,
      analysisMissing: r.companies.filter((x) => x.analysisStatus === "missing" || x.analysisStatus === "no-company-link").length,
      shortHistoryAssumed: r.companies.filter((x) => x.financeStatus === "short-history-assumed").length,
    })),
  };

  if (json) {
    console.log(JSON.stringify({ summary, results }, null, 2));
  } else {
    console.log(`Latest holdings company coverage check`);
    console.log(`Fiscal window: ${fiscalWindow.startYear}-${fiscalWindow.endYear}`);
    console.log();
    for (const investor of results) {
      console.log(`${investor.investor} | latest quarter: ${investor.latestQuarter ?? "N/A"}`);
      console.log(`Companies: ${investor.companies.length}`);
      for (const company of investor.companies) {
        const pct = company.holdingPct == null ? "—" : `${company.holdingPct.toFixed(2)}%`;
        console.log(
          `- ${company.companyName}${company.ticker ? ` (${company.ticker})` : ""} | ${pct} | finance=${company.financeStatus} | analysis=${company.analysisStatus}`,
        );
        if (company.missingFinancialYears.length > 0) {
          console.log(`  missing FY years: ${formatList(company.missingFinancialYears)}`);
        }
        if (company.availableFinancialYears.length > 0) {
          console.log(`  available FY years: ${formatList(company.availableFinancialYears)}`);
        }
        if (company.note) console.log(`  note: ${company.note}`);
        if (company.import10kCommand) console.log(`  import: ${company.import10kCommand}`);
        if (company.analysisCommand) console.log(`  analysis: ${company.analysisCommand}`);
      }
      console.log();
    }
    console.log(`Summary`);
    for (const row of summary.investors) {
      console.log(
        `- ${row.investor}: total=${row.totalCompanies}, financeMissing=${row.financeMissing}, analysisMissing=${row.analysisMissing}, shortHistoryAssumed=${row.shortHistoryAssumed}`,
      );
    }
  }

  const hasFailures = results.some((r) =>
    r.companies.some((c) =>
      c.financeStatus === "missing" ||
      c.financeStatus === "no-company-link" ||
      c.analysisStatus === "missing" ||
      c.analysisStatus === "no-company-link",
    ),
  );

  if (strict && hasFailures) {
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error("[check-latest-holdings-company-coverage] fatal", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
