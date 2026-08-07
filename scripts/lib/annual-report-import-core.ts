/**
 * annual-report-import-core.ts
 *
 * Shared annual-report storage and parsing primitives.
 */
import { PrismaClient } from "@prisma/client";
import * as cheerio from "cheerio";
import { hasChineseText, issuerKey, normalizeEnglishName } from "../../src/lib/company-name-map";
import { translateCompanyNameToZh, upsertNameMapEntries } from "./company-name-zh";
import {
  mapSectorFromSic,
  type SecCompanyProfile,
} from "./sec-company-profile";
import { extractTargetSections, normalizeHtmlToText } from "./extract-10k-sections";
import {
  archiveFilingArtifact,
  fetchFilingIndexFiles,
  fetchSecText,
  SEC_HEADERS,
} from "./filing-archive";
import { rewriteSecHtmlUrls } from "./sec-html-rewriter";
import {
  buildStoredFilingSectionData,
  buildStoredTextOnlyFilingSectionData,
} from "./filing-section-storage";
import { ImportTimer } from "./import-timer";

export const db = new PrismaClient();

type QuarterFact = {
  start?: string;
  end?: string;
  filed?: string;
  accn?: string;
  val?: number;
  form?: string;
  fy?: number;
  fp?: string;
};

type InlineXbrlContext = {
  id: string;
  periodType: "instant" | "duration";
  instant?: string;
  startDate?: string;
  endDate?: string;
};

type InlineXbrlFact = {
  name: string;
  contextRef: string;
  unitRef: string | null;
  value: number | null;
};

export type InlineXbrlDocument = {
  contexts: Map<string, InlineXbrlContext>;
  facts: InlineXbrlFact[];
};

type LineItemConfig = {
  key: string;
  tagsUsGaap: string[];
  tagsIfrs: string[];
  unitCandidates: string[];
  periodType: "instant" | "duration";
};

export const LINE_ITEMS: LineItemConfig[] = [
  {
    key: "Revenue",
    tagsUsGaap: ["RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet", "Revenues"],
    tagsIfrs: ["Revenue"],
    unitCandidates: ["USD"],
    periodType: "duration",
  },
  {
    key: "GrossProfit",
    tagsUsGaap: ["GrossProfit"],
    tagsIfrs: ["GrossProfit"],
    unitCandidates: ["USD"],
    periodType: "duration",
  },
  {
    key: "OperatingIncome",
    tagsUsGaap: ["OperatingIncomeLoss"],
    tagsIfrs: ["ProfitLossFromOperatingActivities"],
    unitCandidates: ["USD"],
    periodType: "duration",
  },
  {
    key: "NetIncome",
    tagsUsGaap: ["NetIncomeLoss"],
    tagsIfrs: ["ProfitLoss"],
    unitCandidates: ["USD"],
    periodType: "duration",
  },
  {
    key: "OperatingCashFlow",
    tagsUsGaap: ["NetCashProvidedByUsedInOperatingActivities"],
    tagsIfrs: ["CashFlowsFromUsedInOperatingActivities"],
    unitCandidates: ["USD"],
    periodType: "duration",
  },
  {
    key: "CapEx",
    tagsUsGaap: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"],
    tagsIfrs: ["PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities"],
    unitCandidates: ["USD"],
    periodType: "duration",
  },
  {
    key: "TotalAssets",
    tagsUsGaap: ["Assets"],
    tagsIfrs: ["Assets"],
    unitCandidates: ["USD"],
    periodType: "instant",
  },
  {
    key: "TotalLiabilities",
    tagsUsGaap: ["Liabilities"],
    tagsIfrs: ["Liabilities"],
    unitCandidates: ["USD"],
    periodType: "instant",
  },
  {
    key: "ShareholdersEquity",
    tagsUsGaap: ["StockholdersEquity"],
    tagsIfrs: ["EquityAttributableToOwnersOfParent", "Equity"],
    unitCandidates: ["USD"],
    periodType: "instant",
  },
  {
    key: "EPSBasic",
    tagsUsGaap: ["EarningsPerShareBasic"],
    tagsIfrs: ["BasicEarningsLossPerShare"],
    unitCandidates: ["USD/shares", "USD-per-shares", "pure"],
    periodType: "duration",
  },
  {
    key: "EPSDiluted",
    tagsUsGaap: ["EarningsPerShareDiluted"],
    tagsIfrs: ["DilutedEarningsLossPerShare"],
    unitCandidates: ["USD/shares", "USD-per-shares", "pure"],
    periodType: "duration",
  },
  {
    key: "ShareRepurchaseAmt",
    tagsUsGaap: [
      "PaymentsForRepurchaseOfCommonStock",
      "PaymentsForRepurchaseOfEquity",
      "TreasuryStockValueAcquiredCostMethod",
      "StockRepurchasedDuringPeriodValue",
    ],
    tagsIfrs: [],
    unitCandidates: ["USD"],
    periodType: "duration",
  },
];

const TICKER_ALIASES: Record<string, string> = {
  "BRK.B": "BRK-B",
  "BRK.A": "BRK-A",
  LLIVE: "LLYVK",
  YY: "JOYY",
};

export const ANNUAL_FORMS = new Set(["10-K", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A"]);
const zhByTickerDb = new Map<string, string>();

export function mapLimit<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });
  return Promise.all(workers).then(() => results);
}

export function normalizeTicker(ticker: string): string {
  const raw = ticker.trim().toUpperCase();
  return TICKER_ALIASES[raw] ?? raw;
}

export async function getCompanyFacts(cik: string) {
  const padded = cik.padStart(10, "0");
  const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${padded}.json`, { headers: SEC_HEADERS });
  if (!res.ok) throw new Error(`CompanyFacts fetch failed for CIK ${cik}`);
  return res.json() as Promise<{
    facts?: {
      "us-gaap"?: Record<string, { units?: Record<string, QuarterFact[]> }>;
      "ifrs-full"?: Record<string, { units?: Record<string, QuarterFact[]> }>;
    };
  }>;
}

export function findBestFactValue(
  facts: Awaited<ReturnType<typeof getCompanyFacts>>,
  tagsUsGaap: string[],
  tagsIfrs: string[],
  unitCandidates: string[],
  reportDate: string,
) {
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

      const preferredUnitRows = unitCandidates.flatMap((unit) => {
        const rows = concept.units?.[unit];
        return rows ?? [];
      });
      const rowsToCheck =
        preferredUnitRows.length > 0
          ? preferredUnitRows
          : Object.values(concept.units).flat();

      for (const row of rowsToCheck) {
        if (!row || row.end !== reportDate || typeof row.val !== "number") continue;
        if (!ANNUAL_FORMS.has(row.form ?? "")) continue;
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

export async function upsertFilingSectionsFromHtml(
  entityId: string,
  sourceId: string,
  cik: string,
  accession: string,
  html: string,
  filingKind: "10k" | "20f" | "40f",
  sourceUrl?: string,
  timer?: ImportTimer,
  sectionConcurrency = 1,
) {
  const sections = timer
    ? timer.timeSync("section extract target sections", () => extractTargetSections(html, sourceUrl, filingKind), (result) => `sections=${Object.keys(result).length}`)
    : extractTargetSections(html, sourceUrl, filingKind);
  const keys = Object.keys(sections);
  if (!keys.length) return 0;

  if (timer) {
    await timer.time("section delete stale", () => db.filingSection.deleteMany({
      where: {
        sourceId,
        section: { notIn: keys },
      },
    }), (result) => `deleted=${result.count}`);
  } else {
    await db.filingSection.deleteMany({
      where: {
        sourceId,
        section: { notIn: keys },
      },
    });
  }

  const sectionEntries = Object.entries(sections);
  await mapLimit(sectionEntries, sectionConcurrency, async ([section, extracted]) => {
    const sectionTimer = timer ? new ImportTimer(`[section ${section}]`, "      ") : null;
    const data = sectionTimer
      ? await sectionTimer.time("build artifacts", () => buildStoredFilingSectionData(db, {
          entityId,
          sourceId,
          cik,
          accession,
          sourceUrl,
        }, section, extracted), (result) => `text=${result.contentTextLength}, blocks=${result.blockCount}`)
      : await buildStoredFilingSectionData(db, {
          entityId,
          sourceId,
          cik,
          accession,
          sourceUrl,
        }, section, extracted);

    if (sectionTimer) {
      await sectionTimer.time("upsert row", () => db.filingSection.upsert({
        where: { sourceId_section: { sourceId, section } },
        update: data,
        create: data,
      }));
    } else {
      await db.filingSection.upsert({
        where: { sourceId_section: { sourceId, section } },
        update: data,
        create: data,
      });
    }
  });
  return keys.length;
}

function resolveRelativeUrls(html: string, sourceUrl: string): string {
  try {
    const base = new URL(sourceUrl);
    return html.replace(/(src|href)=['"]([^'"]+)['"]/g, (match, attr, url) => {
      if (/^(https?:|data:|#|mailto:|javascript:)/i.test(url)) return match;
      return `${attr}="${new URL(url, base).href}"`;
    });
  } catch {
    return html;
  }
}

function extractBodyHtml(html: string, sourceUrl: string) {
  const $ = cheerio.load(html);
  $("script,style,head,noscript,ix\\:hidden,ix\\:header").remove();
  const bodyHtml = $("body").html() ?? $.root().html() ?? html;
  return resolveRelativeUrls(bodyHtml, sourceUrl);
}

function normalizeComparableText(text: string) {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/[’‘]/g, "'")
    .replace(/&rsquo;|&#8217;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const ATTACHMENT_DERIVED_40F_SECTIONS = [
  "annual_information_form",
  "audited_annual_financial_statements",
  "management_discussion_and_analysis",
  "disclosure_controls_procedures",
  "management_internal_control_report",
  "auditor_attestation_internal_control",
  "changes_internal_control",
  "audit_committee_financial_expert",
  "code_of_ethics",
  "principal_accountant_fees_services",
  "certifications",
  "exhibits",
];

function startsWithAny(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}

function classify40FAttachment(text: string, file: Awaited<ReturnType<typeof fetchFilingIndexFiles>>["files"][number]) {
  const fileLabel = normalizeComparableText(`${file.documentName} ${file.description} ${file.documentType}`);
  const lead = normalizeComparableText(text.slice(0, 4000));
  const haystack = `${fileLabel} ${lead}`;
  const sections = new Set<string>();

  if (/\baif\b/i.test(file.documentName) || startsWithAny(lead, [/^(ex-\d+\.\d+\s+)?\d*\s*.*annual information form\b/])) {
    sections.add("annual_information_form");
  }

  if (
    /\bmd&a\b/i.test(file.documentName) ||
    /\bmd&a\b/i.test(file.description) ||
    startsWithAny(lead, [/^(ex-\d+\.\d+\s+)?\d*\s*.*management'?s discussion and analysis\b/])
  ) {
    sections.add("management_discussion_and_analysis");
  }

  if (
    !haystack.includes("consent of independent registered public accounting firm") &&
    startsWithAny(lead, [
      /^(ex-\d+\.\d+\s+)?\d*\s*.*management'?s statement of responsibility for financial reporting\b/,
      /^(ex-\d+\.\d+\s+)?\d*\s*.*audited annual financial statements\b/,
      /^(ex-\d+\.\d+\s+)?\d*\s*.*consolidated financial statements\b/,
      /^(ex-\d+\.\d+\s+)?\d*\s*.*report of independent registered public accounting firm\b/,
    ])
  ) {
    sections.add("audited_annual_financial_statements");
  }

  if (/^EX-99/i.test(file.documentType) && startsWithAny(lead, [/^(ex-\d+\.\d+\s+)?\d*\s*.*certification\b/])) {
    sections.add("certifications");
  }

  return [...sections];
}

export async function upsert40FAttachmentSections(
  entityId: string,
  sourceId: string,
  cik: string,
  accession: string,
  files: Awaited<ReturnType<typeof fetchFilingIndexFiles>>["files"],
) {
  const htmlAttachments = files.filter((file) => {
    if (file.category !== "attachment") return false;
    if (!/^EX-99/i.test(file.documentType)) return false;
    return /\.(html?|xhtml)$/i.test(file.documentName);
  });

  let upserted = 0;
  const seenSections = new Set<string>();

  for (const file of htmlAttachments) {
    const html = await fetchSecText(file.url);
    const text = normalizeHtmlToText(html);
    const sections = classify40FAttachment(text, file).filter((section) => !seenSections.has(section));
    if (!sections.length) continue;

    const rawHtml = extractBodyHtml(html, file.url);
    const content = text.trim();
    if (!content) continue;

    for (const section of sections) {
      const data = await buildStoredTextOnlyFilingSectionData(db, {
        entityId,
        sourceId,
        cik,
        accession,
        sourceUrl: file.url,
      }, section, content, rawHtml);

      await db.filingSection.upsert({
        where: { sourceId_section: { sourceId, section } },
        update: data,
        create: data,
      });
      seenSections.add(section);
      upserted++;
    }
  }

  await db.filingSection.deleteMany({
    where: {
      sourceId,
      section: {
        in: ATTACHMENT_DERIVED_40F_SECTIONS.filter((section) => !seenSections.has(section)),
      },
    },
  });

  return upserted;
}

export async function upsertFilingAttachments(
  entityId: string,
  sourceId: string,
  files: Awaited<ReturnType<typeof fetchFilingIndexFiles>>["files"],
) {
  if (!files.length) return 0;

  // Wipe + re-insert per (sourceId) to keep the set canonical and ordered by sequence.
  // FilingAttachment has no natural unique key beyond `id`, so naive createMany would
  // produce duplicates on re-runs.
  await db.filingAttachment.deleteMany({ where: { sourceId } });
  await db.filingAttachment.createMany({
    data: files.map((f) => ({
      entityId,
      sourceId,
      sequence: f.sequence,
      description: f.description,
      documentType: f.documentType,
      documentName: f.documentName,
      url: f.url,
    })),
  });
  return files.length;
}

export async function archiveFilingArtifacts(params: {
  entityId: string;
  sourceId: string;
  cik: string;
  accession: string;
  primaryDocument: string;
  filingUrlBase: string;
  primaryHtml: string;
  indexHtml: string;
  indexFiles: Awaited<ReturnType<typeof fetchFilingIndexFiles>>["files"];
}) {
  const {
    entityId,
    sourceId,
    cik,
    accession,
    primaryDocument,
    filingUrlBase,
    primaryHtml,
    indexHtml,
    indexFiles,
  } = params;
  const primaryUrl = `${filingUrlBase}/${primaryDocument}`;
  const indexUrl = `${filingUrlBase}/${accession}-index.htm`;
  const artifacts = [];

  artifacts.push(
    archiveFilingArtifact(db, {
      sourceId,
      kind: "primary_html",
      cik,
      accession,
      originalName: primaryDocument,
      contentType: "text/html; charset=utf-8",
      body: Buffer.from(rewriteSecHtmlUrls(primaryHtml, primaryUrl), "utf8"),
      sourceUrl: primaryUrl,
      metadata: {
        entityId,
        documentType: "primary",
        accession,
      },
    }),
  );

  artifacts.push(
    archiveFilingArtifact(db, {
      sourceId,
      kind: "index_html",
      cik,
      accession,
      originalName: `${accession}-index.htm`,
      contentType: "text/html; charset=utf-8",
      body: Buffer.from(indexHtml, "utf8"),
      sourceUrl: indexUrl,
      metadata: {
        entityId,
        documentType: "index",
        accession,
      },
    }),
  );

  const attachmentTargets = indexFiles.filter((file) => file.category === "attachment" || file.category === "data_file");
  console.log(
    `  Archive standard: primary/index saved; attachments/data metadata only (${attachmentTargets.length} files)`,
  );

  return Promise.all(artifacts);
}

function parseAttrMap(source: string) {
  const attrs = new Map<string, string>();
  const attrRe = /([A-Za-z_:][\w:.-]*)="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = attrRe.exec(source))) {
    attrs.set(match[1], match[2]);
  }
  return attrs;
}

function normalizeInlineUnitRef(unitRef: string | null) {
  if (!unitRef) return null;
  const trimmed = unitRef.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === "pure") return "pure";
  const perShare = trimmed.match(/^([A-Za-z]{3})perShare$/i);
  if (perShare) return `${perShare[1].toUpperCase()}/shares`;
  const slashShare = trimmed.match(/^([A-Za-z]{3})\/shares$/i);
  if (slashShare) return `${slashShare[1].toUpperCase()}/shares`;
  return trimmed.toUpperCase();
}

export function parseInlineXbrlDocument(html: string): InlineXbrlDocument {
  const contexts = new Map<string, InlineXbrlContext>();
  const contextRe = /<xbrli:context\b([^>]*)>([\s\S]*?)<\/xbrli:context>/gi;
  let contextMatch: RegExpExecArray | null;

  while ((contextMatch = contextRe.exec(html))) {
    const attrs = parseAttrMap(contextMatch[1]);
    const id = attrs.get("id");
    if (!id) continue;

    const body = contextMatch[2];
    const instantMatch = body.match(/<xbrli:instant>\s*([^<]+?)\s*<\/xbrli:instant>/i);
    const startMatch = body.match(/<xbrli:startDate>\s*([^<]+?)\s*<\/xbrli:startDate>/i);
    const endMatch = body.match(/<xbrli:endDate>\s*([^<]+?)\s*<\/xbrli:endDate>/i);

    if (instantMatch?.[1]) {
      contexts.set(id, {
        id,
        periodType: "instant",
        instant: instantMatch[1].trim(),
      });
    } else if (startMatch?.[1] && endMatch?.[1]) {
      contexts.set(id, {
        id,
        periodType: "duration",
        startDate: startMatch[1].trim(),
        endDate: endMatch[1].trim(),
      });
    }
  }

  const facts: InlineXbrlFact[] = [];
  const factRe = /<ix:nonFraction\b([^>]*)>([\s\S]*?)<\/ix:nonFraction>/gi;
  let factMatch: RegExpExecArray | null;

  while ((factMatch = factRe.exec(html))) {
    const attrs = parseAttrMap(factMatch[1]);
    const name = attrs.get("name");
    const contextRef = attrs.get("contextRef");
    if (!name || !contextRef) continue;

    const text = factMatch[2].replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").trim();
    const normalized = text.replace(/,/g, "").replace(/\s+/g, "");
    const raw = normalized.replace(/[()]/g, "");
    const unitRef = normalizeInlineUnitRef(attrs.get("unitRef") ?? null);
    if (!raw || raw === "-" || raw === "—") {
      facts.push({ name, contextRef, unitRef, value: null });
      continue;
    }

    const scaleRaw = attrs.get("scale");
    const scale = scaleRaw ? Number.parseInt(scaleRaw, 10) : 0;
    const sign = attrs.get("sign");
    const negative = sign === "-" || normalized.startsWith("(") && normalized.endsWith(")");
    const numeric = Number.parseFloat(raw.replace(/^[+-]/, ""));
    if (!Number.isFinite(numeric)) {
      facts.push({ name, contextRef, unitRef, value: null });
      continue;
    }

    const value = numeric * Math.pow(10, Number.isFinite(scale) ? scale : 0);
    facts.push({ name, contextRef, unitRef, value: negative ? -value : value });
  }

  return { contexts, facts };
}

export function pickInlineFactWithUnit(
  doc: InlineXbrlDocument,
  tagsUsGaap: string[],
  tagsIfrs: string[],
  reportDate: string,
  periodType: "instant" | "duration",
  unitCandidates: string[],
) {
  const wantedUnits = new Set(unitCandidates.map((unit) => unit.trim().toUpperCase()));
  const candidates: Array<{ unitRank: number; value: number; unit: string | null }> = [];

  for (const fact of doc.facts) {
    const tag = fact.name.includes(":") ? fact.name.split(":").at(-1) ?? fact.name : fact.name;
    if (!tagsUsGaap.includes(tag) && !tagsIfrs.includes(tag)) continue;
    if (fact.value == null) continue;

    const context = doc.contexts.get(fact.contextRef);
    if (!context || context.periodType !== periodType) continue;
    if (periodType === "instant" && context.instant !== reportDate) continue;
    if (periodType === "duration" && context.endDate !== reportDate) continue;

    const unit = fact.unitRef?.toUpperCase() ?? null;
    const unitRank = unit && wantedUnits.size && wantedUnits.has(unit) ? 0 : 1;
    candidates.push({ unitRank, value: fact.value, unit: fact.unitRef });
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => a.unitRank - b.unitRank);
  return candidates[0];
}

export function decimalFromNumber(value: number) {
  if (!Number.isFinite(value)) return null;
  return value.toString();
}

export async function upsertCompanyEntity(cik: string, ticker: string, title: string, profile: SecCompanyProfile) {
  // 1. Find by CIK (any type)
  const byCik = await db.entity.findFirst({
    where: { cik },
    select: { id: true, metadata: true, type: true, cik: true, sector: true },
  });

  let target = byCik;

  // 2. If no CIK match, find by ticker
  if (!target) {
    // Prefer type=company
    target = await db.entity.findFirst({
      where: {
        type: "company",
        ticker: { equals: ticker, mode: "insensitive" },
      },
      select: { id: true, metadata: true, type: true, cik: true, sector: true },
    });
    // Fallback to any type (handles legacy type=security entities)
    if (!target) {
      target = await db.entity.findFirst({
        where: {
          ticker: { equals: ticker, mode: "insensitive" },
        },
        select: { id: true, metadata: true, type: true, cik: true, sector: true },
      });
    }
  }

  // Never retype/mutate a filer's Entity(type="master") row into a company —
  // that's the exact collision that produced the Berkshire duplicate-entity
  // bug (see TODO.md「Filer / Company 拆分」). If resolution landed on a
  // master row, treat it as "not found" and fall through to creating a
  // proper company row; the Filer.companyEntityId link is written below.
  if (target?.type === "master") {
    target = null;
  }

  const existingMeta = (target?.metadata as Record<string, unknown> | null) ?? {};
  const dbNameMap = await db.companyNameMap.findUnique({
    where: { keyType_key: { keyType: "ticker", key: ticker.toUpperCase() } },
    select: { nameZh: true },
  });
  const existingZh =
    (hasChineseText(dbNameMap?.nameZh) ? dbNameMap.nameZh : null) ??
    (hasChineseText(typeof existingMeta.nameZh === "string" ? existingMeta.nameZh : null) ? existingMeta.nameZh as string : null);
  const nameEnShort = normalizeEnglishName(title);
  let nameZh = zhByTickerDb.get(ticker.toUpperCase()) ?? existingZh;
  if (!nameZh) {
    nameZh = await translateCompanyNameToZh({
      englishName: title,
      ticker,
    });
    const mapIssuerKey = issuerKey(title);
    await upsertNameMapEntries({
      db,
      issuerKey: mapIssuerKey,
      ticker,
      nameZh,
      nameEnShort,
      source: "import-translation",
    });
    zhByTickerDb.set(ticker.toUpperCase(), nameZh);
  }

  const nextMeta = {
    ...existingMeta,
    source: "sec-edgar",
    importedBy: "import-10k-edgartools",
    nameZh,
    nameEnShort,
    industry: profile.sicDescription,
    exchange: profile.exchanges[0] ?? null,
    exchanges: profile.exchanges,
    sic: profile.sic,
    secCategory: profile.category,
    fiscalYearEnd: profile.fiscalYearEnd,
    stateOfIncorporation: profile.stateOfIncorporation,
    stateOfIncorporationDescription: profile.stateOfIncorporationDescription,
  };
  const sector = mapSectorFromSic(profile.sic, profile.sicDescription) ?? target?.sector ?? null;

  const resolved = target
    ? await (async () => {
        const canSetCik = byCik == null || byCik.id === target.id;
        const needsTypeUpgrade = target.type !== "company";
        return db.entity.update({
          where: { id: target.id },
          data: {
            type: needsTypeUpgrade ? "company" : target.type,
            canonicalName: title,
            cik: canSetCik ? cik : target.cik,
            ticker,
            sector,
            metadata: {
              ...nextMeta,
              ...(canSetCik ? {} : { secCik: cik }),
            },
          },
        });
      })()
    : await (async () => {
        // CIK may already be occupied by a non-company entity (e.g. master/filer).
        // Keep SEC CIK in metadata to avoid unique-key collision on Entity.cik.
        const createCik = byCik == null ? cik : null;
        return db.entity.create({
          data: {
            type: "company",
            canonicalName: title,
            cik: createCik,
            ticker,
            sector,
            metadata: {
              ...nextMeta,
              ...(createCik ? {} : { secCik: cik }),
            },
          },
        });
      })();

  // If this company's CIK belongs to one of our tracked filers (currently:
  // Berkshire/buffett), link it back so future runs never have to guess via
  // scoring again — see TODO.md「Filer / Company 拆分」.
  await db.filer.updateMany({
    where: { filerCik: cik, companyEntityId: null },
    data: { companyEntityId: resolved.id },
  });

  return resolved;
}

export async function upsertExtSource(
  entityId: string,
  cik: string,
  filing: {
    accession: string;
    filedAt: string;
    reportDate: string;
    primaryDocument: string;
    form: string;
  },
) {
  const year = new Date(filing.reportDate).getUTCFullYear();
  const quarter = Math.ceil((new Date(filing.reportDate).getUTCMonth() + 1) / 3);
  const accnoPath = filing.accession.replace(/-/g, "");
  const kind = filing.form.startsWith("20-F") ? "20f" : filing.form.startsWith("40-F") ? "40f" : "10k";

  // Dedupe key is (filerEntityId, accessionNumber). The DB also enforces this
  // via a unique index, so even concurrent runs can't double-insert.
  const existing = await db.extSource.findFirst({
    where: { filerEntityId: entityId, accessionNumber: filing.accession },
  });
  if (existing) return existing;

  return db.extSource.create({
    data: {
      kind,
      filerEntityId: entityId,
      accessionNumber: filing.accession,
      periodYear: year,
      periodQuarter: quarter,
      ts: new Date(filing.reportDate),
      filedAt: new Date(filing.filedAt),
      url: `https://www.sec.gov/Archives/edgar/data/${cik}/${accnoPath}/${filing.primaryDocument}`,
      metadata: {
        accession: filing.accession,
        primaryDocument: filing.primaryDocument,
        form: filing.form,
      },
    },
  });
}
