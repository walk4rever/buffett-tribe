/**
 * 13f-import-core.ts
 *
 * Shared 13F Entity / ExtSource / Security / Holding storage primitives.
 */
import { Prisma, PrismaClient } from "@prisma/client";
import crypto from "node:crypto";
import { hasChineseText, issuerKey, resolveCompanyNamesFromMaps } from "../../src/lib/company-name-map";
import { isValidTickerFormat, normalizeTicker } from "../../src/lib/ticker";
import { translateCompanyNameToZh, upsertNameMapEntries } from "./company-name-zh";
import { ImportTimer } from "./import-timer";
import { classifySecurityKind } from "./security-kind-classify";

export const db = new PrismaClient();

const zhByTickerDb = new Map<string, string>();
const zhByIssuerDb = new Map<string, string>();
const tickerByIssuerDb = new Map<string, string>();
const tickerByCusipDb = new Map<string, string>();

const companyByTickerCache = new Map<string, string>();
const securityByCusip = new Map<string, SecuritySnapshot>();
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
  if (ticker && !isValidTickerFormat(ticker)) {
    console.warn(`  [ticker] rejecting malformed ticker "${ticker}" for CUSIP ${cusip}`);
    return null;
  }
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

async function upsertHoldingsBulk(rows: Array<{
  holderEntityId: string;
  securityId: string;
  sourceId: string;
  asOfDate: Date;
  shares: bigint;
  valueUsd: bigint;
  percentOfPortfolio: number;
}>) {
  if (!rows.length) return { count: 0 };

  const values = Prisma.join(rows.map((row) => Prisma.sql`(
    ${crypto.randomUUID()},
    ${row.holderEntityId},
    ${row.securityId},
    ${row.sourceId},
    ${row.asOfDate},
    ${row.shares},
    ${row.valueUsd},
    ${row.percentOfPortfolio}
  )`));

  const count = await db.$executeRaw`
    INSERT INTO "Holding" (
      "id",
      "holderEntityId",
      "securityId",
      "sourceId",
      "asOfDate",
      "shares",
      "valueUsd",
      "percentOfPortfolio"
    )
    VALUES ${values}
    ON CONFLICT ("holderEntityId", "securityId", "asOfDate")
    DO UPDATE SET
      "sourceId" = EXCLUDED."sourceId",
      "shares" = EXCLUDED."shares",
      "valueUsd" = EXCLUDED."valueUsd",
      "percentOfPortfolio" = EXCLUDED."percentOfPortfolio"
  `;

  return { count };
}

/**
 * A quarter's true reportable portfolio is sometimes split across multiple
 * accessions — e.g. a fund discloses most positions in the primary 13F-HR,
 * then adds one that was under a confidential treatment order via a separate
 * 13F-HR/A once it expires. importFiling() only sees one filing's entries at
 * a time, so percentOfPortfolio computed there is scoped to that single
 * document. Re-derive it here from every Holding row sharing the same
 * (holderEntityId, asOfDate) — the table's actual unique-key scope, and the
 * real boundary of "this filer's quarter" — so a same-quarter sibling filing
 * (imported before or after this one) is always reflected correctly.
 */
async function reconcilePercentOfPortfolio(
  holderEntityId: string,
  asOfDate: Date,
  timer?: ImportTimer,
) {
  await runTimed(timer, "reconcile percentOfPortfolio", async () => {
    const rows = (await db.holding.findMany({
      where: { holderEntityId, asOfDate },
      select: { id: true, valueUsd: true },
    })).map((r) => ({ id: r.id, valueUsd: r.valueUsd ?? BigInt(0) }));
    const total = rows.reduce((sum, r) => sum + r.valueUsd, BigInt(0));
    if (total <= BigInt(0)) return { updated: 0 };

    const cases = rows.map((r) => {
      const pct = Number((r.valueUsd * BigInt(10000)) / total) / 100;
      return Prisma.sql`WHEN ${r.id} THEN ${pct}`;
    });

    await db.$executeRaw`
      UPDATE "Holding"
      SET "percentOfPortfolio" = CASE "id" ${Prisma.join(cases, " ")} END
      WHERE "id" IN (${Prisma.join(rows.map((r) => r.id))})
    `;
    return { updated: rows.length };
  }, (result) => `rows=${result.updated}`);
}

async function runTimed<T>(
  timer: ImportTimer | undefined,
  step: string,
  fn: () => Promise<T>,
  details?: (result: T) => string | undefined,
) {
  return timer ? timer.time(step, fn, details) : fn();
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
    // A single untranslatable issuer name (e.g. a truncated SEC nameOfIssuer
    // like "ELEVANCE HEALTH INC FORMERLY" that confuses the LLM into an empty
    // response) must not abort the whole filing — mapLimit has no per-task
    // isolation, so one throw here would fail every other company's holding
    // in the same quarter too. Fall back to the English short name instead.
    let nameZh: string;
    try {
      nameZh = await translateCompanyNameToZh({
        englishName: task.canonicalName,
        ticker: task.ticker,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  ⚠ zh translation failed for "${task.canonicalName}" (${msg}); falling back to English name`);
      nameZh = task.nameEnShort;
    }

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

export type FilerConfig = { tribeId: string; name: string; cik: string };

// Tracked filers live in the Filer table (written by the onboarding
// pipeline — see registerTribeMember() in alpha-investor-registration.ts,
// which calls upsertFilerEntity() below before this could ever be queried
// for a brand-new investor). Querying fresh here — instead of a hardcoded
// array — means a newly onboarded investor is picked up by the next
// `import:13f --all` quarterly reimport with no code change required.
export async function getTrackedFilers(): Promise<FilerConfig[]> {
  const rows = await db.filer.findMany({
    where: { filerCik: { not: null } },
    select: { tribeId: true, name: true, filerCik: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({ tribeId: r.tribeId, name: r.name, cik: r.filerCik! }));
}

export function quarterKey(year: number, quarter: number): string {
  return `${year}Q${quarter}`;
}

export function parseQuarterToken(token: string): { year: number; quarter: number } | null {
  const normalized = token.trim().toUpperCase().replace(/[\s_-]/g, "");
  const m = normalized.match(/^(\d{4})Q([1-4])$/);
  if (!m) return null;
  return { year: Number(m[1]), quarter: Number(m[2]) };
}

export function parseQuarterListArg(raw: string): Array<{ year: number; quarter: number }> {
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

// 13F-HR "period of report" is always a calendar quarter-end date — used to
// pre-filter edgartools filing metadata (cheap) before parsing full SGML (expensive).
export function quarterEndDate(year: number, quarter: number): string {
  const month = quarter * 3;
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

export function quarterRange(from: { year: number; quarter: number }, to: { year: number; quarter: number }) {
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

export interface InfoTableEntry {
  nameOfIssuer: string;
  titleOfClass: string;
  cusip: string;
  value: bigint;
  shares: bigint;
  investmentDiscretion: string;
  putCall?: string;
  ticker?: string | null;
}

function securitySnapshotFromRow(row: {
  id: string;
  companyEntityId: string | null;
  ticker: string | null;
  cusip: string | null;
  titleOfClass: string | null;
  metadata: unknown;
}, fallback?: InfoTableEntry): SecuritySnapshot {
  return {
    securityId: row.id,
    companyEntityId: row.companyEntityId ?? "",
    ticker: row.ticker ?? fallback?.ticker ?? null,
    cusip: row.cusip ?? fallback?.cusip ?? "",
    titleOfClass: row.titleOfClass ?? fallback?.titleOfClass ?? "",
    metadata: (row.metadata as Record<string, unknown> | null) ?? {},
  };
}

export function normalizeCusip(raw: string): string {
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!compact) return "";
  if (/^\d+$/.test(compact) && compact.length < 9) {
    return compact.padStart(9, "0");
  }
  return compact;
}

export function parseReportDate(reportDate: string): { year: number; quarter: number; date: Date } {
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

export async function seedEntityCache() {
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
    select: { id: true, cusip: true, companyEntityId: true, ticker: true, titleOfClass: true, metadata: true },
  });
  for (const s of securityRows) {
    if (s.cusip) securityByCusip.set(s.cusip, securitySnapshotFromRow(s));
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

export async function preloadSecurityResolution(entries: InfoTableEntry[]) {
  const cusips = [...new Set(entries.map((entry) => entry.cusip).filter(Boolean))];
  const tickers = [...new Set(entries.flatMap((entry) => {
    const baseResolved = resolveNamesDbFirst(entry.nameOfIssuer);
    const ticker = resolveTickerWithCusipOverride(entry.cusip, normalizeTicker(entry.ticker) ?? baseResolved.ticker);
    return ticker ? [ticker] : [];
  }))];

  const missingCusips = cusips.filter((cusip) => !securityByCusip.has(cusip));
  if (missingCusips.length) {
    const rows = await db.security.findMany({
      where: { cusip: { in: missingCusips } },
      select: { id: true, cusip: true, companyEntityId: true, ticker: true, titleOfClass: true, metadata: true },
    });
    for (const row of rows) {
      if (row.cusip) securityByCusip.set(row.cusip, securitySnapshotFromRow(row));
    }
  }

  const missingTickers = tickers.filter((ticker) => !companyByTickerCache.has(ticker));
  if (missingTickers.length) {
    const companies = await db.entity.findMany({
      where: {
        type: "company",
        ticker: { in: missingTickers, mode: "insensitive" },
      },
      select: { id: true, ticker: true },
    });
    for (const company of companies) {
      const ticker = normalizeTicker(company.ticker);
      if (ticker && !companyByTickerCache.has(ticker)) companyByTickerCache.set(ticker, company.id);
    }
  }

  return {
    cusips: cusips.length,
    tickers: tickers.length,
    missingCusips: missingCusips.length,
    missingTickers: missingTickers.length,
  };
}

export async function upsertFilerEntity(filer: FilerConfig) {
  // Master entities are identified by tribeId (not CIK, which may belong to the company entity).
  const existing = await db.entity.findFirst({
    where: { tribeId: filer.tribeId },
    select: { id: true },
  });

  const entity = existing
    ? await db.entity.update({
        where: { id: existing.id },
        data: { type: "master", canonicalName: filer.name },
      })
    : await db.entity.create({
        data: {
          type: "master",
          canonicalName: filer.name,
          tribeId: filer.tribeId,
        },
      });

  // Keep the Filer companion table in sync (see TODO.md「Filer / Company
  // 拆分」) so every filer is discoverable there the moment it's first
  // imported, before any 10-K import for it ever runs.
  //
  // isMasterPersona is set only on create, defaulting new filers to alpha
  // (false) — the core tribe's 3 rows already exist and always hit the
  // update branch. It's intentionally omitted from `update`: this function
  // runs on every 13F reimport (not just onboarding), and overwriting the
  // category set at registration time on every quarterly reimport would
  // silently reclassify investors.
  await db.filer.upsert({
    where: { tribeId: filer.tribeId },
    create: {
      tribeId: filer.tribeId,
      name: filer.name,
      filerCik: filer.cik,
      filerEntityId: entity.id,
      isMasterPersona: false,
    },
    update: {
      name: filer.name,
      filerCik: filer.cik,
      filerEntityId: entity.id,
    },
  });

  return entity;
}

async function upsertSecurityEntity(entry: InfoTableEntry): Promise<SecuritySnapshot> {
  const baseResolved = resolveNamesDbFirst(entry.nameOfIssuer);
  const resolved = {
    ...baseResolved,
    ticker: resolveTickerWithCusipOverride(entry.cusip, normalizeTicker(entry.ticker) ?? baseResolved.ticker),
  };

  // 1. Check cusip cache
  const cachedSec = securityByCusip.get(entry.cusip);
  if (cachedSec) {
    // Backfill companyEntityId if missing
    if (!cachedSec.companyEntityId && resolved.ticker) {
      const companyId = companyByTickerCache.get(resolved.ticker);
      if (companyId) {
        await db.security.update({ where: { id: cachedSec.securityId }, data: { companyEntityId: companyId } });
        cachedSec.companyEntityId = companyId;
      }
    }
    if (cachedSec.companyEntityId || cachedSec.securityId) {
      return {
        securityId: cachedSec.securityId,
        companyEntityId: cachedSec.companyEntityId,
        ticker: cachedSec.ticker ?? resolved.ticker,
        cusip: entry.cusip,
        titleOfClass: cachedSec.titleOfClass || entry.titleOfClass,
        metadata: cachedSec.metadata,
      };
    }
  }

  // 2. Find existing security by cusip
  const existingSec = await db.security.findFirst({ where: { cusip: entry.cusip } });
  if (existingSec) {
    const snapshot = securitySnapshotFromRow(existingSec, entry);
    securityByCusip.set(entry.cusip, snapshot);
    // Backfill companyEntityId if missing
    if (!existingSec.companyEntityId && resolved.ticker) {
      const companyId = companyByTickerCache.get(resolved.ticker);
      if (companyId) {
        await db.security.update({ where: { id: existingSec.id }, data: { companyEntityId: companyId } });
        existingSec.companyEntityId = companyId;
        snapshot.companyEntityId = companyId;
      }
    }
    return {
      securityId: existingSec.id,
      companyEntityId: existingSec.companyEntityId ?? "",
      ticker: existingSec.ticker ?? resolved.ticker,
      cusip: entry.cusip,
      titleOfClass: existingSec.titleOfClass ?? entry.titleOfClass,
      metadata: snapshot.metadata,
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
    securityByCusip.set(entry.cusip, {
      securityId: existingByEntity.id,
      companyEntityId: companyId,
      ticker: resolved.ticker,
      cusip: entry.cusip,
      titleOfClass: existingByEntity.titleOfClass ?? entry.titleOfClass,
      metadata: (existingByEntity.metadata as Record<string, unknown> | null) ?? {
        nameZh: resolved.nameZh,
        nameEnShort: resolved.nameEnShort,
        source: "import-13f",
      },
    });
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
      kind: classifySecurityKind({ titleOfClass: entry.titleOfClass, putCall: entry.putCall }).kind,
      metadata: {
        nameZh: resolved.nameZh,
        nameEnShort: resolved.nameEnShort,
        source: "import-13f",
      },
    },
  });
  securityByCusip.set(entry.cusip, {
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
  });

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

export async function importFiling(
  filerEntityId: string,
  accno: string,
  cik: string,
  filedAt: string,
  reportDate: string,
  entries: InfoTableEntry[],
  timer?: ImportTimer,
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

  await runTimed(timer, "translate missing names", () => translateMissingNames(entries, 4));
  await runTimed(
    timer,
    "preload security resolution",
    () => preloadSecurityResolution(entries),
    (stats) => `cusips=${stats.cusips}, tickers=${stats.tickers}, missingCusips=${stats.missingCusips}, missingTickers=${stats.missingTickers}`,
  );

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

  await runTimed(timer, "upsert securities", async () => {
    for (const entry of entries) {
    const snapshot = await upsertSecurityEntity(entry);
    snapshots.push(snapshot);
    }
  }, () => `securities=${snapshots.length}`);

  await runTimed(timer, "ensure security profiles", () => ensureSecurityProfilesBulk());

  const aggregated = new Map<string, {
    holderEntityId: string;
    securityId: string;
    sourceId: string;
    asOfDate: Date;
    shares: bigint;
    valueUsd: bigint;
    percentOfPortfolio: number;
  }>();

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const snapshot = snapshots[i];
    const percentOfPortfolio = totalValue > BigInt(0)
      ? Number((entry.value * BigInt(10000)) / totalValue) / 100
      : 0;

    const existing = aggregated.get(snapshot.securityId);
    if (existing) {
      existing.shares += entry.shares;
      existing.valueUsd += entry.value * valueUsdScale;
      existing.percentOfPortfolio += percentOfPortfolio;
    } else {
      aggregated.set(snapshot.securityId, {
        holderEntityId: filerEntityId,
        securityId: snapshot.securityId,
        sourceId: extSource.id,
        asOfDate,
        shares: entry.shares,
        valueUsd: entry.value * valueUsdScale,
        percentOfPortfolio,
      });
    }
  }

  prepared.push(...aggregated.values());

  await runTimed(timer, "upsert holdings", () => upsertHoldingsBulk(prepared), (result) => `rows=${prepared.length}, affected=${result.count}`);
  await reconcilePercentOfPortfolio(filerEntityId, asOfDate, timer);

  return { imported: prepared.length, year, quarter };
}
