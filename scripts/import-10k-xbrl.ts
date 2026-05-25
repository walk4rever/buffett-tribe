/**
 * import-10k-xbrl.ts
 *
 * Import annual 10-K financial line items from SEC EDGAR XBRL CompanyFacts.
 *
 * Usage:
 *   npm run import:10k -- --ticker AAPL --from 2021 --to 2024
 *   npm run import:10k -- --ticker MSFT --years 5
 *
 * Defaults:
 *   --years 5 (if --from/--to not provided)
 */
import { PrismaClient } from "@prisma/client";
import { hasChineseText, issuerKey, normalizeEnglishName } from "../src/lib/company-name-map";
import { translateCompanyNameToZh, upsertNameMapEntries } from "./lib/company-name-zh";
import {
  fetchAllAnnualFilings,
  fetchSecSubmissions,
  mapSectorFromSic,
  pickCompanyProfile,
  type SecCompanyProfile,
} from "./lib/sec-company-profile";

const db = new PrismaClient();

const SEC_WWW = "https://www.sec.gov";
const HEADERS = {
  "User-Agent": "buffett-tribe research walkklaw@gmail.com",
  Accept: "application/json, text/xml, */*",
};

type QuarterFact = {
  start?: string;
  end?: string;
  filed?: string;
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

type InlineXbrlDocument = {
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

const LINE_ITEMS: LineItemConfig[] = [
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
];

const TICKER_ALIASES: Record<string, string> = {
  "BRK.B": "BRK-B",
  "BRK.A": "BRK-A",
  LLIVE: "LLYVK",
  YY: "JOYY",
};

const ANNUAL_FORMS = new Set(["10-K", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A"]);
const zhByTickerDb = new Map<string, string>();

function normalizeTicker(ticker: string): string {
  const raw = ticker.trim().toUpperCase();
  return TICKER_ALIASES[raw] ?? raw;
}

function parseArgs(args: string[]) {
  const ticker = normalizeTicker(args.find((_, i) => args[i - 1] === "--ticker") ?? "");
  const fromArg = args.find((_, i) => args[i - 1] === "--from");
  const toArg = args.find((_, i) => args[i - 1] === "--to");
  const yearsArg = args.find((_, i) => args[i - 1] === "--years");
  const years = yearsArg ? parseInt(yearsArg, 10) : 5;

  if (!ticker) {
    throw new Error("Missing --ticker. Example: --ticker AAPL");
  }
  if ((fromArg && !toArg) || (!fromArg && toArg)) {
    throw new Error("--from and --to must be used together.");
  }

  let fromYear: number;
  let toYear: number;
  if (fromArg && toArg) {
    fromYear = parseInt(fromArg, 10);
    toYear = parseInt(toArg, 10);
    if (Number.isNaN(fromYear) || Number.isNaN(toYear)) {
      throw new Error("Invalid --from/--to year.");
    }
    if (fromYear > toYear) {
      throw new Error("--from cannot be greater than --to.");
    }
  } else {
    const now = new Date();
    toYear = now.getUTCFullYear();
    fromYear = toYear - years + 1;
  }

  return { ticker, fromYear, toYear };
}

async function getTickerCikMap() {
  const res = await fetch(`${SEC_WWW}/files/company_tickers.json`, { headers: HEADERS });
  if (!res.ok) {
    throw new Error(`Ticker map fetch failed: ${res.status}`);
  }
  const data = (await res.json()) as Record<string, { cik_str: number; ticker: string; title: string }>;
  const map = new Map<string, { cik: string; title: string }>();
  for (const item of Object.values(data)) {
    map.set(item.ticker.toUpperCase(), { cik: String(item.cik_str), title: item.title });
  }
  return map;
}

async function getCompanyFacts(cik: string) {
  const padded = cik.padStart(10, "0");
  const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${padded}.json`, { headers: HEADERS });
  if (!res.ok) throw new Error(`CompanyFacts fetch failed for CIK ${cik}`);
  return res.json() as Promise<{
    facts?: {
      "us-gaap"?: Record<string, { units?: Record<string, QuarterFact[]> }>;
      "ifrs-full"?: Record<string, { units?: Record<string, QuarterFact[]> }>;
    };
  }>;
}

function findBestFactValue(
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

async function fetchFilingHtml(cik: string, filing: { accession: string; primaryDocument: string }) {
  const accnoPath = filing.accession.replace(/-/g, "");
  const res = await fetch(
    `https://www.sec.gov/Archives/edgar/data/${cik}/${accnoPath}/${filing.primaryDocument}`,
    { headers: HEADERS },
  );
  if (!res.ok) {
    throw new Error(`Filing HTML fetch failed for ${filing.accession}: ${res.status}`);
  }
  return res.text();
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

function parseInlineXbrlDocument(html: string): InlineXbrlDocument {
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

function pickInlineFactWithUnit(
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

function decimalFromNumber(value: number) {
  if (!Number.isFinite(value)) return null;
  return value.toString();
}

async function batchUpsertFinancialFactsFromApi(
  entityId: string,
  sourceId: string,
  facts: Awaited<ReturnType<typeof getCompanyFacts>>,
  filing: { accession: string; filedAt: string; reportDate: string; form: string },
) {
  const allTaxonomies = facts.facts ?? {};
  const records: Array<{
    entityId: string;
    sourceId: string;
    taxonomy: string;
    concept: string;
    value: string | null;
    valueRaw: string;
    unit: string;
    unitRef: string | null;
    periodType: string;
    startDate: Date | null;
    endDate: Date;
    form: string;
    accession: string;
    filedAt: Date;
    rawFactJson: unknown;
    rawContextJson: unknown;
  }> = [];

  for (const [taxonomy, concepts] of Object.entries(allTaxonomies)) {
    for (const [concept, conceptData] of Object.entries(concepts)) {
      const units = (conceptData as Record<string, unknown>)?.units as Record<string, QuarterFact[]> | undefined;
      if (!units) continue;

      for (const [unit, rows] of Object.entries(units)) {
        if (!Array.isArray(rows)) continue;
        for (const row of rows) {
          if (row.val == null || typeof row.val !== "number") continue;
          if (!ANNUAL_FORMS.has(row.form ?? filing.form)) continue;

          const periodType = row.start ? "duration" : "instant";
          const startDate = row.start ? new Date(row.start) : null;
          const endDate = new Date(row.end ?? filing.reportDate);

          records.push({
            entityId,
            sourceId,
            taxonomy,
            concept,
            value: decimalFromNumber(row.val),
            valueRaw: String(row.val),
            unit: unit.toUpperCase(),
            unitRef: null,
            periodType,
            startDate,
            endDate,
            form: row.form ?? filing.form,
            accession: filing.accession,
            filedAt: row.filed ? new Date(row.filed) : new Date(filing.filedAt),
            rawFactJson: row,
            rawContextJson: { start: row.start, end: row.end },
          });
        }
      }
    }
  }

  if (records.length) {
    await db.financialFact.createMany({ data: records, skipDuplicates: true });
  }
  return records.length;
}

async function batchUpsertFinancialFactsFromInline(
  entityId: string,
  sourceId: string,
  doc: InlineXbrlDocument,
  filing: { accession: string; filedAt: string; reportDate: string; form: string },
) {
  const records: Array<{
    entityId: string;
    sourceId: string;
    taxonomy: string;
    concept: string;
    value: string | null;
    valueRaw: string;
    unit: string;
    unitRef: string | null;
    periodType: string;
    startDate: Date | null;
    endDate: Date;
    form: string;
    accession: string;
    filedAt: Date;
    rawFactJson: unknown;
    rawContextJson: unknown;
  }> = [];

  const targetFy = new Date(filing.reportDate).getUTCFullYear();

  for (const fact of doc.facts) {
    if (fact.value == null) continue;

    const context = doc.contexts.get(fact.contextRef);
    if (!context) continue;

    const tag = fact.name.includes(":") ? fact.name.split(":").at(-1) ?? fact.name : fact.name;
    const taxonomy = fact.name.includes(":") ? fact.name.split(":")[0] ?? "us-gaap" : "us-gaap";
    const unit = normalizeInlineUnitRef(fact.unitRef) ?? "pure";
    const endDate = context.endDate
      ? new Date(context.endDate)
      : context.instant
        ? new Date(context.instant)
        : new Date(filing.reportDate);
    const startDate = context.startDate ? new Date(context.startDate) : null;

    // 只存目标 FY 的数据（避免把 Q1-Q3 的也混进来）
    if (endDate.getUTCFullYear() !== targetFy) continue;

    records.push({
      entityId,
      sourceId,
      taxonomy,
      concept: tag,
      value: decimalFromNumber(fact.value),
      valueRaw: String(fact.value),
      unit: unit.toUpperCase(),
      unitRef: fact.unitRef,
      periodType: context.periodType,
      startDate,
      endDate,
      form: filing.form,
      accession: filing.accession,
      filedAt: new Date(filing.filedAt),
      rawFactJson: { name: fact.name, contextRef: fact.contextRef, unitRef: fact.unitRef, value: fact.value },
      rawContextJson: { id: context.id, periodType: context.periodType, startDate: context.startDate, instant: context.instant, endDate: context.endDate },
    });
  }

  if (records.length) {
    await db.financialFact.createMany({ data: records, skipDuplicates: true });
  }
  return records.length;
}

async function upsertCompanyEntity(cik: string, ticker: string, title: string, profile: SecCompanyProfile) {
  const byCik = await db.entity.findFirst({
    where: { cik },
    select: { id: true, metadata: true, type: true, cik: true, sector: true },
  });
  const cikOwnedByCompany = byCik?.type === "company";
  const byTicker = byCik
    ? byCik.type === "company"
      ? null
      : await db.entity.findFirst({
        where: {
          type: "company",
          ticker: { equals: ticker, mode: "insensitive" },
        },
        select: { id: true, metadata: true, cik: true, sector: true },
      })
    : await db.entity.findFirst({
      where: {
        type: "company",
        ticker: { equals: ticker, mode: "insensitive" },
      },
      select: { id: true, metadata: true, cik: true, sector: true },
    });

  const target = cikOwnedByCompany ? byCik : byTicker;
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
    importedBy: "import-10k-xbrl",
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

  if (target) {
    const canSetCik = byCik == null || (byCik.type === "company" && byCik.id === target.id);
    return db.entity.update({
      where: { id: target.id },
      data: {
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
  }

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
}

async function upsertExtSource(
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

  const existing = await db.extSource.findFirst({
    where: {
      kind: filing.form.startsWith("20-F") ? "20f" : filing.form.startsWith("40-F") ? "40f" : "10k",
      filerEntityId: entityId,
      periodYear: year,
      periodQuarter: quarter,
      filedAt: new Date(filing.filedAt),
    },
  });
  if (existing) return existing;

  return db.extSource.create({
    data: {
      kind: filing.form.startsWith("20-F") ? "20f" : filing.form.startsWith("40-F") ? "40f" : "10k",
      filerEntityId: entityId,
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

async function import10kForTicker(ticker: string, fromYear: number, toYear: number) {
  if (!zhByTickerDb.size) {
    const maps = await db.companyNameMap.findMany({
      where: { keyType: "ticker" },
      select: { key: true, nameZh: true },
    });
    for (const row of maps) {
      if (hasChineseText(row.nameZh)) zhByTickerDb.set(row.key.toUpperCase(), row.nameZh);
    }
  }

  const tickerMap = await getTickerCikMap();
  const resolved = tickerMap.get(ticker);
  if (!resolved) throw new Error(`Ticker not found in SEC ticker map: ${ticker}`);

  const { cik, title } = resolved;
  console.log(`Ticker ${ticker} -> CIK ${cik} (${title})`);

  const submissions = await fetchSecSubmissions(cik);
  const profile = pickCompanyProfile(submissions);
  const companyEntity = await upsertCompanyEntity(cik, ticker, title, profile);
  const [facts, filings] = await Promise.all([
    getCompanyFacts(cik),
    fetchAllAnnualFilings(cik),
  ]);

  const targetFilings = filings
    .filter((f) => {
      const y = new Date(f.reportDate).getUTCFullYear();
      return y >= fromYear && y <= toYear;
    })
    .sort((a, b) => (a.reportDate < b.reportDate ? 1 : -1));

  console.log(`Found ${targetFilings.length} annual filings (10-K/20-F/40-F) in ${fromYear}-${toYear}`);
  if (!targetFilings.length) return;

  for (const filing of targetFilings) {
    const extSource = await upsertExtSource(companyEntity.id, cik, filing);

    // 1. Write all XBRL facts from CompanyFacts API
    const apiFactCount = await batchUpsertFinancialFactsFromApi(
      companyEntity.id,
      extSource.id,
      facts,
      filing,
    );

    // 2. Download HTML and write all Inline XBRL facts
    const html = await fetchFilingHtml(cik, filing);
    const inlineDoc = parseInlineXbrlDocument(html);
    const inlineFactCount = await batchUpsertFinancialFactsFromInline(
      companyEntity.id,
      extSource.id,
      inlineDoc,
      filing,
    );

    // 3. Continue existing LINE_ITEMS logic (derived layer)
    let upserted = 0;
    let missing = 0;
    let fallbackUsed = 0;

    for (const item of LINE_ITEMS) {
      const companyFactsValue = findBestFactValue(
        facts,
        item.tagsUsGaap,
        item.tagsIfrs,
        item.unitCandidates,
        filing.reportDate,
      );

      let value = companyFactsValue;
      let unit = item.unitCandidates[0];

      if (value == null) {
        const inlineFact = pickInlineFactWithUnit(
          inlineDoc,
          item.tagsUsGaap,
          item.tagsIfrs,
          filing.reportDate,
          item.periodType,
          item.unitCandidates,
        );
        if (inlineFact) {
          value = inlineFact.value;
          unit = inlineFact.unit ? normalizeInlineUnitRef(inlineFact.unit) ?? unit : unit;
          fallbackUsed++;
        }
      }

      if (value == null) {
        missing++;
        continue;
      }

      await db.financial.upsert({
        where: {
          entityId_periodEnd_periodType_lineItem: {
            entityId: companyEntity.id,
            periodEnd: new Date(filing.reportDate),
            periodType: "FY",
            lineItem: item.key,
          },
        },
        create: {
          entityId: companyEntity.id,
          sourceId: extSource.id,
          periodEnd: new Date(filing.reportDate),
          periodType: "FY",
          lineItem: item.key,
          value: decimalFromNumber(value),
          unit,
        },
        update: {
          sourceId: extSource.id,
          value: decimalFromNumber(value),
          unit,
        },
      });
      upserted++;
    }

    console.log(
      `  ${filing.reportDate} (${filing.accession}) -> facts(API ${apiFactCount}, Inline ${inlineFactCount}), derived ${upserted}, missing ${missing}, fallback ${fallbackUsed}`,
    );
  }
}

async function main() {
  const { ticker, fromYear, toYear } = parseArgs(process.argv.slice(2));
  await import10kForTicker(ticker, fromYear, toYear);
  console.log("Done.");
}

main()
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
