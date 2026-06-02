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

const companyByTickerCache = new Map<string, string>();
const securityByCusip = new Map<string, string>();
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
  securityId: string;
  companyEntityId: string;
  ticker: string | null;
  cusip: string;
  titleOfClass: string;
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

function infer13fValueUsdScale(entries: InfoTableEntry[]) {
  const prices = entries
    .filter((entry) => entry.shares > BigInt(0) && entry.value > BigInt(0))
    .map((entry) => Number(entry.value) / Number(entry.shares))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (!prices.length) return 1;

  const median = prices[Math.floor(prices.length / 2)] ?? 0;
  const underOneRatio = prices.filter((price) => price < 1).length / prices.length;
  return median < 1 || underOneRatio >= 0.6 ? 1000 : 1;
}

async function seedEntityCache() {
  // Cache company entities by ticker
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

  // Cache securities by cusip
  const securityRows = await db.security.findMany({
    select: { id: true, cusip: true, companyEntityId: true, ticker: true },
  });
  for (const s of securityRows) {
    if (s.cusip) securityByCusip.set(s.cusip, s.id);
    if (s.companyEntityId && s.ticker && !companyByTickerCache.has(s.ticker.toUpperCase())) {
      companyByTickerCache.set(s.ticker.toUpperCase(), s.companyEntityId);
    }
  }

  console.log(`  Entity cache seeded: ${securityByCusip.size} securities by cusip`);

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
  // Master entities are identified by tribeId (not CIK, which may belong to the company entity).
  const existing = await db.entity.findFirst({
    where: { tribeId: filer.tribeId },
    select: { id: true },
  });

  if (existing) {
    return db.entity.update({
      where: { id: existing.id },
      data: { type: "master", canonicalName: filer.name },
    });
  }

  return db.entity.create({
    data: {
      type: "master",
      canonicalName: filer.name,
      tribeId: filer.tribeId,
    },
  });
}

async function upsertSecurityEntity(entry: InfoTableEntry): Promise<SecuritySnapshot> {
  const baseResolved = resolveNamesDbFirst(entry.nameOfIssuer);
  const resolved = {
    ...baseResolved,
    ticker: resolveTickerWithCusipOverride(entry.cusip, baseResolved.ticker),
  };

  // 1. Check cusip cache
  const cachedSecId = securityByCusip.get(entry.cusip);
  if (cachedSecId) {
    const sec = await db.security.findUnique({ where: { id: cachedSecId } });
    if (sec) {
      // Backfill companyEntityId if missing
      if (!sec.companyEntityId && resolved.ticker) {
        const companyId = companyByTickerCache.get(resolved.ticker);
        if (companyId) {
          await db.security.update({ where: { id: sec.id }, data: { companyEntityId: companyId } });
          sec.companyEntityId = companyId;
        }
      }
      return {
        securityId: sec.id,
        companyEntityId: sec.companyEntityId ?? "",
        ticker: sec.ticker ?? resolved.ticker,
        cusip: entry.cusip,
        titleOfClass: sec.titleOfClass ?? entry.titleOfClass,
        metadata: (sec.metadata as Record<string, unknown>) ?? {},
      };
    }
  }

  // 2. Find existing security by cusip
  const existingSec = await db.security.findFirst({ where: { cusip: entry.cusip } });
  if (existingSec) {
    securityByCusip.set(entry.cusip, existingSec.id);
    // Backfill companyEntityId if missing
    if (!existingSec.companyEntityId && resolved.ticker) {
      const companyId = companyByTickerCache.get(resolved.ticker);
      if (companyId) {
        await db.security.update({ where: { id: existingSec.id }, data: { companyEntityId: companyId } });
        existingSec.companyEntityId = companyId;
      }
    }
    return {
      securityId: existingSec.id,
      companyEntityId: existingSec.companyEntityId ?? "",
      ticker: existingSec.ticker ?? resolved.ticker,
      cusip: entry.cusip,
      titleOfClass: existingSec.titleOfClass ?? entry.titleOfClass,
      metadata: (existingSec.metadata as Record<string, unknown>) ?? {},
    };
  }

  // 3. Resolve company entity by ticker
  let companyId = resolved.ticker ? companyByTickerCache.get(resolved.ticker) : null;

  if (!companyId && resolved.ticker) {
    const company = await db.entity.findFirst({
      where: { type: "company", ticker: { equals: resolved.ticker, mode: "insensitive" } },
      select: { id: true },
    });
    if (company) {
      companyId = company.id;
      companyByTickerCache.set(resolved.ticker, company.id);
    }
  }

  // 4. Create company entity if not found
  if (!companyId) {
    const company = await db.entity.create({
      data: {
        type: "company",
        canonicalName: entry.nameOfIssuer,
        ticker: resolved.ticker,
        metadata: {
          cusip: entry.cusip,
          titleOfClass: entry.titleOfClass,
          nameZh: resolved.nameZh,
          nameEnShort: resolved.nameEnShort,
          source: "import-13f",
        },
      },
    });
    companyId = company.id;
    if (resolved.ticker) companyByTickerCache.set(resolved.ticker, company.id);
  }

  // 5. Check if a security already exists for this company entity
  const existingByEntity = await db.security.findFirst({
    where: { companyEntityId: companyId },
  });
  if (existingByEntity) {
    // Update it with this cusip if missing
    if (!existingByEntity.cusip) {
      await db.security.update({
        where: { id: existingByEntity.id },
        data: { cusip: entry.cusip, titleOfClass: entry.titleOfClass },
      });
    }
    securityByCusip.set(entry.cusip, existingByEntity.id);
    return {
      securityId: existingByEntity.id,
      companyEntityId: companyId,
      ticker: resolved.ticker,
      cusip: entry.cusip,
      titleOfClass: existingByEntity.titleOfClass ?? entry.titleOfClass,
      metadata: (existingByEntity.metadata as Record<string, unknown>) ?? {
        nameZh: resolved.nameZh,
        nameEnShort: resolved.nameEnShort,
        source: "import-13f",
      },
    };
  }

  // 6. Create security record
  const newSec = await db.security.create({
    data: {
      companyEntityId: companyId,
      ticker: resolved.ticker,
      cusip: entry.cusip,
      titleOfClass: entry.titleOfClass,
      metadata: {
        nameZh: resolved.nameZh,
        nameEnShort: resolved.nameEnShort,
        source: "import-13f",
      },
    },
  });
  securityByCusip.set(entry.cusip, newSec.id);

  return {
    securityId: newSec.id,
    companyEntityId: companyId,
    ticker: resolved.ticker,
    cusip: entry.cusip,
    titleOfClass: entry.titleOfClass,
    metadata: {
      nameZh: resolved.nameZh,
      nameEnShort: resolved.nameEnShort,
      source: "import-13f",
    },
  };
}

async function ensureSecurityProfilesBulk() {
  // No-op: Security records are already created/updated in upsertSecurityEntity.
  // This function is kept for backward compatibility during the migration.
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
  const valueUsdScale = BigInt(infer13fValueUsdScale(entries));

  const existingSource = await db.extSource.findFirst({
    where: { filerEntityId, accessionNumber: accno },
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
      accessionNumber: accno,
      metadata: { accno, accession: accno, cik },
    },
  });

  await translateMissingNames(entries, 4);

  const prepared: Array<{
    holderEntityId: string;
    securityId: string;
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

  await ensureSecurityProfilesBulk();

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const snapshot = snapshots[i];
    const percentOfPortfolio = totalValue > BigInt(0)
      ? Number((entry.value * BigInt(10000)) / totalValue) / 100
      : 0;

    prepared.push({
      holderEntityId: filerEntityId,
      securityId: snapshot.securityId,
      sourceId: extSource.id,
      asOfDate,
      shares: entry.shares,
      valueUsd: entry.value * valueUsdScale,
      percentOfPortfolio,
    });
  }

  const securityIds = prepared.map((p) => p.securityId);

  const existingHoldings = await db.holding.findMany({
    where: {
      holderEntityId: filerEntityId,
      asOfDate,
      securityId: { in: securityIds },
    },
    select: { id: true, securityId: true },
  });

  const existingByKey = new Map<string, { id: string }>();
  for (const row of existingHoldings) {
    existingByKey.set(row.securityId, { id: row.id });
  }

  const toCreate: typeof prepared = [];
  const toUpdate: Array<{ id: string; row: typeof prepared[number] }> = [];

  for (const row of prepared) {
    const existing = existingByKey.get(row.securityId);
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
