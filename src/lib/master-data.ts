import db from "@/lib/prisma";
import { formatUsdInYi } from "@/lib/currency";

export type QuarterPoint = {
  year: number;
  quarter: number;
};

function logDbFallback(scope: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  // Keep DB fallback silent by default to avoid noisy runtime console errors in UI/dev overlay.
  if (process.env.DEBUG_DB_FALLBACK === "1") {
    console.warn(`[master-data:${scope}] DB query failed, fallback to empty result: ${message}`);
  }
}

export async function getAvailableQuarters(tribeId: string): Promise<QuarterPoint[]> {
  try {
    const sources = await db.extSource.findMany({
      where: { filer: { is: { tribeId } }, kind: "13f" },
      select: { periodYear: true, periodQuarter: true },
      orderBy: [{ periodYear: "desc" }, { periodQuarter: "desc" }],
    });

    const seen = new Set<string>();
    const uniq: QuarterPoint[] = [];
    for (const s of sources) {
      if (s.periodYear == null || s.periodQuarter == null) continue;
      const key = `${s.periodYear}-${s.periodQuarter}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniq.push({ year: s.periodYear, quarter: s.periodQuarter });
      }
    }
    return uniq;
  } catch (err) {
    logDbFallback("getAvailableQuarters", err);
    return [];
  }
}

export async function getHoldingsByQuarter(tribeId: string, year: number, quarter: number) {
  try {
    const rows = await db.holding.findMany({
      where: {
        holder: { tribeId },
        source: { is: { periodYear: year, periodQuarter: quarter, kind: "13f" } },
      },
      include: {
        security: {
          include: {
            company: {
              include: {
                securitiesAsCompany: {
                  select: { ticker: true },
                },
              },
            },
          },
        },
      },
      orderBy: { percentOfPortfolio: "desc" },
    });
    const normalized = rows;

    // Defensive dedupe: historical imports may contain duplicates that share the same security profile.
    const deduped = new Map<string, typeof normalized[number]>();
    for (const row of normalized) {
      const key = row.securityId!;
      const prev = deduped.get(key);
      if (!prev) {
        deduped.set(key, row);
        continue;
      }
      const prevValue = prev.valueUsd ?? BigInt(0);
      const currValue = row.valueUsd ?? BigInt(0);
      if (currValue >= prevValue) deduped.set(key, row);
    }
    return [...deduped.values()];
  } catch (err) {
    logDbFallback("getHoldingsByQuarter", err);
    return [];
  }
}

export async function getLatestHoldings(tribeId: string, limit = 10) {
  const quarters = await getAvailableQuarters(tribeId);
  if (!quarters.length) {
    return { latest: null, holdings: [] as Awaited<ReturnType<typeof getHoldingsByQuarter>> };
  }

  const latest = quarters[0];
  const holdings = await getHoldingsByQuarter(tribeId, latest.year, latest.quarter);
  return { latest, holdings: holdings.slice(0, limit) };
}

export async function getLetterYearsByType() {
  try {
    const rows = await db.source.findMany({
      select: { year: true, type: true },
      orderBy: [{ year: "desc" }, { type: "asc" }],
    });

    const byType = new Map<string, Set<number>>();
    for (const row of rows) {
      if (!byType.has(row.type)) byType.set(row.type, new Set());
      byType.get(row.type)!.add(row.year);
    }

    return byType;
  } catch (err) {
    logDbFallback("getLetterYearsByType", err);
    return new Map<string, Set<number>>();
  }
}

export async function getLetterListForPerson(personId: string) {
  if (personId !== "buffett") return [];

  const byType = await getLetterYearsByType();
  const labelByType: Record<string, string> = {
    shareholder: "致股东信",
    partnership: "合伙人信",
    annual_meeting: "股东大会",
  };

  const validTypes = ["shareholder", "partnership", "annual_meeting"];
  const list: Array<{ type: string; typeLabel: string; year: number; href: string }> = [];

  for (const type of validTypes) {
    const years = Array.from(byType.get(type) ?? []).sort((a, b) => b - a);
    for (const year of years) {
      list.push({
        type,
        typeLabel: labelByType[type] ?? type,
        year,
        href: `/letters/${type}/${year}`,
      });
    }
  }

  return list.sort((a, b) => b.year - a.year);
}

export type MasterClassItem = {
  key: string;
  label: string;
  count: number;
  range: string;
  latest: number | null;
  href: string;
};

export async function getMasterClassSummary(personId: string): Promise<MasterClassItem[]> {
  const presets: Record<string, Array<{ key: string; label: string; href: string; sourceType?: string }>> = {
    buffett: [
      { key: "shareholder", label: "致股东信", href: `/master/${personId}/library?type=shareholder`, sourceType: "shareholder" },
      { key: "partnership", label: "合伙人信", href: `/master/${personId}/library?type=partnership`, sourceType: "partnership" },
      { key: "annual_meeting", label: "股东大会", href: `/master/${personId}/library?type=annual_meeting`, sourceType: "annual_meeting" },
      { key: "article", label: "文章（建设中）", href: `/master/${personId}`, sourceType: undefined },
      { key: "video", label: "视频（建设中）", href: `/master/${personId}`, sourceType: undefined },
    ],
    lilu: [
      { key: "speech", label: "演讲（建设中）", href: `/master/${personId}` },
      { key: "article", label: "文章（建设中）", href: `/master/${personId}` },
      { key: "video", label: "视频（建设中）", href: `/master/${personId}` },
    ],
    duan: [
      { key: "post", label: "公开言论（建设中）", href: `/master/${personId}` },
      { key: "article", label: "文章（建设中）", href: `/master/${personId}` },
      { key: "video", label: "视频（建设中）", href: `/master/${personId}` },
    ],
  };

  const config = presets[personId] ?? [];
  if (personId !== "buffett") {
    return config.map((c) => ({
      key: c.key,
      label: c.label,
      count: 0,
      range: "—",
      latest: null,
      href: c.href,
    }));
  }

  const byType = await getLetterYearsByType();
  return config.map((c) => {
    if (!c.sourceType) {
      return { key: c.key, label: c.label, count: 0, range: "—", latest: null, href: c.href };
    }
    const years = Array.from(byType.get(c.sourceType) ?? []).sort((a, b) => a - b);
    const count = years.length;
    const latest = count ? years[count - 1] : null;
    const range = count ? `${years[0]}-${years[count - 1]}` : "—";
    return { key: c.key, label: c.label, count, range, latest, href: c.href };
  });
}

type HoldingRow = Awaited<ReturnType<typeof getHoldingsByQuarter>>[number];

export type HoldingChangeSet = {
  latest: QuarterPoint | null;
  base: QuarterPoint | null;
  top: HoldingRow[];
  adds: Array<{ row: HoldingRow; delta: number }>;
  trims: Array<{ row: HoldingRow; delta: number }>;
  newPositions: HoldingRow[];
  exits: Array<{ securityId: string; ticker: string | null; name: string; prevPct: number }>;
};

export async function getLatestHoldingChangeSet(tribeId: string): Promise<HoldingChangeSet> {
  const quarters = await getAvailableQuarters(tribeId);
  if (!quarters.length) {
    return {
      latest: null,
      base: null,
      top: [],
      adds: [],
      trims: [],
      newPositions: [],
      exits: [],
    };
  }

  const latest = quarters[0];
  const base = quarters[1] ?? null;
  const latestRows = await getHoldingsByQuarter(tribeId, latest.year, latest.quarter);
  const baseRows = base ? await getHoldingsByQuarter(tribeId, base.year, base.quarter) : [];

  const top = latestRows.slice(0, 10);
  const keyOf = (r: HoldingRow) => r.securityId;
  const baseById = new Map(baseRows.map((r) => [keyOf(r), r] as const));
  const latestById = new Map(latestRows.map((r) => [keyOf(r), r] as const));

  const adds: Array<{ row: HoldingRow; delta: number }> = [];
  const trims: Array<{ row: HoldingRow; delta: number }> = [];
  const newPositions: HoldingRow[] = [];
  for (const row of latestRows) {
    const prev = baseById.get(keyOf(row));
    const nowPct = row.percentOfPortfolio ?? 0;
    const prevPct = prev?.percentOfPortfolio ?? 0;
    const delta = nowPct - prevPct;

    if (!prev) {
      newPositions.push(row);
      continue;
    }
    if (delta > 0.08) adds.push({ row, delta });
    if (delta < -0.08) trims.push({ row, delta });
  }

  const exits = baseRows
    .filter((r) => !latestById.has(keyOf(r)))
    .map((r) => ({
      securityId: r.securityId!,
      ticker: r.security.ticker,
      name: r.security.company?.canonicalName ?? r.security.ticker ?? "",
      prevPct: r.percentOfPortfolio ?? 0,
    }))
    .sort((a, b) => b.prevPct - a.prevPct);

  adds.sort((a, b) => b.delta - a.delta);
  trims.sort((a, b) => a.delta - b.delta);
  newPositions.sort((a, b) => (b.percentOfPortfolio ?? 0) - (a.percentOfPortfolio ?? 0));

  return {
    latest,
    base,
    top,
    adds: adds.slice(0, 5),
    trims: trims.slice(0, 5),
    newPositions: newPositions.slice(0, 5),
    exits: exits.slice(0, 5),
  };
}

export type PortfolioInsightItem = {
  kind: "summary" | "new" | "add" | "trim" | "exit";
  label: string;
  detail: string;
  ticker?: string;
  nameZh?: string;
  deltaPct?: number;
  percentOfPortfolio?: number;
  top5Pct?: number;
  holdingCount?: number;
  totalChanged?: number;
};

export type PortfolioInsightStructured = {
  latest: QuarterPoint;
  base: QuarterPoint | null;
  summary: {
    holdingCount: number;
    top5Pct: number;
    totalChanged: number;
    newCount: number;
    addCount: number;
    trimCount: number;
    exitCount: number;
  };
  items: PortfolioInsightItem[];
};

export function buildHoldingInsights(changeSet: HoldingChangeSet): PortfolioInsightItem[] {
  if (!changeSet.latest || !changeSet.top.length) return [];
  const nowCount = changeSet.top.length >= 10 ? changeSet.top.length : null;
  const totalChanged =
    changeSet.newPositions.length + changeSet.adds.length + changeSet.trims.length + changeSet.exits.length;
  const top5 = changeSet.top.slice(0, 5).reduce((sum, h) => sum + (h.percentOfPortfolio ?? 0), 0);

  const items: PortfolioInsightItem[] = [
    {
      kind: "summary",
      label: "组合概况",
      detail: `前五大持仓合计 ${top5.toFixed(2)}%，组合集中度${top5 >= 60 ? "较高" : "中等"}${totalChanged > 0 ? `，本季${totalChanged}笔变动` : ""}`,
      top5Pct: top5,
      holdingCount: nowCount ?? undefined,
      totalChanged,
    },
  ];

  for (const pos of changeSet.newPositions.slice(0, 4)) {
    const ticker = pos.security.ticker ?? pos.security.company?.canonicalName ?? "";
    items.push({
      kind: "new",
      label: "新进",
      detail: `${ticker} 仓位 ${(pos.percentOfPortfolio ?? 0).toFixed(2)}%`,
      ticker,
      nameZh: pos.security.company?.canonicalName ?? pos.security.ticker ?? "",
      percentOfPortfolio: pos.percentOfPortfolio ?? 0,
    });
  }

  for (const { row, delta } of changeSet.adds.slice(0, 4)) {
    const ticker = row.security.ticker ?? row.security.company?.canonicalName ?? "";
    items.push({
      kind: "add",
      label: "增持",
      detail: `${ticker} +${delta.toFixed(2)}pp → ${(row.percentOfPortfolio ?? 0).toFixed(2)}%`,
      ticker,
      nameZh: row.security.company?.canonicalName ?? row.security.ticker ?? "",
      deltaPct: delta,
      percentOfPortfolio: row.percentOfPortfolio ?? 0,
    });
  }

  for (const { row, delta } of changeSet.trims.slice(0, 4)) {
    const ticker = row.security.ticker ?? row.security.company?.canonicalName ?? "";
    items.push({
      kind: "trim",
      label: "减持",
      detail: `${ticker} ${delta.toFixed(2)}pp → ${(row.percentOfPortfolio ?? 0).toFixed(2)}%`,
      ticker,
      nameZh: row.security.company?.canonicalName ?? row.security.ticker ?? "",
      deltaPct: delta,
      percentOfPortfolio: row.percentOfPortfolio ?? 0,
    });
  }

  for (const exit of changeSet.exits.slice(0, 4)) {
    const ticker = exit.ticker ?? exit.name;
    items.push({
      kind: "exit",
      label: "清仓",
      detail: `${ticker} 上季仓位 ${exit.prevPct.toFixed(2)}%`,
      ticker,
      nameZh: exit.name,
      percentOfPortfolio: exit.prevPct,
    });
  }

  return items;
}

export function buildStructuredPortfolioInsight(
  changeSet: HoldingChangeSet,
): PortfolioInsightStructured | null {
  if (!changeSet.latest || !changeSet.top.length) return null;

  const items = buildHoldingInsights(changeSet);
  return {
    latest: changeSet.latest,
    base: changeSet.base,
    summary: {
      holdingCount: changeSet.top.length,
      top5Pct: changeSet.top.slice(0, 5).reduce((sum, h) => sum + (h.percentOfPortfolio ?? 0), 0),
      totalChanged:
        changeSet.newPositions.length +
        changeSet.adds.length +
        changeSet.trims.length +
        changeSet.exits.length,
      newCount: changeSet.newPositions.length,
      addCount: changeSet.adds.length,
      trimCount: changeSet.trims.length,
      exitCount: changeSet.exits.length,
    },
    items,
  };
}

export function formatValueUsd(valueUsd: bigint | null): string {
  return formatUsdInYi(valueUsd);
}

export function formatShares(shares: bigint | null): string {
  if (shares == null) return "—";
  return Number(shares).toLocaleString("en-US");
}

export async function getPortfolioInsight(
  masterId: string,
  year: number,
  quarter: number,
): Promise<string | null> {
  const row = await getPortfolioInsightRecord(masterId, year, quarter);
  return row?.narrative ?? null;
}

export async function getPortfolioInsightRecord(
  masterId: string,
  year: number,
  quarter: number,
): Promise<{
  narrative: string;
  structured: PortfolioInsightStructured | null;
  source: string;
  version: number;
  generatedAt: Date;
} | null> {
  try {
    const row = await db.portfolioInsight.findUnique({
      where: { masterId_year_quarter: { masterId, year, quarter } },
    });
    if (!row) return null;
    return {
      narrative: row.narrative,
      structured: (row.structured as PortfolioInsightStructured | null) ?? null,
      source: row.source,
      version: row.version,
      generatedAt: row.generatedAt,
    };
  } catch {
    return null;
  }
}
