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

  const byYear = new Map<number, Record<string, string>>();
  for (const row of rows) {
    const year = row.periodEnd.getUTCFullYear();
    if (!byYear.has(year)) byYear.set(year, {});
    const bucket = byYear.get(year)!;
    if (!(row.lineItem in bucket) && row.value != null) {
      bucket[row.lineItem] = row.value.toString();
    }
  }

  return [...byYear.entries()]
    .sort((a, b) => b[0] - a[0])
    .slice(0, limit)
    .map(([year, items]) => ({ year, items }));
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
      { securityId: "asc" },
      { asOfDate: "desc" },
    ],
    include: {
      holder: { select: { id: true, canonicalName: true, tribeId: true } },
      securityProfile: { select: { ticker: true } },
      source: { select: { periodYear: true, periodQuarter: true } },
    },
    take: 1000,
  });

  if (!rows.length) {
    return { holders: [] as HolderRow[] };
  }

  // Find each holder's latest filing quarter across ALL holdings
  const holderIds = [...new Set(rows.map((r) => r.holder.id))];
  const holderLatestMap = new Map<string, { asOfDate: Date; year: number; quarter: number }>();
  if (holderIds.length) {
    // Get latest asOfDate + source period for each holder
    const holderLatestHoldings = await Promise.all(
      holderIds.map((id) =>
        db.holding.findFirst({
          where: { holderEntityId: id },
          orderBy: { asOfDate: "desc" },
          select: {
            holderEntityId: true,
            asOfDate: true,
            source: { select: { periodYear: true, periodQuarter: true } },
          },
        }),
      ),
    );
    for (const h of holderLatestHoldings) {
      if (h && h.asOfDate) {
        holderLatestMap.set(h.holderEntityId, {
          asOfDate: h.asOfDate,
          year: h.source.periodYear ?? 0,
          quarter: h.source.periodQuarter ?? 0,
        });
      }
    }
  }

  // Group by (holder, security) — no aggregation across securities
  const pairKey = (r: (typeof rows)[number]) => `${r.holder.id}|${r.securityId}`;

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
        ticker: row.securityProfile?.ticker ?? null,
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
    // Only track the two most recent quarters
    if (!existing.previous) {
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

    const shareDeltaPct = computeShareDeltaPct(p.previous?.shares, p.current.shares);

    // A holder sold out if they filed a newer quarter without this security
    const holderLatest = holderLatestMap.get(p.holderId);
    const isSoldOutByQuarter =
      !!holderLatest && p.current.asOfDate.getTime() < holderLatest.asOfDate.getTime();

    let activity: HolderRow["activity"];
    if (p.current.isSoldOut || isSoldOutByQuarter) {
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
      percent: p.current.percent,
      valueUsd: p.current.valueUsd,
      shares: p.current.shares,
      sourceYear: isSoldOutByQuarter ? holderLatest?.year ?? p.current.sourceYear : p.current.sourceYear,
      sourceQuarter: isSoldOutByQuarter ? holderLatest?.quarter ?? p.current.sourceQuarter : p.current.sourceQuarter,
      asOfDate: isSoldOutByQuarter ? holderLatest?.asOfDate ?? p.current.asOfDate : p.current.asOfDate,
      activity,
      shareDeltaPct,
      isSoldOut: p.current.isSoldOut || isSoldOutByQuarter,
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
