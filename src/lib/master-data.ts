import db from "@/lib/prisma";
import { formatUsdInYi } from "@/lib/currency";
import { formatCompanyUrl } from "@/lib/company-data";
import { getDocumentsForOwner } from "@/lib/documents";
import { computeHoldingActivity, computeShareDeltaPct, type HoldingActivity } from "@/lib/holding-activity";
import { isNonCompanySecurityKind } from "@/lib/security-kind";
import { BRAND_EN } from "@/lib/brand";

export type QuarterPoint = {
  year: number;
  quarter: number;
};

// Middle-of-quarter date (not quarter-end) — used purely as an x-axis anchor for the
// holdings-history chart, so each quarter's point sits centered in its own equal-width
// slice of the year rather than pinned to the right edge (quarter-end date).
const QUARTER_MID_MONTH_DAY: Record<number, [number, number]> = {
  1: [2, 15],
  2: [5, 15],
  3: [8, 15],
  4: [11, 15],
};

export function quarterMidDate(year: number, quarter: number): string {
  const [month, day] = QUARTER_MID_MONTH_DAY[quarter];
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

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

const BENEFICIAL_OWNERSHIP_KINDS = ["sc13d", "sc13d-a", "sc13g", "sc13g-a"] as const;

export type BeneficialOwnershipFiling = {
  id: string;
  kind: (typeof BENEFICIAL_OWNERSHIP_KINDS)[number];
  filedAt: Date | null;
  filingUrl: string | null;
  issuerName: string;
  issuerTicker: string | null;
  percentOfClass: number | null;
  sharesOwned: string | null; // BigInt serialized to string for client components
  isGroupFiling: boolean;
  // The filer's current 13F portfolio weight in this same issuer, if that
  // position shows up in their latest 13F at all (see cross-reference note below).
  currentPortfolioPct: number | null;
  issuer: {
    id: string;
    cik: string | null;
    market: string | null;
    code: string | null;
    canonicalName: string;
    nameZh: string | null;
  } | null;
};

// Event-triggered (not quarterly) beneficial-ownership disclosures — 13D/13D-A/13G/13G-A —
// distinct from the 13F portfolio snapshot above: these report % of the ISSUER's share
// class, not % of the filer's own portfolio. See BeneficialOwnership model comment.
//
// Cross-referenced against the filer's most recent 13F Holding for the same issuer
// (matched by companyEntityId) so the UI can show whether a disclosed stake still shows
// up in the current 13F at all — 13F only lists positions above SEC's reporting
// threshold, so a 13D/13G stake can legitimately disappear from it (different account,
// short position hedge, etc.), which is itself a useful signal to surface, not just a gap.
export async function getBeneficialOwnershipFilings(
  tribeId: string,
  limit?: number,
): Promise<BeneficialOwnershipFiling[]> {
  try {
    const sources = await db.extSource.findMany({
      where: { filer: { is: { tribeId } }, kind: { in: [...BENEFICIAL_OWNERSHIP_KINDS] } },
      select: {
        id: true,
        kind: true,
        filedAt: true,
        url: true,
        beneficialOwnership: {
          select: {
            issuerName: true,
            issuerTicker: true,
            percentOfClass: true,
            sharesOwned: true,
            isGroupFiling: true,
            issuer: {
              select: { id: true, cik: true, market: true, code: true, canonicalName: true, metadata: true },
            },
          },
        },
      },
      orderBy: { filedAt: "desc" },
      take: limit,
    });

    const filings = sources.filter(
      (s): s is typeof s & { beneficialOwnership: NonNullable<typeof s.beneficialOwnership> } =>
        s.beneficialOwnership != null,
    );

    const issuerEntityIds = [...new Set(filings.map((s) => s.beneficialOwnership.issuer?.id).filter((x): x is string => !!x))];
    const portfolioPctByEntity = new Map<string, number>();
    if (issuerEntityIds.length > 0) {
      const holdings = await db.holding.findMany({
        where: { holder: { tribeId }, security: { companyEntityId: { in: issuerEntityIds } } },
        select: { percentOfPortfolio: true, asOfDate: true, security: { select: { companyEntityId: true } } },
        orderBy: { asOfDate: "desc" },
      });
      // First hit per companyEntityId wins — rows are already ordered by asOfDate desc, so that's the latest quarter.
      for (const h of holdings) {
        const companyEntityId = h.security?.companyEntityId;
        if (!companyEntityId || h.percentOfPortfolio == null || portfolioPctByEntity.has(companyEntityId)) continue;
        portfolioPctByEntity.set(companyEntityId, h.percentOfPortfolio);
      }
    }

    return filings.map((s) => {
      const bo = s.beneficialOwnership;
      const meta = (bo.issuer?.metadata ?? null) as { nameZh?: string } | null;
      return {
        id: s.id,
        kind: s.kind as BeneficialOwnershipFiling["kind"],
        filedAt: s.filedAt,
        filingUrl: s.url,
        issuerName: bo.issuerName,
        issuerTicker: bo.issuerTicker,
        percentOfClass: bo.percentOfClass,
        sharesOwned: bo.sharesOwned != null ? bo.sharesOwned.toString() : null,
        isGroupFiling: bo.isGroupFiling,
        currentPortfolioPct: bo.issuer ? portfolioPctByEntity.get(bo.issuer.id) ?? null : null,
        issuer: bo.issuer
          ? {
              id: bo.issuer.id,
              cik: bo.issuer.cik,
              market: bo.issuer.market,
              code: bo.issuer.code,
              canonicalName: bo.issuer.canonicalName,
              nameZh: meta?.nameZh ?? null,
            }
          : null,
      };
    });
  } catch (err) {
    logDbFallback("getBeneficialOwnershipFilings", err);
    return [];
  }
}

// Defensive dedupe: historical imports may contain duplicate rows sharing the same key
// (e.g. same security in the same quarter). Keeps the row with the higher valueUsd.
function dedupeByKey<T>(rows: T[], keyOf: (row: T) => string, valueOf: (row: T) => bigint): T[] {
  const deduped = new Map<string, T>();
  for (const row of rows) {
    const key = keyOf(row);
    const prev = deduped.get(key);
    if (!prev || valueOf(row) >= valueOf(prev)) deduped.set(key, row);
  }
  return [...deduped.values()];
}

// A 13F option position shares its underlying stock's CUSIP (same securityId)
// — putCall is what distinguishes an equity row from an option row (and a put
// from a call) on that same security, so dedupe/grouping must key on both,
// never securityId alone, or a legitimate option leg looks like a duplicate
// of the equity leg and gets dropped.
export function holdingSecurityPutCallKey(h: { securityId: string | null; putCall: string }): string {
  return `${h.securityId}::${h.putCall}`;
}

const HOLDING_SECURITY_INCLUDE = {
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
} as const;

export async function getHoldingsByQuarter(tribeId: string, year: number, quarter: number) {
  try {
    const rows = await db.holding.findMany({
      where: {
        holder: { tribeId },
        source: { is: { periodYear: year, periodQuarter: quarter, kind: "13f" } },
      },
      include: HOLDING_SECURITY_INCLUDE,
      orderBy: { percentOfPortfolio: "desc" },
    });
    return dedupeByKey(rows, holdingSecurityPutCallKey, (r) => r.valueUsd ?? BigInt(0));
  } catch (err) {
    logDbFallback("getHoldingsByQuarter", err);
    return [];
  }
}

export function getHoldingTicker(h: HoldingRow): string | null {
  return h.security?.ticker ?? h.security?.company?.ticker ?? null;
}

export function getHoldingCompanyPath(h: HoldingRow): string | null {
  // ETFs/trusts/warrants/etc. never get a company page (see
  // scripts/lib/security-kind-classify.ts) — link to nothing rather than a
  // permanently-empty stub.
  if (isNonCompanySecurityKind(h.security?.kind)) return null;
  return formatCompanyUrl(h.security?.company ?? {});
}

export function getHoldingDisplayNames(h: HoldingRow): { zhName: string; enName: string } {
  const meta = (h.security?.metadata ?? {}) as { nameZh?: string; nameEnShort?: string };
  const company = h.security?.company;
  const zhName = meta.nameZh ?? company?.canonicalName ?? h.security?.ticker ?? "-";
  const enName = meta.nameEnShort ?? company?.canonicalName ?? h.security?.ticker ?? "-";
  return { zhName, enName };
}

// Implied per-share price at filing time — 13F only reports aggregate value + shares, not price.
export function formatPriceFromValueAndShares(valueUsd: bigint | null, shares: bigint | null): string {
  if (valueUsd == null || shares == null) return "—";
  const v = Number(valueUsd);
  const s = Number(shares);
  if (!Number.isFinite(v) || !Number.isFinite(s) || s <= 0) return "—";
  return `$${(v / s).toFixed(2)}`;
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

// AUM badge on the homepage cards — sum of the latest 13F's reported position
// values. Reuses getHoldingsByQuarter (not a raw aggregate) so the same
// duplicate-security dedupe applies here as everywhere else the total is shown.
export async function getLatestPortfolioValueUsd(tribeId: string): Promise<bigint | null> {
  const quarters = await getAvailableQuarters(tribeId);
  const latest = quarters[0];
  if (!latest) return null;

  const holdings = await getHoldingsByQuarter(tribeId, latest.year, latest.quarter);
  if (!holdings.length) return null;
  return holdings.reduce((sum, h) => sum + (h.valueUsd ?? BigInt(0)), BigInt(0));
}

export type SecurityHistoryPoint = {
  year: number;
  quarter: number;
  time: string; // asOfDate, YYYY-MM-DD — chart x-axis key
  percentOfPortfolio: number | null;
  sharesNumber: number | null; // Number(shares) — 13F share counts are far under 2^53, safe
  valueUsdNumber: number | null; // Number(valueUsd)
  sharesDisplay: string;
  valueUsdDisplay: string;
  reportedPriceDisplay: string;
  activity: HoldingActivity;
  // True for a synthetic point appended after a position's last real Holding row — 13F
  // filings simply omit a security once it's fully sold, so there's never a real row
  // confirming the exit. Without this, the chart/table would trail off at the last
  // held quarter instead of showing the drop to zero.
  isExitPoint: boolean;
};

export type SecurityHistoryItem = {
  securityId: string;
  ticker: string | null;
  zhName: string;
  enName: string;
  companyUrl: string | null;
  securityKind: string | null | undefined;
  putCall: string;
  isCurrentlyHeld: boolean;
  lastHeldYear: number;
  lastHeldQuarter: number;
  latestPercentOfPortfolio: number | null;
  history: SecurityHistoryPoint[]; // ascending by (year, quarter)
};

// Every security this investor has ever held across all 13F quarters on file, grouped
// by security with a full quarter-by-quarter history — powers the holdings page's
// "by company" view (see src/app/master/[id]/holdings/page.tsx). One query for all
// quarters, grouped/sorted in JS, since even the richest tracked investor only has on
// the order of a few dozen distinct securities and a few dozen quarters.
export async function getHoldingsHistoryBySecurity(tribeId: string): Promise<SecurityHistoryItem[]> {
  try {
    const quarters = await getAvailableQuarters(tribeId);
    if (!quarters.length) return [];
    const latestQuarter = quarters[0];
    // Quarters ascending, for adjacency lookups when computing activity across gaps.
    const quartersAsc = [...quarters].reverse();
    const quarterIndex = new Map<string, number>(quartersAsc.map((q, i) => [`${q.year}-${q.quarter}`, i]));

    const rows = await db.holding.findMany({
      where: {
        holder: { tribeId },
        source: { is: { kind: "13f" } },
      },
      include: {
        ...HOLDING_SECURITY_INCLUDE,
        source: { select: { periodYear: true, periodQuarter: true } },
      },
    });

    const deduped = dedupeByKey(
      rows,
      (r) => `${holdingSecurityPutCallKey(r)}|${r.source.periodYear}|${r.source.periodQuarter}`,
      (r) => r.valueUsd ?? BigInt(0),
    );

    // Keyed by (security, putCall), not securityId alone — an equity leg and
    // an option leg on the same CUSIP are different positions and must
    // become separate chart items, not merge into one.
    const bySecurity = new Map<string, typeof deduped>();
    for (const row of deduped) {
      if (row.source.periodYear == null || row.source.periodQuarter == null) continue;
      const key = holdingSecurityPutCallKey(row);
      if (!bySecurity.has(key)) bySecurity.set(key, []);
      bySecurity.get(key)!.push(row);
    }

    const items: SecurityHistoryItem[] = [];
    for (const [groupKey, group] of bySecurity) {
      group.sort((a, b) => {
        const ai = quarterIndex.get(`${a.source.periodYear}-${a.source.periodQuarter}`) ?? -1;
        const bi = quarterIndex.get(`${b.source.periodYear}-${b.source.periodQuarter}`) ?? -1;
        return ai - bi;
      });

      const history: SecurityHistoryPoint[] = group.map((row) => {
        const idx = quarterIndex.get(`${row.source.periodYear}-${row.source.periodQuarter}`) ?? -1;
        const prevQuarter = idx > 0 ? quartersAsc[idx - 1] : null;
        const prevRow = prevQuarter
          ? group.find((g) => g.source.periodYear === prevQuarter.year && g.source.periodQuarter === prevQuarter.quarter)
          : undefined;
        const hasComparableQuarter = prevQuarter != null;
        const shareDeltaPct = computeShareDeltaPct(prevRow?.shares, row.shares);
        const activity = computeHoldingActivity(hasComparableQuarter, Boolean(prevRow), shareDeltaPct);

        return {
          year: row.source.periodYear!,
          quarter: row.source.periodQuarter!,
          time: quarterMidDate(row.source.periodYear!, row.source.periodQuarter!),
          percentOfPortfolio: row.percentOfPortfolio,
          sharesNumber: row.shares != null ? Number(row.shares) : null,
          valueUsdNumber: row.valueUsd != null ? Number(row.valueUsd) : null,
          sharesDisplay: formatShares(row.shares),
          valueUsdDisplay: formatValueUsd(row.valueUsd),
          reportedPriceDisplay: formatPriceFromValueAndShares(row.valueUsd, row.shares),
          activity,
          isExitPoint: false,
        };
      });

      const last = history[history.length - 1];
      const isCurrentlyHeld = last.year === latestQuarter.year && last.quarter === latestQuarter.quarter;

      // A position can be exited and later re-initiated more than once across an
      // investor's history (e.g. sold in 2021, bought back in 2025) — 13F filings just
      // omit a security once fully sold, so there's never a real row confirming an
      // exit. Walk every real point and, wherever the next real point (or "now", for
      // the last one) isn't the very next available quarter, insert one synthetic
      // zero-value point right after so the chart/table show the drop to zero instead
      // of a real row jumping straight to "New" (or trailing off at the last holding).
      const historyWithExits: SecurityHistoryPoint[] = [];
      for (let i = 0; i < history.length; i++) {
        const point = history[i];
        historyWithExits.push(point);
        const thisIdx = quarterIndex.get(`${point.year}-${point.quarter}`)!;
        const nextReal = history[i + 1];
        const nextIdx = nextReal
          ? quarterIndex.get(`${nextReal.year}-${nextReal.quarter}`)!
          : quarterIndex.get(`${latestQuarter.year}-${latestQuarter.quarter}`)! + 1;
        if (nextIdx > thisIdx + 1) {
          const exitQuarter = quartersAsc[thisIdx + 1];
          historyWithExits.push({
            year: exitQuarter.year,
            quarter: exitQuarter.quarter,
            time: quarterMidDate(exitQuarter.year, exitQuarter.quarter),
            percentOfPortfolio: 0,
            sharesNumber: 0,
            valueUsdNumber: 0,
            sharesDisplay: formatShares(BigInt(0)),
            valueUsdDisplay: formatValueUsd(BigInt(0)),
            reportedPriceDisplay: formatPriceFromValueAndShares(BigInt(0), BigInt(0)),
            activity: "Unchanged",
            isExitPoint: true,
          });
        }
      }

      const first = group[0];
      const { zhName, enName } = getHoldingDisplayNames(first);
      items.push({
        // Composite (security, putCall) key, not the raw DB securityId — an
        // option leg shares its CUSIP's securityId with the equity leg, and
        // this field is used as this list's React key / selection id
        // (HoldingsHistoryExplorer), which must stay unique per item.
        securityId: groupKey,
        ticker: getHoldingTicker(first),
        zhName,
        enName,
        companyUrl: getHoldingCompanyPath(first),
        securityKind: first.security?.kind,
        putCall: first.putCall,
        isCurrentlyHeld,
        lastHeldYear: last.year,
        lastHeldQuarter: last.quarter,
        latestPercentOfPortfolio: last.percentOfPortfolio,
        history: historyWithExits,
      });
    }

    items.sort((a, b) => {
      if (a.isCurrentlyHeld !== b.isCurrentlyHeld) return a.isCurrentlyHeld ? -1 : 1;
      if (a.lastHeldYear !== b.lastHeldYear) return b.lastHeldYear - a.lastHeldYear;
      if (a.lastHeldQuarter !== b.lastHeldQuarter) return b.lastHeldQuarter - a.lastHeldQuarter;
      return (b.latestPercentOfPortfolio ?? 0) - (a.latestPercentOfPortfolio ?? 0);
    });

    return items;
  } catch (err) {
    logDbFallback("getHoldingsHistoryBySecurity", err);
    return [];
  }
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

export type LibraryItem = {
  id: string;
  badge: string;
  title: string;
  subtitle: string;
  date: Date | null;
  href: string;
};

// Display order when badges are mixed in one grid — signature primary-
// source content (this master's own words) before third-party coverage.
const LIBRARY_BADGE_ORDER = ["信件", "书籍", "演讲", "文章", "访谈"];

// document-card's other sources (buffett's hardcoded cards, GBrain
// documents) always provide a subtitle, so a card missing one renders
// visibly shorter than its grid siblings. Falls back to a plain-text
// excerpt of the article body when description is unset, so every card
// in this grid has one.
function excerptFromMarkdown(markdown: string, maxLength = 68): string {
  const plain = markdown
    .replace(/^>\s*\[!.*?\].*$/gm, "") // callout header lines, e.g. "> [!Overview] 背景概览"
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length <= maxLength ? plain : `${plain.slice(0, maxLength).trimEnd()}...`;
}

// InsightPost.source is the podcast/publication name — a small, slowly-
// growing closed set (~11 values seen). Classified from reading actual
// content, not the show's reputation: e.g. Acquired is mostly two-host
// company narrative/analysis with no named guest, not an investor
// interview, despite "sounding" like one; the one Ribbit Capital entry is
// a translated LP letter, not an article. Unrecognized future sources
// default to 文章 — the safest generic label, since claiming 访谈 asserts a
// format that could be wrong.
const INSIGHT_SOURCE_BADGE: Record<string, string> = {
  "Invest Like the Best": "访谈",
  "Capital Allocators": "访谈",
  "Business Breakdowns": "访谈",
  "No Priors": "访谈",
  "Generating Alpha": "访谈",
  "David Senra": "访谈",
  Acquired: "文章",
  Founders: "文章",
  SemiAnalysis: "文章",
  [BRAND_EN]: "文章",
  "Ribbit Capital": "信件",
};

// Unifies three otherwise-incompatible sources into one {badge, title,
// subtitle, date, href} shape for /master/[id]'s 资料库 section:
//  - Source table: buffett's own shareholder/partnership letters (信件) —
//    the table only ever holds his letters, so a no-op for everyone else.
//  - Document table: ingested primary works (信件/演讲/文章/书籍), scoped to
//    Document.ownerId's type union (buffett/duan/lilu plus any Alpha master
//    with a one-off primary document, e.g. bill-ackman's shareholder letter).
//  - InsightPost: third-party coverage (访谈/文章/信件) tagged to this
//    master via entityIds (scripts/tag-insight-masters.ts) — covers Alpha
//    masters who have no ingested primary material of their own.
export async function getLibraryItems(tribeId: string): Promise<LibraryItem[]> {
  const items: LibraryItem[] = [];

  if (tribeId === "buffett") {
    const byType = await getLetterYearsByType();
    const partnershipYears = Array.from(byType.get("partnership") ?? []).sort((a, b) => a - b);
    const shareholderYears = Array.from(byType.get("shareholder") ?? []).sort((a, b) => a - b);
    if (partnershipYears.length) {
      items.push({
        id: "letters-partnership",
        badge: "信件",
        title: `合伙人信件（${partnershipYears[0]}–${partnershipYears[partnershipYears.length - 1]}）`,
        subtitle: "巴菲特合伙人时期致投资者的年度信件。",
        date: null,
        href: `/master/${tribeId}/library?category=letter&type=partnership`,
      });
    }
    if (shareholderYears.length) {
      items.push({
        id: "letters-shareholder",
        badge: "信件",
        title: `股东信件（${shareholderYears[0]}–${shareholderYears[shareholderYears.length - 1]}）`,
        subtitle: "伯克希尔·哈撒韦历年致股东的信。",
        date: null,
        href: `/master/${tribeId}/library?category=letter&type=shareholder`,
      });
    }
  }

  if (tribeId === "buffett" || tribeId === "duan" || tribeId === "lilu" || tribeId === "bill-ackman") {
    const docs = await getDocumentsForOwner(tribeId);
    for (const doc of docs) {
      items.push({
        id: doc.id,
        badge: doc.badge || "书籍",
        title: doc.title,
        subtitle: doc.subtitle,
        date: null,
        href: doc.readerHref,
      });
    }
  }

  const entity = await db.entity.findFirst({ where: { tribeId, type: "master" }, select: { id: true } });
  if (entity) {
    const posts = await db.insightPost.findMany({
      where: { status: "published", entityIds: { has: entity.id } },
      select: { id: true, slug: true, title: true, description: true, contentRaw: true, source: true, publishedAt: true },
      orderBy: { publishedAt: "desc" },
    });
    for (const post of posts) {
      items.push({
        id: post.id,
        badge: (post.source && INSIGHT_SOURCE_BADGE[post.source]) || "文章",
        title: post.title,
        subtitle: post.description ?? excerptFromMarkdown(post.contentRaw),
        date: post.publishedAt,
        href: `/insights/${post.slug}`,
      });
    }
  }

  return items.sort((a, b) => {
    const orderDiff = LIBRARY_BADGE_ORDER.indexOf(a.badge) - LIBRARY_BADGE_ORDER.indexOf(b.badge);
    if (orderDiff !== 0) return orderDiff;
    if (a.date && b.date) return b.date.getTime() - a.date.getTime();
    return 0;
  });
}

type HoldingRow = Awaited<ReturnType<typeof getHoldingsByQuarter>>[number];

export type HoldingChangeSet = {
  latest: QuarterPoint | null;
  base: QuarterPoint | null;
  top: HoldingRow[];
};

export async function getLatestHoldingChangeSet(tribeId: string): Promise<HoldingChangeSet> {
  const quarters = await getAvailableQuarters(tribeId);
  if (!quarters.length) {
    return { latest: null, base: null, top: [] };
  }

  const latest = quarters[0];
  const base = quarters[1] ?? null;
  const latestRows = await getHoldingsByQuarter(tribeId, latest.year, latest.quarter);

  return { latest, base, top: latestRows.slice(0, 10) };
}

export type PortfolioInsightItem = {
  kind: "summary" | "new" | "add" | "trim" | "exit";
  label: string;
  detail: string;
  ticker?: string;
  nameZh?: string;
  deltaPct?: number;
  shareDeltaPct?: number;
  percentOfPortfolio?: number;
  top5Pct?: number;
  holdingCount?: number;
  totalValueUsd?: number;
  newCount?: number;
  addCount?: number;
  trimCount?: number;
  exitCount?: number;
  totalChanged?: number;
};

export type PortfolioInsightStructured = {
  latest: QuarterPoint;
  base: QuarterPoint | null;
  summary: {
    holdingCount: number;
    top5Pct: number;
    totalValueUsd: number;
    totalChanged: number;
    newCount: number;
    addCount: number;
    trimCount: number;
    exitCount: number;
  };
  items: PortfolioInsightItem[];
};

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
