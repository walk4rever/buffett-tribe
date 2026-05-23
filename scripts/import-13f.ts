/**
 * import-13f.ts
 *
 * Fetches SEC EDGAR 13F-HR filings for the three tribe filers and upserts
 * Entity / ExtSource / Holding rows into the database.
 */
import { PrismaClient } from "@prisma/client";
import { XMLParser } from "fast-xml-parser";
import { hasChineseText, issuerKey, resolveCompanyNamesFromMaps } from "../src/lib/company-name-map";
import { normalizeTicker } from "../src/lib/ticker";
import { translateCompanyNameToZh, upsertNameMapEntries } from "./lib/company-name-zh";

const db = new PrismaClient();

const zhByTickerDb = new Map<string, string>();
const zhByIssuerDb = new Map<string, string>();
const tickerByIssuerDb = new Map<string, string>();
const tickerByCusipDb = new Map<string, string>();

const entityByCusip = new Map<string, { id: string; backfilled: boolean }>();
const companyByTickerCache = new Map<string, string>();
const securityIdByEntityId = new Map<string, string>();
const CUSIP_TICKER_OVERRIDES: Record<string, string> = {
  // Alphabet Class C should map to GOOG (Class A is GOOGL).
  "02079K107": "GOOG",
  // Liberty Latin America: Class A = LILA, Class C = LILAK.
  "G9001E102": "LILA",
  "G9001E128": "LILAK",
  // Liberty Live: Series A / Series C
  "530909100": "LLYVA",
  "530909308": "LLYVK",
};

type SecuritySnapshot = {
  entityId: string;
  ticker: string | null;
  cusip: string;
  titleOfClass: string;
  companyEntityId: string | null;
  metadata: Record<string, unknown>;
};

function resolveNamesDbFirst(canonicalName: string, existingNameZh?: string | null) {
  const resolved = resolveCompanyNamesFromMaps({
    canonicalName,
    existingNameZh,
    maps: {
      zhByTicker: zhByTickerDb,
      zhByIssuer: zhByIssuerDb,
      tickerByIssuer: tickerByIssuerDb,
    },
  });

  return {
    ticker: resolved.ticker,
    nameZh: resolved.nameZh,
    nameEnShort: resolved.nameEnShort,
    issuerKey: issuerKey(canonicalName),
  };
}

function resolveTickerWithCusipOverride(cusip: string, ticker: string | null) {
  const mapped = tickerByCusipDb.get(cusip);
  if (mapped) return mapped;
  const override = CUSIP_TICKER_OVERRIDES[cusip];
  if (override) return override;
  return ticker;
}

async function mapLimit<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>) {
  let index = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      const i = index++;
      if (i >= items.length) return;
      await fn(items[i]);
    }
  });
  await Promise.all(workers);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function translateMissingNames(entries: InfoTableEntry[], concurrency = 4) {
  const pending = new Map<string, { canonicalName: string; ticker: string | null; nameEnShort: string; key: string }>();

  for (const entry of entries) {
    const names = resolveNamesDbFirst(entry.nameOfIssuer);
    if (names.nameZh) continue;
    if (!pending.has(names.issuerKey)) {
      pending.set(names.issuerKey, {
        canonicalName: entry.nameOfIssuer,
        ticker: names.ticker,
        nameEnShort: names.nameEnShort,
        key: names.issuerKey,
      });
    }
  }

  const tasks = [...pending.values()];
  if (!tasks.length) return;

  await mapLimit(tasks, concurrency, async (task) => {
    const nameZh = await translateCompanyNameToZh({
      englishName: task.canonicalName,
      ticker: task.ticker,
    });

    await upsertNameMapEntries({
      db,
      issuerKey: task.key,
      ticker: task.ticker,
      nameZh,
      nameEnShort: task.nameEnShort,
      source: "import-translation",
    });

    zhByIssuerDb.set(task.key, nameZh);
    if (task.ticker) zhByTickerDb.set(task.ticker.toUpperCase(), nameZh);
  });
}

const FILERS = [
  { tribeId: "buffett", name: "Berkshire Hathaway Inc", cik: "1067983" },
  { tribeId: "lilu", name: "Himalaya Capital Management LLC", cik: "1709323" },
  { tribeId: "duan", name: "H&H International Investment LLC", cik: "1759760" },
] as const;

const EDGAR = "https://data.sec.gov";
const HEADERS = {
  "User-Agent": "buffett-tribe research walkklaw@gmail.com",
  Accept: "application/json, text/xml, */*",
};

async function getFilings(cik: string, maxFilings: number) {
  const paddedCik = cik.padStart(10, "0");
  const url = `${EDGAR}/submissions/CIK${paddedCik}.json`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`EDGAR submissions 404 for CIK ${cik}`);

  const data = (await res.json()) as {
    filings: {
      recent: {
        form: string[];
        filingDate: string[];
        accessionNumber: string[];
        reportDate: string[];
        primaryDocument: string[];
      };
    };
  };

  const { form, filingDate, accessionNumber, reportDate, primaryDocument } = data.filings.recent;
  const results: Array<{ accno: string; filedAt: string; reportDate: string; xmlFile: string }> = [];

  for (let i = 0; i < form.length; i++) {
    if (form[i] !== "13F-HR") continue;
    results.push({
      accno: accessionNumber[i],
      filedAt: filingDate[i],
      reportDate: reportDate[i],
      xmlFile: primaryDocument[i],
    });
    if (results.length >= maxFilings) break;
  }

  return results;
}

function quarterKey(year: number, quarter: number): string {
  return `${year}Q${quarter}`;
}

function parseQuarterToken(token: string): { year: number; quarter: number } | null {
  const normalized = token.trim().toUpperCase().replace(/[\s_-]/g, "");
  const m = normalized.match(/^(\d{4})Q([1-4])$/);
  if (!m) return null;
  return { year: Number(m[1]), quarter: Number(m[2]) };
}

function parseQuarterListArg(raw: string): Array<{ year: number; quarter: number }> {
  const parts = raw.split(",").map((x) => x.trim()).filter(Boolean);
  const parsed = parts.map((p) => {
    const q = parseQuarterToken(p);
    if (!q) throw new Error(`Invalid quarter token: "${p}". Use format like 2025Q4.`);
    return q;
  });

  const uniq = new Map<string, { year: number; quarter: number }>();
  for (const q of parsed) uniq.set(quarterKey(q.year, q.quarter), q);
  return [...uniq.values()];
}

function quarterOrdinal(year: number, quarter: number): number {
  return year * 4 + quarter;
}

function quarterRange(from: { year: number; quarter: number }, to: { year: number; quarter: number }) {
  const start = quarterOrdinal(from.year, from.quarter);
  const end = quarterOrdinal(to.year, to.quarter);
  if (start > end) {
    throw new Error(`Invalid quarter range: from ${quarterKey(from.year, from.quarter)} is after to ${quarterKey(to.year, to.quarter)}.`);
  }

  const list: Array<{ year: number; quarter: number }> = [];
  for (let n = start; n <= end; n++) {
    const year = Math.floor((n - 1) / 4);
    const quarter = ((n - 1) % 4) + 1;
    list.push({ year, quarter });
  }
  return list;
}

async function getInfoTableXml(cik: string, accno: string, primaryDoc: string): Promise<string> {
  const accnoPath = accno.replace(/-/g, "");
  const wwwBase = `https://www.sec.gov/Archives/edgar/data/${cik}/${accnoPath}`;

  if (primaryDoc.endsWith(".xml") && !primaryDoc.includes("/")) {
    const xmlRes = await fetch(`${wwwBase}/${primaryDoc}`, { headers: HEADERS });
    if (xmlRes.ok) return xmlRes.text();
  }

  const dirRes = await fetch(`${wwwBase}/`, { headers: HEADERS });
  if (!dirRes.ok) throw new Error(`Directory listing failed: ${wwwBase}/`);
  const html = await dirRes.text();

  const xmlFiles = [...html.matchAll(/href="([^"]+\.xml)"/g)]
    .map((m) => m[1].split("/").pop()!)
    .filter((n) => n !== "primary_doc.xml");

  if (xmlFiles.length === 0) throw new Error(`No information table XML found in ${wwwBase}`);

  const xmlFile = xmlFiles[0];
  const xmlRes = await fetch(`${wwwBase}/${xmlFile}`, { headers: HEADERS });
  if (!xmlRes.ok) throw new Error(`XML fetch failed: ${wwwBase}/${xmlFile}`);
  return xmlRes.text();
}

interface InfoTableEntry {
  nameOfIssuer: string;
  titleOfClass: string;
  cusip: string;
  value: bigint;
  shares: bigint;
  investmentDiscretion: string;
  putCall?: string;
}

function normalizeCusip(raw: string): string {
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!compact) return "";
  if (/^\d+$/.test(compact) && compact.length < 9) {
    return compact.padStart(9, "0");
  }
  return compact;
}

function parseInfoTable(xml: string): InfoTableEntry[] {
  const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true });
  const doc = parser.parse(xml);

  let tables: unknown[] = [];
  const root = doc?.informationTable ?? doc?.["ns1:informationTable"] ?? doc;
  if (root?.infoTable) tables = Array.isArray(root.infoTable) ? root.infoTable : [root.infoTable];

  const rawEntries = tables.map((t: unknown) => {
    const row = t as Record<string, unknown>;
    const shrsOrPrnAmt = row.shrsOrPrnAmt as Record<string, unknown> | undefined;
    const sharesRaw = shrsOrPrnAmt?.sshPrnamt ?? row.sshPrnamt ?? 0;
    const valueRaw = Number(row.value ?? 0);

    return {
      nameOfIssuer: String(row.nameOfIssuer ?? ""),
      titleOfClass: String(row.titleOfClass ?? ""),
      cusip: normalizeCusip(String(row.cusip ?? "")),
      value: BigInt(Math.round(valueRaw)),
      shares: BigInt(Number(sharesRaw)),
      investmentDiscretion: String(row.investmentDiscretion ?? "SOLE"),
      putCall: row.putCall != null ? String(row.putCall) : undefined,
    };
  });

  const byCusip = new Map<string, InfoTableEntry>();
  for (const e of rawEntries) {
    if (!e.cusip) continue;
    const existing = byCusip.get(e.cusip);
    if (existing) {
      byCusip.set(e.cusip, { ...existing, value: existing.value + e.value, shares: existing.shares + e.shares });
    } else {
      byCusip.set(e.cusip, e);
    }
  }
  return [...byCusip.values()];
}

function parseReportDate(reportDate: string): { year: number; quarter: number; date: Date } {
  const d = new Date(reportDate);
  const month = d.getUTCMonth() + 1;
  const quarter = Math.ceil(month / 3);
  return { year: d.getUTCFullYear(), quarter, date: d };
}

async function seedEntityCache() {
  const entities = await db.entity.findMany({
    where: { type: "security" },
    select: { id: true, metadata: true },
  });
  for (const e of entities) {
    const meta = e.metadata as Record<string, unknown> | null;
    if (meta?.cusip && typeof meta.cusip === "string") {
      entityByCusip.set(meta.cusip, { id: e.id, backfilled: true });
    }
  }

  const companies = await db.entity.findMany({
    where: { type: { in: ["company", "master"] }, ticker: { not: null } },
    select: { id: true, ticker: true, type: true, cik: true },
  });
  companies.sort((a, b) => {
    const score = (x: (typeof companies)[number]) =>
      (x.type === "master" ? 120 : 0) + (x.cik ? 100 : 0);
    return score(b) - score(a);
  });
  for (const c of companies) {
    const ticker = normalizeTicker(c.ticker);
    if (ticker && !companyByTickerCache.has(ticker)) companyByTickerCache.set(ticker, c.id);
  }

  const securityRows = await db.security.findMany({
    select: { id: true, entityId: true },
  });
  for (const s of securityRows) {
    securityIdByEntityId.set(s.entityId, s.id);
  }

  console.log(`  Entity cache seeded: ${entityByCusip.size} security entities by cusip`);

  const dbMaps = await db.companyNameMap.findMany({
    where: { keyType: { in: ["ticker", "issuer", "cusip"] } },
    select: { keyType: true, key: true, nameZh: true, ticker: true },
  });
  for (const row of dbMaps) {
    if (row.keyType === "ticker") {
      const ticker = normalizeTicker(row.key);
      if (hasChineseText(row.nameZh) && ticker) zhByTickerDb.set(ticker, row.nameZh);
    } else if (row.keyType === "cusip") {
      const ticker = normalizeTicker(row.ticker);
      if (ticker) tickerByCusipDb.set(row.key.toUpperCase(), ticker);
    } else {
      if (hasChineseText(row.nameZh)) zhByIssuerDb.set(row.key, row.nameZh);
      const ticker = normalizeTicker(row.ticker);
      if (ticker) tickerByIssuerDb.set(row.key, ticker);
    }
  }
  console.log(`  Name map cache seeded: ${dbMaps.length} rows`);
}

async function upsertFilerEntity(filer: (typeof FILERS)[number]) {
  return db.entity.upsert({
    where: { cik: filer.cik },
    create: {
      type: "master",
      canonicalName: filer.name,
      cik: filer.cik,
      tribeId: filer.tribeId,
    },
    update: { type: "master", tribeId: filer.tribeId, canonicalName: filer.name },
  });
}

async function upsertSecurityEntity(entry: InfoTableEntry): Promise<SecuritySnapshot> {
  const baseResolved = resolveNamesDbFirst(entry.nameOfIssuer);
  const resolved = {
    ...baseResolved,
    ticker: resolveTickerWithCusipOverride(entry.cusip, baseResolved.ticker),
  };
  const maybeCompanyId = (resolved.ticker ? companyByTickerCache.get(resolved.ticker) : undefined) ?? null;

  const cached = entityByCusip.get(entry.cusip);
  if (cached) {
    if (!cached.backfilled) {
      const row = await db.entity.findUnique({
        where: { id: cached.id },
        select: { metadata: true, canonicalName: true },
      });
      if (row) {
        const meta = (row.metadata as Record<string, unknown> | null) ?? {};
        const names = resolveNamesDbFirst(row.canonicalName || entry.nameOfIssuer, typeof meta.nameZh === "string" ? meta.nameZh : null);
        const nextMeta = {
          ...meta,
          cusip: entry.cusip,
          titleOfClass: entry.titleOfClass,
          nameZh: names.nameZh,
          nameEnShort: names.nameEnShort,
          companyEntityId: maybeCompanyId ?? (typeof meta.companyEntityId === "string" ? meta.companyEntityId : null),
        };
        await db.entity.update({
          where: { id: cached.id },
          data: {
            canonicalName: entry.nameOfIssuer,
            ticker: names.ticker,
            metadata: nextMeta,
          },
        });
      }
      cached.backfilled = true;
      entityByCusip.set(entry.cusip, cached);
    }

    return {
      entityId: cached.id,
      ticker: resolved.ticker,
      cusip: entry.cusip,
      titleOfClass: entry.titleOfClass,
      companyEntityId: maybeCompanyId,
      metadata: {
        cusip: entry.cusip,
        titleOfClass: entry.titleOfClass,
        nameZh: resolved.nameZh,
        nameEnShort: resolved.nameEnShort,
        companyEntityId: maybeCompanyId,
      },
    };
  }

  const existing = await db.entity.findFirst({
    where: { type: "security", metadata: { path: ["cusip"], equals: entry.cusip } },
    select: { id: true, metadata: true, canonicalName: true },
  });

  if (existing) {
    const meta = (existing.metadata as Record<string, unknown> | null) ?? {};
    const names = resolveNamesDbFirst(existing.canonicalName || entry.nameOfIssuer, typeof meta.nameZh === "string" ? meta.nameZh : null);
    const nextMeta = {
      ...meta,
      cusip: entry.cusip,
      titleOfClass: entry.titleOfClass,
      nameZh: names.nameZh,
      nameEnShort: names.nameEnShort,
      companyEntityId: maybeCompanyId ?? (typeof meta.companyEntityId === "string" ? meta.companyEntityId : null),
    };

    await db.entity.update({
      where: { id: existing.id },
      data: {
        canonicalName: entry.nameOfIssuer,
        ticker: names.ticker,
        metadata: nextMeta,
      },
    });

    entityByCusip.set(entry.cusip, { id: existing.id, backfilled: true });
    return {
      entityId: existing.id,
      ticker: names.ticker,
      cusip: entry.cusip,
      titleOfClass: entry.titleOfClass,
      companyEntityId: (nextMeta.companyEntityId as string | null) ?? null,
      metadata: nextMeta,
    };
  }

  const created = await db.entity.create({
    data: {
      type: "security",
      canonicalName: entry.nameOfIssuer,
      ticker: resolved.ticker,
      metadata: {
        cusip: entry.cusip,
        titleOfClass: entry.titleOfClass,
        nameZh: resolved.nameZh,
        nameEnShort: resolved.nameEnShort,
        companyEntityId: maybeCompanyId,
      },
    },
  }).catch(async () => {
    const found = await db.entity.findFirst({ where: { metadata: { path: ["cusip"], equals: entry.cusip } } });
    if (!found) throw new Error(`Entity not found after conflict: ${entry.cusip}`);
    return found;
  });

  entityByCusip.set(entry.cusip, { id: created.id, backfilled: true });
  return {
    entityId: created.id,
    ticker: resolved.ticker,
    cusip: entry.cusip,
    titleOfClass: entry.titleOfClass,
    companyEntityId: maybeCompanyId,
    metadata: {
      cusip: entry.cusip,
      titleOfClass: entry.titleOfClass,
      nameZh: resolved.nameZh,
      nameEnShort: resolved.nameEnShort,
      companyEntityId: maybeCompanyId,
    },
  };
}

async function ensureSecurityProfilesBulk(snapshots: SecuritySnapshot[]) {
  const missing = snapshots.filter((s) => !securityIdByEntityId.has(s.entityId));
  if (missing.length) {
    await db.security.createMany({
      data: missing.map((s) => ({
        entityId: s.entityId,
        companyEntityId: s.companyEntityId,
        ticker: s.ticker,
        cusip: s.cusip,
        titleOfClass: s.titleOfClass,
        metadata: s.metadata,
      })),
      skipDuplicates: true,
    });
  }

  const rows = await db.security.findMany({
    where: { entityId: { in: snapshots.map((s) => s.entityId) } },
    select: { id: true, entityId: true },
  });
  for (const r of rows) securityIdByEntityId.set(r.entityId, r.id);
}

async function importFiling(
  filerEntityId: string,
  accno: string,
  cik: string,
  filedAt: string,
  reportDate: string,
  entries: InfoTableEntry[],
) {
  const { year, quarter, date } = parseReportDate(reportDate);
  const asOfDate = date;

  const totalValue = entries.reduce((sum, e) => sum + e.value, BigInt(0));

  const existingSource = await db.extSource.findFirst({
    where: { filerEntityId, periodYear: year, periodQuarter: quarter, kind: "13f" },
  });

  const extSource = existingSource ?? await db.extSource.create({
    data: {
      kind: "13f",
      url: `https://www.sec.gov/Archives/edgar/data/${cik}/${accno.replace(/-/g, "")}`,
      ts: asOfDate,
      periodYear: year,
      periodQuarter: quarter,
      filedAt: new Date(filedAt),
      filerEntityId,
      metadata: { accno, cik },
    },
  });

  await translateMissingNames(entries, 4);

  const prepared: Array<{
    holderEntityId: string;
    securityEntityId: string;
    securityId: string | null;
    sourceId: string;
    asOfDate: Date;
    shares: bigint;
    valueUsd: bigint;
    percentOfPortfolio: number;
  }> = [];
  const snapshots: SecuritySnapshot[] = [];

  for (const entry of entries) {
    const snapshot = await upsertSecurityEntity(entry);
    snapshots.push(snapshot);
  }

  await ensureSecurityProfilesBulk(snapshots);

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const snapshot = snapshots[i];
    const securityId = securityIdByEntityId.get(snapshot.entityId) ?? null;
    const percentOfPortfolio = totalValue > BigInt(0)
      ? Number((entry.value * BigInt(10000)) / totalValue) / 100
      : 0;

    prepared.push({
      holderEntityId: filerEntityId,
      securityEntityId: snapshot.entityId,
      securityId,
      sourceId: extSource.id,
      asOfDate,
      shares: entry.shares,
      valueUsd: entry.value,
      percentOfPortfolio,
    });
  }

  const securityIds = prepared.map((p) => p.securityId).filter((x): x is string => Boolean(x));
  const securityEntityIds = prepared.map((p) => p.securityEntityId);

  const existingHoldings = await db.holding.findMany({
    where: {
      holderEntityId: filerEntityId,
      asOfDate,
      OR: [
        { securityId: { in: securityIds } },
        { securityEntityId: { in: securityEntityIds } },
      ],
    },
    select: { id: true, securityId: true, securityEntityId: true },
  });

  const existingByKey = new Map<string, { id: string }>();
  for (const row of existingHoldings) {
    existingByKey.set(row.securityId ?? row.securityEntityId, { id: row.id });
  }

  const toCreate: typeof prepared = [];
  const toUpdate: Array<{ id: string; row: typeof prepared[number] }> = [];

  for (const row of prepared) {
    const key = row.securityId ?? row.securityEntityId;
    const existing = existingByKey.get(key);
    if (existing) {
      toUpdate.push({ id: existing.id, row });
    } else {
      toCreate.push(row);
    }
  }

  if (toCreate.length) {
    await db.holding.createMany({
      data: toCreate,
      skipDuplicates: true,
    });
  }

  for (const group of chunk(toUpdate, 8)) {
    await Promise.all(group.map((item) =>
      db.holding.update({
        where: { id: item.id },
        data: {
          securityEntityId: item.row.securityEntityId,
          securityId: item.row.securityId,
          sourceId: item.row.sourceId,
          shares: item.row.shares,
          valueUsd: item.row.valueUsd,
          percentOfPortfolio: item.row.percentOfPortfolio,
        },
      }),
    ));
  }

  return { imported: prepared.length, year, quarter };
}

async function main() {
  const args = process.argv.slice(2);
  const filerArg = args.find((_, i) => args[i - 1] === "--filer") ?? args.find((_, i) => args[i - 1] === "--investor");
  const quartersArg = args.find((_, i) => args[i - 1] === "--quarters");
  const quarterListArg = args.find((_, i) => args[i - 1] === "--quarter-list") ?? args.find((_, i) => args[i - 1] === "--quarters-list");
  const fromArg = args.find((_, i) => args[i - 1] === "--from");
  const toArg = args.find((_, i) => args[i - 1] === "--to");
  const maxQuarters = quartersArg ? parseInt(quartersArg, 10) : 4;

  if (quarterListArg && (fromArg || toArg)) throw new Error("Use either --quarter-list or --from/--to, not both.");
  if ((fromArg && !toArg) || (!fromArg && toArg)) throw new Error("Both --from and --to are required when using quarter range mode.");

  let quarterList: Array<{ year: number; quarter: number }> = [];
  if (quarterListArg) {
    quarterList = parseQuarterListArg(quarterListArg);
  } else if (fromArg && toArg) {
    const from = parseQuarterToken(fromArg);
    const to = parseQuarterToken(toArg);
    if (!from || !to) throw new Error("Invalid --from/--to value. Use format like 2024Q1, 2025Q4.");
    quarterList = quarterRange(from, to);
  }

  const quarterSet = new Set(quarterList.map((q) => quarterKey(q.year, q.quarter)));

  const filersToRun = filerArg ? FILERS.filter((f) => f.tribeId === filerArg) : FILERS;
  if (filerArg && filersToRun.length === 0) {
    console.error(`Unknown filer: ${filerArg}. Use buffett, lilu, or duan.`);
    process.exit(1);
  }

  await seedEntityCache();

  for (const filer of filersToRun) {
    console.log(`\n── ${filer.name} (CIK ${filer.cik}) ──`);

    const filerEntity = await upsertFilerEntity(filer);
    console.log(`  Entity: ${filerEntity.id}`);

    const fetchCount = quarterList.length > 0 ? 120 : maxQuarters;
    const filings = await getFilings(filer.cik, fetchCount);
    console.log(`  Found ${filings.length} 13F filings (fetched window: ${fetchCount})`);

    const filingsToImport = quarterList.length > 0
      ? filings.filter((f) => {
          const { year, quarter } = parseReportDate(f.reportDate);
          return quarterSet.has(quarterKey(year, quarter));
        })
      : filings;

    if (quarterList.length > 0) {
      const foundSet = new Set(filingsToImport.map((f) => {
        const { year, quarter } = parseReportDate(f.reportDate);
        return quarterKey(year, quarter);
      }));
      const missing = quarterList.map((q) => quarterKey(q.year, q.quarter)).filter((k) => !foundSet.has(k));
      if (missing.length > 0) console.warn(`  Missing requested quarters in fetched window: ${missing.join(", ")}`);
    }

    for (const filing of filingsToImport) {
      console.log(`  Filing ${filing.accno} (${filing.reportDate}, filed ${filing.filedAt}) → ${filing.xmlFile}`);
      try {
        const started = Date.now();
        const xml = await getInfoTableXml(filer.cik, filing.accno, filing.xmlFile);
        const entries = parseInfoTable(xml);
        console.log(`    Parsed ${entries.length} positions`);
        if (entries.length === 0) {
          console.warn("    ⚠ No positions parsed — check XML structure");
          continue;
        }

        const { imported, year, quarter } = await importFiling(
          filerEntity.id,
          filing.accno,
          filer.cik,
          filing.filedAt,
          filing.reportDate,
          entries,
        );
        const elapsed = ((Date.now() - started) / 1000).toFixed(1);
        console.log(`    ✓ ${imported} holdings saved for Q${quarter} ${year} (${elapsed}s)`);
      } catch (err) {
        console.error(`    ✗ Error: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  console.log("\nDone.");
}

main()
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
