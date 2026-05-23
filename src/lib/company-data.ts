import db from "@/lib/prisma";
import { formatUsdInYi } from "@/lib/currency";
import { computeHoldingActivity, computeShareDeltaPct } from "@/lib/holding-activity";
import { normalizeTicker } from "@/lib/ticker";
import { Prisma } from "@prisma/client";

export async function getCompanyByCik(cikRaw: string) {
  const cik = String(Number(cikRaw.replace(/\D/g, "")));
  if (!cik || cik === "0" || Number.isNaN(Number(cik))) return null;

  const entity = await db.entity.findUnique({
    where: { cik },
    select: {
      id: true,
      type: true,
      canonicalName: true,
      ticker: true,
      cik: true,
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
      type: { in: ["company", "master"] },
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
          holdingsAsSecurity: true,
        },
      },
    },
  });

  if (rows.length === 0) {
    // Fallback: resolve via security ticker (e.g. GOOG/GOOGL share classes).
    const security = await db.security.findFirst({
      where: { ticker: { equals: normalizedTicker, mode: "insensitive" } },
      select: { companyEntityId: true, entityId: true },
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
      (x.type === "master" ? 120 : 0) +
      (x.cik ? 100 : 0) +
      (x._count.financials > 0 ? 50 : 0) +
      (x._count.holdingsAsSecurity > 0 ? 30 : 0);
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

export async function getCompanyByIdentifier(identifier: string) {
  const byCik = await getCompanyByCik(identifier);
  if (byCik) return byCik;
  return getCompanyByTicker(identifier);
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
      isPrimary: true,
    },
    orderBy: [{ isPrimary: "desc" }, { ticker: "asc" }],
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
      type: { in: ["company", "master"] },
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
      const score = (x: (typeof siblings)[number]) =>
        (x.type === "master" ? 120 : 0) + (x.cik ? 100 : 0);
      return score(b) - score(a);
    })
    .map((s) => s.id);
}

async function getSecurityIdsForCompany(entityId: string) {
  const base = await db.entity.findUnique({
    where: { id: entityId },
    select: { id: true, ticker: true, canonicalName: true },
  });
  if (!base) return { profileIds: [] as string[], legacyEntityIds: [entityId] };

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
    select: { id: true, entityId: true },
  });

  const profileIds = new Set<string>();
  const legacyEntityIds = new Set<string>(familyCompanyIds);
  for (const s of securityProfiles) {
    profileIds.add(s.id);
    legacyEntityIds.add(s.entityId);
  }
  return {
    profileIds: [...profileIds],
    legacyEntityIds: [...legacyEntityIds],
  };
}

export async function getCompanyFinancials(entityId: string, limit = 8) {
  const familyIds = await getEntityFamilyIds(entityId);
  const rows = await db.financial.findMany({
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
  });

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
  const rows = await db.holding.findMany({
    where: {
      OR: [
        { securityId: { in: securityScope.profileIds } },
        { securityEntityId: { in: securityScope.legacyEntityIds } },
      ],
    },
    orderBy: [
      { holderEntityId: "asc" },
      { asOfDate: "desc" },
      { securityId: "asc" },
    ],
    include: {
      holder: { select: { id: true, canonicalName: true, tribeId: true } },
      security: { select: { ticker: true } },
      securityProfile: { select: { ticker: true } },
      source: { select: { periodYear: true, periodQuarter: true } },
    },
    take: 1000,
  });

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
    normalizeTicker(r.securityProfile?.ticker ?? r.security.ticker) ?? r.securityId ?? r.securityEntityId;
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
        securityId: row.securityId ?? row.securityEntityId,
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
    const shareDeltaPct = computeShareDeltaPct(p.previous?.shares, current.shares);

    // A holder sold out if their next 13F filing after the last held quarter no longer includes this security.
    const holderQuarters = holderQuarterMap.get(p.holderId) ?? [];
    const soldOutQuarter = holderQuarters.find(
      (q) => q.asOfDate.getTime() > current.asOfDate.getTime(),
    ) ?? null;
    const isSoldOutByQuarter = soldOutQuarter !== null;

    let activity: HolderRow["activity"];
    if (current.isSoldOut || isSoldOutByQuarter) {
      activity = "SoldOut";
    } else if (!p.previous) {
      activity = "New";
    } else {
      activity = computeHoldingActivity(true, true, shareDeltaPct) as HolderRow["activity"];
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
