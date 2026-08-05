/**
 * Import SEC Schedule 13D / 13D-A / 13G / 13G-A beneficial-ownership filings
 * for tracked investors — event-triggered disclosures of % of an issuer's
 * share class, distinct from the quarterly 13F portfolio snapshot already
 * imported by import-13f-edgartools.ts / scripts/lib/13f-import-core.ts.
 *
 * Fetches directly from SEC EDGAR's JSON submissions API + each filing's
 * primary_doc.xml (not via edgartools/Python — 13D/13G structured parsing
 * support there is unverified, and this path was hand-validated during
 * research against real filings before writing this script).
 *
 * Usage:
 *   npm run import:beneficial-ownership -- --filer leopold-aschenbrenner --from 2024
 *   npm run import:beneficial-ownership -- --from 2021   (all tracked filers)
 */

import { XMLParser } from "fast-xml-parser";
import prisma from "@/lib/prisma";
import { getTrackedFilers, type FilerConfig } from "./lib/13f-import-core";

const USER_AGENT = "buffett-tribe research walkklaw@gmail.com";
const REQUEST_DELAY_MS = 200; // stay well under SEC's 10 req/s fair-access limit

function getArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function padCik(cik: string): string {
  return cik.padStart(10, "0");
}

// Entity.cik is stored unpadded (e.g. "1513845", not "0001513845" — see other
// Entity rows) — normalize any CIK pulled from filing XML to that convention
// before storing/matching, distinct from padCik's use for SEC API URLs.
function normalizeCik(cik: string): string {
  return cik.replace(/^0+/, "") || "0";
}

type SecSubmissionsResponse = {
  filings?: {
    recent?: {
      form: string[];
      filingDate: string[];
      accessionNumber: string[];
    };
  };
};

async function fetchJson(url: string): Promise<SecSubmissionsResponse> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

// SEC's `form` field is inconsistent across filers/eras — some report
// "SC 13G", others "SCHEDULE 13G" — so classify by substring, not exact match.
function classifyForm(form: string): { kind: string; isSchedule13D: boolean } | null {
  const upper = form.toUpperCase();
  const isAmendment = upper.includes("/A");
  if (upper.includes("13D")) return { kind: isAmendment ? "sc13d-a" : "sc13d", isSchedule13D: true };
  if (upper.includes("13G")) return { kind: isAmendment ? "sc13g-a" : "sc13g", isSchedule13D: false };
  return null;
}

type FilingMeta = {
  form: string;
  kind: string;
  isSchedule13D: boolean;
  filingDate: string;
  accessionNumber: string;
};

async function listFilings(cik: string, fromYear: number): Promise<FilingMeta[]> {
  const data = await fetchJson(`https://data.sec.gov/submissions/CIK${padCik(cik)}.json`);
  const recent = data.filings?.recent;
  if (!recent) return [];

  const out: FilingMeta[] = [];
  for (let i = 0; i < recent.form.length; i++) {
    const classified = classifyForm(recent.form[i]);
    if (!classified) continue;
    const filingDate: string = recent.filingDate[i];
    if (Number(filingDate.slice(0, 4)) < fromYear) continue;
    out.push({ form: recent.form[i], ...classified, filingDate, accessionNumber: recent.accessionNumber[i] });
  }
  return out;
}

type ParsedOwnership = {
  issuerCik: string;
  issuerName: string;
  securitiesClassTitle: string | null;
  eventDate: Date | null;
  sharesOwned: bigint | null;
  percentOfClass: number | null;
  soleVotingPower: bigint | null;
  sharedVotingPower: bigint | null;
  soleDispositivePower: bigint | null;
  sharedDispositivePower: bigint | null;
  isGroupFiling: boolean;
};

function toBigIntFromDecimal(v: unknown): bigint | null {
  if (v == null) return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? BigInt(n) : null;
}

function toFloat(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Both 13D's dateOfEvent and 13G's eventDateRequiresFilingThisStatement use MM/DD/YYYY.
function toDate(v: unknown): Date | null {
  if (!v) return null;
  const s = String(v);
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (m) return new Date(`${m[3]}-${m[1]}-${m[2]}T00:00:00Z`);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

// Filings spell the same filer inconsistently across amendments/co-filers
// (e.g. "Berkshire Hathaway Inc." in the XML vs "Berkshire Hathaway Inc" in
// Filer.name) — compare case-insensitively, ignoring trailing periods.
function normalizeFilerName(name: string): string {
  return name.trim().replace(/\.+$/, "").toLowerCase();
}

type ReportingPersonPowers = {
  soleVotingPower?: string | number;
  sharedVotingPower?: string | number;
  soleDispositivePower?: string | number;
  sharedDispositivePower?: string | number;
};

type ReportingPerson13D = ReportingPersonPowers & {
  reportingPersonCIK?: string | number;
  reportingPersonName?: string;
  memberOfGroup?: string;
  aggregateAmountOwned?: string | number;
  percentOfClass?: string | number;
};

type Edgar13DDoc = {
  edgarSubmission?: {
    formData?: {
      coverPageHeader?: {
        securitiesClassTitle?: string;
        dateOfEvent?: string;
        issuerInfo?: { issuerCIK?: string | number; issuerName?: string };
      };
      reportingPersons?: {
        reportingPersonInfo?: ReportingPerson13D | ReportingPerson13D[];
      };
    };
  };
};

type ReportingPerson13G = {
  reportingPersonName?: string;
  memberGroup?: string;
  reportingPersonBeneficiallyOwnedNumberOfShares?: ReportingPersonPowers;
  reportingPersonBeneficiallyOwnedAggregateNumberOfShares?: string | number;
  classPercent?: string | number;
};

type Edgar13GDoc = {
  edgarSubmission?: {
    formData?: {
      coverPageHeader?: {
        securitiesClassTitle?: string;
        eventDateRequiresFilingThisStatement?: string;
        issuerInfo?: { issuerCik?: string | number; issuerName?: string };
      };
      coverPageHeaderReportingPersonDetails?: ReportingPerson13G | ReportingPerson13G[];
    };
  };
};

// Joint/group filings list multiple reportingPersonInfo blocks (one per
// co-filer, e.g. a fund + its GP + its manager) all sharing the same
// aggregate figures. We only store our tracked filer's own block, matched
// by CIK first (most reliable), falling back to an exact name match for
// blocks filed with reportingPersonNoCIK=Y.
function parse13D(xml: Edgar13DDoc, filerCik: string, filerName: string): ParsedOwnership | null {
  const formData = xml?.edgarSubmission?.formData;
  const issuer = formData?.coverPageHeader?.issuerInfo;
  if (!formData || !issuer) return null;

  const persons = asArray(formData.reportingPersons?.reportingPersonInfo);
  const paddedCik = padCik(filerCik);
  const match =
    persons.find((p) => p.reportingPersonCIK && padCik(String(p.reportingPersonCIK)) === paddedCik) ??
    persons.find((p) => normalizeFilerName(String(p.reportingPersonName ?? "")) === normalizeFilerName(filerName));
  if (!match) return null;

  return {
    issuerCik: normalizeCik(String(issuer.issuerCIK ?? "")),
    issuerName: String(issuer.issuerName ?? ""),
    securitiesClassTitle: formData.coverPageHeader.securitiesClassTitle
      ? String(formData.coverPageHeader.securitiesClassTitle)
      : null,
    eventDate: toDate(formData.coverPageHeader.dateOfEvent),
    sharesOwned: toBigIntFromDecimal(match.aggregateAmountOwned),
    percentOfClass: toFloat(match.percentOfClass),
    soleVotingPower: toBigIntFromDecimal(match.soleVotingPower),
    sharedVotingPower: toBigIntFromDecimal(match.sharedVotingPower),
    soleDispositivePower: toBigIntFromDecimal(match.soleDispositivePower),
    sharedDispositivePower: toBigIntFromDecimal(match.sharedDispositivePower),
    isGroupFiling: Boolean(match.memberOfGroup),
  };
}

function parse13G(xml: Edgar13GDoc, filerName: string): ParsedOwnership | null {
  const formData = xml?.edgarSubmission?.formData;
  const issuer = formData?.coverPageHeader?.issuerInfo;
  if (!formData || !issuer) return null;

  // 13G's reporting-person blocks don't expose a CIK field the way 13D's do — match by name.
  const persons = asArray(formData.coverPageHeaderReportingPersonDetails);
  const match = persons.find((p) => normalizeFilerName(String(p.reportingPersonName ?? "")) === normalizeFilerName(filerName));
  if (!match) return null;

  const powers = match.reportingPersonBeneficiallyOwnedNumberOfShares ?? {};

  return {
    issuerCik: normalizeCik(String(issuer.issuerCik ?? "")),
    issuerName: String(issuer.issuerName ?? ""),
    securitiesClassTitle: formData.coverPageHeader.securitiesClassTitle
      ? String(formData.coverPageHeader.securitiesClassTitle)
      : null,
    eventDate: toDate(formData.coverPageHeader.eventDateRequiresFilingThisStatement),
    sharesOwned: toBigIntFromDecimal(match.reportingPersonBeneficiallyOwnedAggregateNumberOfShares),
    percentOfClass: toFloat(match.classPercent),
    soleVotingPower: toBigIntFromDecimal(powers.soleVotingPower),
    sharedVotingPower: toBigIntFromDecimal(powers.sharedVotingPower),
    soleDispositivePower: toBigIntFromDecimal(powers.soleDispositivePower),
    sharedDispositivePower: toBigIntFromDecimal(powers.sharedDispositivePower),
    isGroupFiling: Boolean(match.memberGroup),
  };
}

async function importFiler(filer: FilerConfig, fromYear: number): Promise<void> {
  console.log(`\n--- ${filer.name} (${filer.tribeId}, CIK ${filer.cik}) ---`);

  const filerRow = await prisma.filer.findUnique({ where: { tribeId: filer.tribeId } });
  if (!filerRow) {
    console.log(`  Skipped: no Filer row for ${filer.tribeId} yet (run 13F import first).`);
    return;
  }

  let filings: FilingMeta[];
  try {
    filings = await listFilings(filer.cik, fromYear);
  } catch (err) {
    console.log(`  Failed to list filings: ${(err as Error).message}`);
    return;
  }
  console.log(`  Found ${filings.length} SC 13D/13G filings since ${fromYear}`);

  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (const f of filings) {
    await sleep(REQUEST_DELAY_MS);

    const cleanAccession = f.accessionNumber.replace(/-/g, "");
    const docUrl = `https://www.sec.gov/Archives/edgar/data/${filer.cik}/${cleanAccession}/primary_doc.xml`;

    try {
      const xmlText = await fetchText(docUrl);
      const xml = new XMLParser().parse(xmlText);
      const parsed = f.isSchedule13D ? parse13D(xml, filer.cik, filer.name) : parse13G(xml, filer.name);

      if (!parsed) {
        console.log(`  ✗ ${f.filingDate} ${f.form} ${f.accessionNumber}: no matching reporting-person block for "${filer.name}"`);
        skipped++;
        continue;
      }

      const issuerEntity = await prisma.entity.findUnique({
        where: { cik: parsed.issuerCik },
        select: { id: true },
      });

      const source = await prisma.extSource.upsert({
        where: {
          ExtSource_filer_accession_unique: {
            filerEntityId: filerRow.filerEntityId,
            accessionNumber: f.accessionNumber,
          },
        },
        create: {
          kind: f.kind,
          filerEntityId: filerRow.filerEntityId,
          accessionNumber: f.accessionNumber,
          filedAt: new Date(f.filingDate),
          url: `https://www.sec.gov/Archives/edgar/data/${filer.cik}/${cleanAccession}/`,
          metadata: { form: f.form },
        },
        update: {
          kind: f.kind,
          filedAt: new Date(f.filingDate),
        },
      });

      await prisma.beneficialOwnership.upsert({
        where: { sourceId: source.id },
        create: {
          sourceId: source.id,
          issuerEntityId: issuerEntity?.id ?? null,
          issuerCik: parsed.issuerCik,
          issuerName: parsed.issuerName,
          securitiesClassTitle: parsed.securitiesClassTitle,
          eventDate: parsed.eventDate,
          sharesOwned: parsed.sharesOwned,
          percentOfClass: parsed.percentOfClass,
          soleVotingPower: parsed.soleVotingPower,
          sharedVotingPower: parsed.sharedVotingPower,
          soleDispositivePower: parsed.soleDispositivePower,
          sharedDispositivePower: parsed.sharedDispositivePower,
          isGroupFiling: parsed.isGroupFiling,
        },
        update: {
          issuerEntityId: issuerEntity?.id ?? null,
          issuerCik: parsed.issuerCik,
          issuerName: parsed.issuerName,
          securitiesClassTitle: parsed.securitiesClassTitle,
          eventDate: parsed.eventDate,
          percentOfClass: parsed.percentOfClass,
          sharesOwned: parsed.sharesOwned,
          soleVotingPower: parsed.soleVotingPower,
          sharedVotingPower: parsed.sharedVotingPower,
          soleDispositivePower: parsed.soleDispositivePower,
          sharedDispositivePower: parsed.sharedDispositivePower,
          isGroupFiling: parsed.isGroupFiling,
        },
      });

      console.log(`  ✓ ${f.filingDate} ${f.form} → ${parsed.issuerName} (${parsed.percentOfClass ?? "?"}%)`);
      imported++;
    } catch (err) {
      console.log(`  ✗ ${f.filingDate} ${f.form} ${f.accessionNumber}: ${(err as Error).message}`);
      failed++;
    }
  }

  console.log(`  Done: ${imported} imported, ${skipped} skipped (no matching block), ${failed} failed`);
}

async function main() {
  const filterTribeId = getArg("--filer");
  const fromArg = getArg("--from");
  const fromYear = fromArg ? Number(fromArg) : new Date().getFullYear() - 5;
  if (!Number.isFinite(fromYear)) throw new Error(`Invalid --from year: ${fromArg}`);

  const allFilers = await getTrackedFilers();
  const targets = filterTribeId ? allFilers.filter((f) => f.tribeId === filterTribeId) : allFilers;
  if (targets.length === 0) {
    throw new Error(`Unknown --filer "${filterTribeId}". Valid: ${allFilers.map((f) => f.tribeId).join(", ")}`);
  }

  for (const filer of targets) {
    await importFiler(filer, fromYear);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
