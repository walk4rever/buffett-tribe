import db from "@/lib/prisma";
import { formatUsdInYi } from "@/lib/currency";
import { computeHoldingActivity, computeShareDeltaPct } from "@/lib/holding-activity";
import { normalizeTicker } from "@/lib/ticker";
import { Prisma } from "@prisma/client";
import type { BusinessCanvasData } from "@/components/CompanyBusinessCanvas";

export function normalizeCompanyCik(cikRaw: string | null | undefined) {
  const digits = String(cikRaw ?? "").replace(/\D/g, "");
  if (!digits) return null;
  const normalized = String(Number(digits));
  if (!normalized || normalized === "0" || Number.isNaN(Number(normalized))) return null;
  return normalized;
}

export function formatCompanyCikSlug(cikRaw: string | null | undefined) {
  const cik = normalizeCompanyCik(cikRaw);
  if (!cik) return null;
  return `CIK${cik.padStart(10, "0")}`;
}

export function formatCompanyCikUrl(cikRaw: string | null | undefined) {
  const slug = formatCompanyCikSlug(cikRaw);
  return slug ? `/company/${slug}` : null;
}

export type CompanyIdentifier =
  | { market: "us"; cik: string }
  | { market: "cn" | "hk"; code: string };

/**
 * Single entry point for turning a `/company/[id]` URL segment into a
 * market + identifier. `cn-`/`hk-` prefixes are checked first since they're
 * unambiguous; anything else falls back to the existing permissive CIK
 * parsing (normalizeCompanyCik already strips a `CIK` prefix or accepts a
 * bare digit string) so old non-canonical CIK URLs keep redirecting the way
 * they always have.
 */
export function parseCompanyIdentifier(raw: string): CompanyIdentifier | null {
  const trimmed = raw.trim();
  const marketMatch = trimmed.match(/^(cn|hk)-(\d+)$/i);
  if (marketMatch) {
    return { market: marketMatch[1].toLowerCase() as "cn" | "hk", code: marketMatch[2] };
  }
  const cik = normalizeCompanyCik(trimmed);
  return cik ? { market: "us", cik } : null;
}

/**
 * Single canonical URL builder for all markets — the one place `market`
 * enters a URL-building decision. Every other call site should build a URL
 * through this function rather than branching on `market` itself.
 */
export function formatCompanyUrl(entity: {
  cik?: string | null;
  market?: string | null;
  code?: string | null;
}): string | null {
  if (entity.cik) return formatCompanyCikUrl(entity.cik);
  if (entity.market && entity.code) return `/company/${entity.market}-${entity.code}`;
  return null;
}

function logDbFallback(scope: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  if (process.env.DEBUG_DB_FALLBACK === "1") {
    console.warn(`[company-data:${scope}] DB query failed, fallback to empty result: ${message}`);
  }
}

function isConnectionClosedError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return /server has closed the connection|connection.*closed|P1017/i.test(message);
}

async function retryOnce<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (err) {
    if (!isConnectionClosedError(err)) throw err;
    await new Promise((resolve) => setTimeout(resolve, 200));
    return await fn();
  }
}

export async function getCompanyByCik(cikRaw: string) {
  const cik = normalizeCompanyCik(cikRaw);
  if (!cik) return null;

  const entity = await db.entity.findUnique({
    where: { cik },
    select: {
      id: true,
      type: true,
      canonicalName: true,
      ticker: true,
      cik: true,
      market: true,
      code: true,
      sector: true,
      metadata: true,
    },
  });
  return entity;
}

export async function getCompanyByTicker(ticker: string) {
  const normalizedTicker = normalizeTicker(ticker);
  if (!normalizedTicker) return null;
  const rows = await db.entity.findMany({
    where: {
      type: "company",
      ticker: {
        equals: normalizedTicker,
        mode: "insensitive",
      },
    },
    select: {
      id: true,
      type: true,
      canonicalName: true,
      ticker: true,
      cik: true,
      sector: true,
      metadata: true,
      updatedAt: true,
      _count: {
        select: {
          financials: true,
        },
      },
    },
  });

  if (rows.length === 0) {
    // Fallback: resolve via security ticker (e.g. GOOG/GOOGL share classes).
    const security = await db.security.findFirst({
      where: { ticker: { equals: normalizedTicker, mode: "insensitive" } },
      select: { companyEntityId: true },
      orderBy: { updatedAt: "desc" },
    });

    const fallbackCompanyId = security?.companyEntityId;
    if (!fallbackCompanyId) return null;

    const resolved = await db.entity.findUnique({
      where: { id: fallbackCompanyId },
      select: {
        id: true,
        canonicalName: true,
        ticker: true,
        cik: true,
        sector: true,
        metadata: true,
      },
    });
    if (!resolved) return null;
    return resolved;
  }

  const best = [...rows].sort((a, b) => {
    const score = (x: (typeof rows)[number]) =>
      (x.cik ? 100 : 0) +
      (x._count.financials > 0 ? 50 : 0);
    const diff = score(b) - score(a);
    if (diff !== 0) return diff;
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  })[0];

  return {
    id: best.id,
    canonicalName: best.canonicalName,
    ticker: best.ticker,
    cik: best.cik,
    sector: best.sector,
    metadata: best.metadata,
  };
}

/**
 * Resolves a `/company/[id]` URL segment to an Entity, dispatching on market.
 * This is the only place that decides which lookup strategy a URL uses —
 * callers (the route files) don't branch on market themselves.
 */
export async function getCompanyByIdentifier(raw: string) {
  const parsed = parseCompanyIdentifier(raw);
  if (!parsed) return null;
  if (parsed.market === "us") return getCompanyByCik(parsed.cik);

  return db.entity.findFirst({
    where: { type: "company", market: parsed.market, code: parsed.code },
    select: {
      id: true,
      type: true,
      canonicalName: true,
      ticker: true,
      cik: true,
      market: true,
      code: true,
      sector: true,
      metadata: true,
    },
  });
}

export async function getCompanySecurities(entityId: string) {
  const rows = await db.security.findMany({
    where: { companyEntityId: entityId },
    select: {
      id: true,
      ticker: true,
      shareClass: true,
      titleOfClass: true,
      exchange: true,
    },
    orderBy: { ticker: "asc" },
  });

  return rows;
}

async function getEntityFamilyIds(entityId: string) {
  const base = await db.entity.findUnique({
    where: { id: entityId },
    select: { id: true, ticker: true, type: true, cik: true },
  });
  if (!base) return [entityId];
  if (!base.ticker) return [entityId];

  const siblings = await db.entity.findMany({
    where: {
      type: "company",
      ticker: {
        equals: normalizeTicker(base.ticker) ?? base.ticker,
        mode: "insensitive",
      },
    },
    select: { id: true, type: true, cik: true },
  });

  if (!siblings.length) return [entityId];
  return siblings
    .sort((a, b) => {
      const score = (x: (typeof siblings)[number]) => (x.cik ? 100 : 0);
      return score(b) - score(a);
    })
    .map((s) => s.id);
}

async function getSecurityIdsForCompany(entityId: string) {
  const base = await db.entity.findUnique({
    where: { id: entityId },
    select: { id: true, ticker: true, canonicalName: true },
  });
  if (!base) return { profileIds: [] as string[], fallbackTicker: null as string | null };

  const familyCompanyIds = await getEntityFamilyIds(entityId);
  const ticker = normalizeTicker(base.ticker);

  const securityProfiles = await db.security.findMany({
    where: {
      OR: [
        { companyEntityId: entityId },
        ...(familyCompanyIds.length > 1
          ? familyCompanyIds.map((id) => ({ companyEntityId: id }))
          : []),
        ...(ticker
          ? [
            {
              ticker: { equals: ticker, mode: Prisma.QueryMode.insensitive },
            },
          ]
          : []),
      ],
    },
    select: { id: true },
  });

  return {
    profileIds: securityProfiles.map((s) => s.id),
    fallbackTicker: ticker,
  };
}

export async function getCompanyFinancials(entityId: string, limit = 8) {
  const familyIds = await getEntityFamilyIds(entityId);
  const rows = await retryOnce(async () =>
    db.financial.findMany({
      where: { entityId: { in: familyIds }, periodType: "FY" },
      orderBy: [{ periodEnd: "desc" }, { lineItem: "asc" }],
      select: {
        id: true,
        periodEnd: true,
        lineItem: true,
        value: true,
        unit: true,
      },
      take: 400,
    }),
  );

  const byYear = new Map<number, { periodEnd: Date; items: Record<string, string> }>();
  for (const row of rows) {
    const year = row.periodEnd.getUTCFullYear();
    if (!byYear.has(year)) byYear.set(year, { periodEnd: row.periodEnd, items: {} });
    const bucket = byYear.get(year)!;
    if (row.periodEnd > bucket.periodEnd) bucket.periodEnd = row.periodEnd;
    if (!(row.lineItem in bucket.items) && row.value != null) {
      bucket.items[row.lineItem] = row.value.toString();
    }
  }

  return [...byYear.entries()]
    .sort((a, b) => b[0] - a[0])
    .slice(0, limit)
    .map(([year, data]) => ({ year, periodEnd: data.periodEnd, items: data.items }));
}

/**
 * A company's Financial rows are always one currency across every year and
 * line item (US: always "USD"; a CN/HK entity's currency is a verified fact
 * from scripts/lib/cn-hk-company-seeds.ts, not derived from `market` — see
 * that file's comment on why). Kept separate from getCompanyFinancials
 * rather than folded into its return shape, since that function already has
 * a second caller (api/canvas/route.ts) expecting a bare array.
 */
export async function getFinancialsCurrency(entityId: string): Promise<string | null> {
  const familyIds = await getEntityFamilyIds(entityId);
  const row = await retryOnce(async () =>
    db.financial.findFirst({
      where: { entityId: { in: familyIds }, periodType: "FY", unit: { not: null } },
      select: { unit: true },
    }),
  );
  return row?.unit ?? null;
}

export type HolderRow = {
  id: string;
  holderName: string;
  tribeId: string | null;
  ticker: string | null;
  securityName: string;
  percent: number | null;
  valueUsd: bigint | null;
  shares: bigint | null;
  sourceYear: number | null;
  sourceQuarter: number | null;
  positionYear: number | null;
  positionQuarter: number | null;
  asOfDate: Date | null;
  activity: "New" | "Added" | "Reduced" | "Unchanged" | "SoldOut";
  shareDeltaPct: number | null;
  isSoldOut: boolean;
};

export async function getRecentHolders(entityId: string, limit = 20) {
  const securityScope = await getSecurityIdsForCompany(entityId);
  const rows = await retryOnce(async () =>
    db.holding.findMany({
      where: {
        securityId: { in: securityScope.profileIds },
      },
      orderBy: [
        { holderEntityId: "asc" },
        { asOfDate: "desc" },
        { securityId: "asc" },
      ],
      include: {
        holder: { select: { id: true, canonicalName: true, tribeId: true } },
        security: { select: { ticker: true } },
        source: { select: { periodYear: true, periodQuarter: true } },
      },
      take: 1000,
    }),
  );

  if (!rows.length) {
    return { holders: [] as HolderRow[] };
  }

  // Find each holder's filing timeline across ALL holdings.
  // Sold-out rows should point to the first filing quarter after the last held quarter,
  // not the holder's latest quarter in the database.
  const holderIds = [...new Set(rows.map((r) => r.holder.id))];
  const holderQuarterMap = new Map<string, Array<{ asOfDate: Date; year: number; quarter: number }>>();
  if (holderIds.length) {
    const holderQuarters = await Promise.all(
      holderIds.map(async (id) => {
        const filings = await db.extSource.findMany({
          where: { filerEntityId: id, kind: "13f" },
          orderBy: [{ periodYear: "asc" }, { periodQuarter: "asc" }],
          select: { periodYear: true, periodQuarter: true, ts: true },
        });
        return {
          id,
          quarters: filings
            .filter((f) => f.periodYear != null && f.periodQuarter != null)
            .map((f) => ({
              asOfDate: f.ts ?? new Date(Date.UTC(f.periodYear!, (f.periodQuarter! - 1) * 3 + 2, 31)),
              year: f.periodYear!,
              quarter: f.periodQuarter!,
            })),
        };
      }),
    );
    for (const item of holderQuarters) {
      holderQuarterMap.set(item.id, item.quarters);
    }
  }

  // Group by (holder, ticker). The same ticker can have multiple Security rows from historical imports;
  // company pages should show one row per master × ticker, not one row per internal security profile.
  const rowTicker = (r: (typeof rows)[number]) =>
    normalizeTicker(r.security?.ticker) ?? securityScope.fallbackTicker;
  const pairKey = (r: (typeof rows)[number]) => `${r.holder.id}|${rowTicker(r)}`;

  const pairs = new Map<
    string,
    {
      holderId: string;
      holderName: string;
      tribeId: string | null;
      securityId: string;
      ticker: string | null;
      current: {
        asOfDate: Date;
        percent: number | null;
        valueUsd: bigint | null;
        shares: bigint | null;
        sourceYear: number | null;
        sourceQuarter: number | null;
        isSoldOut: boolean;
      } | null;
      previous: {
        asOfDate: Date;
        shares: bigint | null;
      } | null;
    }
  >();

  for (const row of rows) {
    const key = pairKey(row);
    const existing = pairs.get(key);
    if (!existing) {
      pairs.set(key, {
        holderId: row.holder.id,
        holderName: row.holder.canonicalName,
        tribeId: row.holder.tribeId,
        securityId: row.securityId!,
        ticker: rowTicker(row),
        current: {
          asOfDate: row.asOfDate,
          percent: row.percentOfPortfolio,
          valueUsd: row.valueUsd,
          shares: row.shares,
          sourceYear: row.source.periodYear,
          sourceQuarter: row.source.periodQuarter,
          isSoldOut: row.isSoldOut ?? false,
        },
        previous: null,
      });
      continue;
    }
    // Only track the nearest prior quarter. Skip duplicate rows for the same quarter/ticker.
    if (!existing.previous && row.asOfDate.getTime() !== existing.current?.asOfDate.getTime()) {
      existing.previous = {
        asOfDate: row.asOfDate,
        shares: row.shares,
      };
    }
  }

  // Build result: one row per (holder, security) pair
  const holders: HolderRow[] = [];

  for (const [, p] of pairs) {
    if (!p.current) continue;

    const current = p.current;

    // Only compare with the immediately previous 13F filing. If a holder owned the
    // same stock years ago, then exited, then bought again, that latest row should
    // be treated as a new position instead of a reduction from the old holding.
    const holderQuarters = holderQuarterMap.get(p.holderId) ?? [];
    const previousFilingQuarter = [...holderQuarters]
      .reverse()
      .find((q) => q.asOfDate.getTime() < current.asOfDate.getTime()) ?? null;
    const comparablePrevious =
      previousFilingQuarter && p.previous?.asOfDate.getTime() === previousFilingQuarter.asOfDate.getTime()
        ? p.previous
        : null;
    const shareDeltaPct = computeShareDeltaPct(comparablePrevious?.shares, current.shares);

    // A holder sold out if their next 13F filing after the last held quarter no longer includes this security.
    const soldOutQuarter = holderQuarters.find(
      (q) => q.asOfDate.getTime() > current.asOfDate.getTime(),
    ) ?? null;
    const isSoldOutByQuarter = soldOutQuarter !== null;

    let activity: HolderRow["activity"];
    if (current.isSoldOut || isSoldOutByQuarter) {
      activity = "SoldOut";
    } else {
      activity = computeHoldingActivity(
        Boolean(previousFilingQuarter),
        Boolean(comparablePrevious),
        shareDeltaPct,
      ) as HolderRow["activity"];
    }

    holders.push({
      id: p.holderId,
      holderName: p.holderName,
      tribeId: p.tribeId,
      ticker: p.ticker,
      securityName: p.ticker ?? "",
      percent: current.percent,
      valueUsd: current.valueUsd,
      shares: current.shares,
      sourceYear: isSoldOutByQuarter ? soldOutQuarter.year : current.sourceYear,
      sourceQuarter: isSoldOutByQuarter ? soldOutQuarter.quarter : current.sourceQuarter,
      positionYear: isSoldOutByQuarter ? current.sourceYear : null,
      positionQuarter: isSoldOutByQuarter ? current.sourceQuarter : null,
      asOfDate: isSoldOutByQuarter ? soldOutQuarter.asOfDate : current.asOfDate,
      activity,
      shareDeltaPct,
      isSoldOut: current.isSoldOut || isSoldOutByQuarter,
    });
  }

  // Sort: tribe order (buffett → lilu → duan), then by value desc
  const tribeOrder: Record<string, number> = { buffett: 0, lilu: 1, duan: 2 };
  holders.sort((a, b) => {
    const ao = tribeOrder[a.tribeId ?? ""] ?? 3;
    const bo = tribeOrder[b.tribeId ?? ""] ?? 3;
    if (ao !== bo) return ao - bo;
    return Number(b.valueUsd ?? BigInt(0)) - Number(a.valueUsd ?? BigInt(0));
  });

  return { holders: holders.slice(0, limit) };
}

export function formatMoney(v: string | bigint | null) {
  return formatUsdInYi(v);
}

export async function getCompanyAnalysis(entityId: string) {
  const row = await db.companyAnalysis.findUnique({
    where: { entityId },
    select: { narrative: true, moat: true, source: true, version: true },
  });
  return row ?? null;
}

export async function getGeneratedArtifact(entityId: string, artifactType: string) {
  const row = await db.generatedContentVersion.findFirst({
    where: { scopeType: "entity", scopeId: entityId, artifactType },
    orderBy: { versionSeq: "desc" },
    select: { payload: true, generatedAt: true, source: true, versionSeq: true },
  });
  return row ?? null;
}

export type CompanyReferenceFiling = {
  id: string;
  kind: string;
  url: string | null;
  ts: Date | null;
  filedAt: Date | null;
  periodYear: number | null;
  periodQuarter: number | null;
  metadata: Prisma.JsonValue;
  attachments: Array<{
    sequence: string;
    description: string;
    documentType: string;
    documentName: string;
    url: string;
  }>;
  artifacts: Array<{
    kind: string;
    objectKey: string;
    contentType: string;
    sizeBytes: bigint;
    originalName: string | null;
    sourceUrl: string | null;
    publicUrl: string | null;
  }>;
};

// Defense-in-depth: ExtSource now has a unique index on (filerEntityId, accessionNumber),
// so the database itself rejects duplicate ingest. This frontend dedup is kept as a safety net
// in case some legacy row slips through with a NULL accessionNumber, or future schema work
// temporarily drops the constraint. Pair with scripts/dedupe-ext-source-filings.ts for a
// one-shot cleanup if duplicates ever reappear.
//
// Same SEC filing can appear multiple times in ext_source: legacy importers
// wrote `kind=10k` for foreign filers that are actually 20-F, and there is no
// unique constraint on (filerEntityId, accessionNumber) yet. Collapse rows by
// accessionNumber (falling back to period+filedAt+url when accession is missing)
// and prefer the row whose kind matches the metadata.form (20f > 40f > 10k by
// default, since 10k is the legacy fallback). Merge attachments/artifacts so
// we don't lose files attached to the duplicate row.
function dedupeReferenceFilings(rows: CompanyReferenceFiling[]): CompanyReferenceFiling[] {
  const kindRank: Record<string, number> = { "20f": 0, "40f": 1, "10k": 2 };
  const dedupKey = (row: CompanyReferenceFiling) => {
    const meta = (row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {}) as Record<string, unknown>;
    const accession =
      (typeof meta.accessionNumber === "string" && meta.accessionNumber) ||
      (typeof meta.accession === "string" && meta.accession) ||
      null;
    if (accession) return `acc:${accession}`;
    const period = `${row.periodYear ?? ""}-${row.periodQuarter ?? ""}`;
    const filed = row.filedAt?.toISOString() ?? row.ts?.toISOString() ?? "";
    return `fb:${period}|${filed}|${row.url ?? ""}`;
  };

  const preferredKindFromMeta = (row: CompanyReferenceFiling) => {
    const meta = (row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {}) as Record<string, unknown>;
    const form = typeof meta.form === "string" ? meta.form.trim().toLowerCase().replace(/[-/]/g, "") : "";
    if (form === "20f" || form === "40f" || form === "10k") return form;
    return null;
  };

  const groups = new Map<string, CompanyReferenceFiling[]>();
  for (const row of rows) {
    const key = dedupKey(row);
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  const dedupAttachments = (items: CompanyReferenceFiling["attachments"]) => {
    const seen = new Set<string>();
    const out: CompanyReferenceFiling["attachments"] = [];
    for (const a of items) {
      const k = `${a.sequence}|${a.documentName}|${a.url}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(a);
    }
    return out;
  };
  const dedupArtifacts = (items: CompanyReferenceFiling["artifacts"]) => {
    const seen = new Set<string>();
    const out: CompanyReferenceFiling["artifacts"] = [];
    for (const a of items) {
      const k = `${a.kind}|${a.objectKey}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(a);
    }
    return out;
  };

  const merged: CompanyReferenceFiling[] = [];
  for (const bucket of groups.values()) {
    const sorted = [...bucket].sort((a, b) => {
      const aPreferred = preferredKindFromMeta(a);
      const bPreferred = preferredKindFromMeta(b);
      const aMatches = aPreferred && a.kind === aPreferred ? 0 : 1;
      const bMatches = bPreferred && b.kind === bPreferred ? 0 : 1;
      if (aMatches !== bMatches) return aMatches - bMatches;
      const aRank = kindRank[a.kind] ?? 99;
      const bRank = kindRank[b.kind] ?? 99;
      if (aRank !== bRank) return aRank - bRank;
      // Tie-breaker: more attachments/artifacts wins, then most recent createdAt-ish proxy (id desc).
      const aFiles = a.attachments.length + a.artifacts.length;
      const bFiles = b.attachments.length + b.artifacts.length;
      if (aFiles !== bFiles) return bFiles - aFiles;
      return b.id.localeCompare(a.id);
    });
    const winner = sorted[0];
    const allAttachments = sorted.flatMap((r) => r.attachments);
    const allArtifacts = sorted.flatMap((r) => r.artifacts);
    merged.push({
      ...winner,
      attachments: dedupAttachments(allAttachments),
      artifacts: dedupArtifacts(allArtifacts),
    });
  }

  merged.sort((a, b) => {
    const ay = a.periodYear ?? -Infinity;
    const by = b.periodYear ?? -Infinity;
    if (ay !== by) return by - ay;
    const aq = a.periodQuarter ?? -Infinity;
    const bq = b.periodQuarter ?? -Infinity;
    if (aq !== bq) return bq - aq;
    const at = (a.filedAt ?? a.ts)?.getTime() ?? 0;
    const bt = (b.filedAt ?? b.ts)?.getTime() ?? 0;
    return bt - at;
  });

  return merged;
}

export async function getCompanyReferenceFilings(entityId: string, limit = 12): Promise<CompanyReferenceFiling[]> {
  try {
    // Fetch more than `limit` because we deduplicate below — the same filing
    // (same accessionNumber) can have multiple rows with different `kind`
    // (legacy import wrote 10k for foreign filers that are actually 20-F).
    const rows = await retryOnce(async () =>
      db.extSource.findMany({
        where: {
          filerEntityId: entityId,
          kind: { in: ["10k", "20f", "40f"] },
        },
        orderBy: [{ periodYear: "desc" }, { periodQuarter: "desc" }, { ts: "desc" }],
        take: limit * 4,
        select: {
          id: true,
          kind: true,
          url: true,
          ts: true,
          filedAt: true,
          periodYear: true,
          periodQuarter: true,
          metadata: true,
          attachments: {
            select: {
              sequence: true,
              description: true,
              documentType: true,
              documentName: true,
              url: true,
            },
            orderBy: [{ sequence: "asc" }],
          },
          artifacts: {
            select: {
              kind: true,
              objectKey: true,
              contentType: true,
              sizeBytes: true,
              originalName: true,
              sourceUrl: true,
              publicUrl: true,
            },
            orderBy: [{ kind: "asc" }, { createdAt: "asc" }],
          },
        },
      }),
    );
    return dedupeReferenceFilings(rows as CompanyReferenceFiling[]).slice(0, limit);
  } catch (err) {
    logDbFallback("getCompanyReferenceFilings", err);
    return [];
  }
}

export async function getBusinessCanvas(entityId: string) {
  const row = await db.businessCanvas.findUnique({
    where: { entityId },
    select: { canvas: true, versionSeq: true, generatedAt: true },
  });
  if (!row) return null;

  return {
    canvas: row.canvas as BusinessCanvasData,
    versionSeq: row.versionSeq,
    generatedAt: row.generatedAt,
  };
}

export type CompanyAnnualFilingOutlineNode = {
  title: string;
  level: number;
  anchor: string | null;
  children: CompanyAnnualFilingOutlineNode[];
};

export type CompanyAnnualFilingBlock =
  | {
      id: string;
      type: "heading";
      text: string;
      level: number;
      sourceTag: string;
      html?: string;
    }
  | {
      id: string;
      type: "paragraph";
      text: string;
      html?: string;
    }
  | {
      id: string;
      type: "list";
      ordered: boolean;
      items: string[];
      text: string;
      html?: string;
    }
  | {
      id: string;
      type: "table";
      caption: string | null;
      headers: string[];
      rows: string[][];
      text: string;
      html?: string;
    }
  | {
      id: string;
      type: "image";
      src: string;
      alt: string | null;
      caption: string | null;
      text: string;
      html?: string;
    }
  | {
      id: string;
      type: "note";
      text: string;
      html?: string;
    };

export type CompanyAnnualFilingArtifact = {
  kind: string;
  objectKey: string;
  contentType: string;
  sizeBytes: bigint;
  originalName: string | null;
  sourceUrl: string | null;
  publicUrl: string | null;
};

export type CompanyAnnualFiling = {
  id: string;
  kind: string;
  periodYear: number | null;
  periodQuarter: number | null;
  ts: Date | null;
  filedAt: Date | null;
  url: string | null;
  metadata: Prisma.JsonValue | null;
  attachments: Array<{
    sequence: string;
    description: string;
    documentType: string;
    documentName: string;
    url: string;
  }>;
  artifacts: CompanyAnnualFilingArtifact[];
};

const COMPANY_ANNUAL_FILING_SELECT = {
  id: true,
  kind: true,
  url: true,
  ts: true,
  filedAt: true,
  periodYear: true,
  periodQuarter: true,
  metadata: true,
  attachments: {
    select: {
      sequence: true,
      description: true,
      documentType: true,
      documentName: true,
      url: true,
    },
    orderBy: [{ sequence: "asc" }],
  },
  artifacts: {
    select: {
      kind: true,
      objectKey: true,
      contentType: true,
      sizeBytes: true,
      originalName: true,
      sourceUrl: true,
      publicUrl: true,
    },
    orderBy: [{ kind: "asc" }, { createdAt: "asc" }],
  },
} satisfies Prisma.ExtSourceSelect;

export async function getCompanyAnnualFilings(entityId: string, limit = 12) {
  try {
    const rows = await db.extSource.findMany({
      where: {
        filerEntityId: entityId,
        kind: { in: ["10k", "20f", "40f"] },
      },
      orderBy: [{ periodYear: "desc" }, { periodQuarter: "desc" }, { ts: "desc" }],
      take: limit,
      select: COMPANY_ANNUAL_FILING_SELECT,
    });

    return rows as CompanyAnnualFiling[];
  } catch (err) {
    logDbFallback("getCompanyAnnualFilings", err);
    return [];
  }
}

function isAmendedAnnualFiling(filing: CompanyAnnualFiling) {
  const meta = filing.metadata && typeof filing.metadata === "object" && !Array.isArray(filing.metadata)
    ? (filing.metadata as Record<string, unknown>)
    : {};
  const form = typeof meta.form === "string" ? meta.form.trim().toUpperCase() : "";
  return form.endsWith("/A");
}

function pickPreferredAnnualFiling(rows: CompanyAnnualFiling[]) {
  if (!rows.length) return null;
  const fullReport = rows.find((row) => !isAmendedAnnualFiling(row));
  return fullReport ?? rows[0];
}

export async function getCompanyAnnualFiling(entityId: string, year?: number | null) {
  try {
    return await retryOnce(async () => {
      if (year != null && !Number.isNaN(year)) {
        const filings = await db.extSource.findMany({
          where: {
            filerEntityId: entityId,
            kind: { in: ["10k", "20f", "40f"] },
            periodYear: year,
          },
          orderBy: [{ periodQuarter: "desc" }, { ts: "desc" }, { filedAt: "asc" }],
          select: COMPANY_ANNUAL_FILING_SELECT,
        });
        const filing = pickPreferredAnnualFiling(filings as CompanyAnnualFiling[]);
        if (filing) return filing as CompanyAnnualFiling;
      }

      const latestRows = await db.extSource.findMany({
        where: {
          filerEntityId: entityId,
          kind: { in: ["10k", "20f", "40f"] },
        },
        orderBy: [{ periodYear: "desc" }, { periodQuarter: "desc" }, { ts: "desc" }],
        take: 8,
        select: COMPANY_ANNUAL_FILING_SELECT,
      });
      const latestYear = latestRows[0]?.periodYear ?? null;
      const latest = pickPreferredAnnualFiling(
        (latestYear == null ? latestRows : latestRows.filter((row) => row.periodYear === latestYear)) as CompanyAnnualFiling[],
      );

      return (latest as CompanyAnnualFiling | null) ?? null;
    });
  } catch (err) {
    logDbFallback("getCompanyAnnualFiling", err);
    return null;
  }
}
