import prisma from "@/lib/prisma";
import { formatCompanyUrl } from "@/lib/company-data";
import { getTribeMembers, getTribeMemberColor } from "@/lib/tribe";

export type PunchStatus = "active" | "exited" | "thesis_broken";
export type PunchSource = "curated" | "13f_derived" | "user_submitted";

export interface PunchQuote {
  text: string;
  date: string;
  sourceTitle: string;
  sourceUrl?: string;
}

export interface PunchListItem {
  slug: string;
  status: PunchStatus;
  punchYear: number | null;
  headline: string;
  masterName: string | null;
  masterInitials: string | null;
  masterHref: string | null;
  masterColor: string | null;
  companyName: string | null;
  companyTicker: string | null;
  companyHref: string | null;
  entrySummary: string | null;
}

export interface PunchDetail extends PunchListItem {
  thesis: string;
  catalyst: string | null;
  valuation: string | null;
  risk: string | null;
  quotes: PunchQuote[];
  source: PunchSource;
  livePosition: LivePositionSnapshot | null;
}

export interface LivePositionSnapshot {
  asOfDate: string;
  percentOfPortfolio: number | null;
  valueUsd: string | null;
  shares: string | null;
}

function toQuotes(raw: unknown): PunchQuote[] {
  if (!Array.isArray(raw)) return [];
  return raw as PunchQuote[];
}

export async function getPunches(): Promise<PunchListItem[]> {
  const [rows, tribeMembers] = await Promise.all([
    prisma.punch.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        filerEntity: { select: { tribeId: true } },
        companyEntity: { select: { canonicalName: true, ticker: true, cik: true, market: true, code: true } },
      },
    }),
    getTribeMembers(),
  ]);

  return rows.map((row) => toListItem(row, tribeMembers));
}

export async function getPunchBySlug(slug: string): Promise<PunchDetail | null> {
  const [row, tribeMembers] = await Promise.all([
    prisma.punch.findUnique({
      where: { slug },
      include: {
        filerEntity: { select: { tribeId: true } },
        companyEntity: { select: { canonicalName: true, ticker: true, cik: true, market: true, code: true } },
      },
    }),
    getTribeMembers(),
  ]);
  if (!row) return null;

  const livePosition =
    row.filerEntityId && row.companyEntityId
      ? await getLivePositionSnapshot(row.filerEntityId, row.companyEntityId)
      : null;

  return {
    ...toListItem(row, tribeMembers),
    thesis: row.thesis,
    catalyst: row.catalyst,
    valuation: row.valuation,
    risk: row.risk,
    quotes: toQuotes(row.quotes),
    source: row.source as PunchSource,
    livePosition,
  };
}

// Punches are forward-looking, so the wall/detail page shouldn't show a
// number that goes stale the moment the next 13F is imported — compute the
// latest known position size live from `Holding` instead of storing it on
// `Punch`. This is a read-only snapshot, not a status auto-refresh: it does
// NOT flip `Punch.status`, which stays an editorial call for now (see
// PRODUCT.md「打孔（Punch）路线图」next steps — full pipeline-driven status
// refresh is deferred).
async function getLivePositionSnapshot(
  filerEntityId: string,
  companyEntityId: string,
): Promise<LivePositionSnapshot | null> {
  const securities = await prisma.security.findMany({
    where: { companyEntityId },
    select: { id: true },
  });
  if (securities.length === 0) return null;

  const holding = await prisma.holding.findFirst({
    where: { holderEntityId: filerEntityId, securityId: { in: securities.map((s) => s.id) } },
    orderBy: { asOfDate: "desc" },
  });
  if (!holding) return null;

  return {
    asOfDate: holding.asOfDate.toISOString().slice(0, 10),
    percentOfPortfolio: holding.percentOfPortfolio,
    valueUsd: holding.valueUsd?.toString() ?? null,
    shares: holding.shares?.toString() ?? null,
  };
}

type PunchRow = {
  slug: string;
  status: string;
  punchYear: number | null;
  headline: string;
  entrySummary: string | null;
  filerEntity: { tribeId: string | null } | null;
  companyEntity: {
    canonicalName: string;
    ticker: string | null;
    cik: string | null;
    market: string | null;
    code: string | null;
  } | null;
};

function toListItem(
  row: PunchRow,
  tribeMembers: Awaited<ReturnType<typeof getTribeMembers>>,
): PunchListItem {
  const tribeId = row.filerEntity?.tribeId ?? null;
  const master = tribeId ? tribeMembers.find((m) => m.id === tribeId) ?? null : null;
  return {
    slug: row.slug,
    status: row.status as PunchStatus,
    punchYear: row.punchYear,
    headline: row.headline,
    entrySummary: row.entrySummary,
    masterName: master?.nameZh ?? null,
    masterInitials: master?.initials ?? null,
    masterHref: master ? `/master/${master.id}` : null,
    masterColor: master ? getTribeMemberColor(master) : null,
    companyName: row.companyEntity?.canonicalName ?? null,
    companyTicker: row.companyEntity?.ticker ?? null,
    companyHref: row.companyEntity ? formatCompanyUrl(row.companyEntity) : null,
  };
}
