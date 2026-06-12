import db from "@/lib/prisma";
import { getAvailableQuarters, getHoldingsByQuarter } from "@/lib/master-data";
import { getTribeMember } from "@/lib/tribe";
import { normalizeTicker } from "@/lib/ticker";

export type HomeSignalTone = "positive" | "negative" | "neutral";
export type HomeSignalType = "new" | "consensus" | "divergent" | "add" | "trim" | "fallback";

export type HomeSignalChip = {
  label: string;
  style: {
    background: string;
    color: string;
  };
};

export type HomeSignalCard = {
  type: HomeSignalType;
  tag: string;
  ticker: string;
  cik: string | null;
  tickerLabel: string;
  company: string;
  body: string;
  chips: HomeSignalChip[];
  companyKey: string;
  sourceQuarter: string;
  sourceMasters: string[];
};

export type HomeSignalSnapshotPayload = {
  generatedAt: string;
  sourceQuarters: Record<string, string>;
  pools: Record<string, HomeSignalCard[]>;
  candidates: HomeSignalCard[];
  items: HomeSignalCard[];
};

const HOME_SIGNAL_SCOPE = "home";
const HOME_SIGNAL_LIMIT = 3;
const MASTER_ORDER = ["buffett", "lilu", "duan"] as const;

const CHIP_STYLES: Record<HomeSignalTone, { background: string; color: string }> = {
  positive: { background: "#eff6ff", color: "#1d4ed8" },
  negative: { background: "#fef2f2", color: "#c53030" },
  neutral: { background: "#e2e8f0", color: "#334155" },
};

const DEFAULT_HOME_SIGNALS: HomeSignalCard[] = [
  {
    type: "consensus",
    tag: "★ 共识持仓",
    ticker: "BAC",
    cik: "70858",
    tickerLabel: "美国银行（BAC）",
    company: "Bank of America",
    body: "巴菲特持有14年，李录独立建仓，均列前3重仓。",
    chips: [
      { label: "Buffett 10.4%", style: CHIP_STYLES.positive },
      { label: "李录 16.1%", style: CHIP_STYLES.positive },
    ],
    companyKey: "fallback-bac",
    sourceQuarter: "static",
    sourceMasters: ["buffett", "lilu"],
  },
  {
    type: "new",
    tag: "↑ 新动作",
    ticker: "OXY",
    cik: "797468",
    tickerLabel: "西方石油（OXY）",
    company: "Occidental Petroleum",
    body: "巴菲特本季继续增持，持仓占比突破 28%，接近收购门槛。",
    chips: [{ label: "Buffett 28.2% ↑", style: CHIP_STYLES.positive }],
    companyKey: "fallback-oxy",
    sourceQuarter: "static",
    sourceMasters: ["buffett"],
  },
  {
    type: "divergent",
    tag: "⇅ 各有判断",
    ticker: "AAPL",
    cik: "320193",
    tickerLabel: "苹果（AAPL）",
    company: "Apple",
    body: "巴菲特连续减持至 5.2 亿股；段永平仍视为核心持仓。",
    chips: [
      { label: "Buffett ↓减持", style: CHIP_STYLES.negative },
      { label: "段永平 持有", style: CHIP_STYLES.positive },
    ],
    companyKey: "fallback-aapl",
    sourceQuarter: "static",
    sourceMasters: ["buffett", "duan"],
  },
];

type QuarterPoint = {
  year: number;
  quarter: number;
};

type HoldingRow = Awaited<ReturnType<typeof getHoldingsByQuarter>>[number];

type RawEvent = {
  masterId: string;
  masterNameZh: string;
  companyKey: string;
  ticker: string | null;
  tickerLabel: string;
  company: string;
  cik: string | null;
  direction: "positive" | "negative";
  kind: "new" | "add" | "trim" | "exit";
  nowPct: number;
  prevPct: number | null;
  deltaPct: number | null;
  shares: bigint | null;
  valueUsd: bigint | null;
  sourceQuarter: QuarterPoint;
};

type MasterEventsBundle = {
  masterId: string;
  masterNameZh: string;
  latest: QuarterPoint;
  base: QuarterPoint | null;
  events: RawEvent[];
};

type ScoredSignalCard = {
  card: HomeSignalCard;
  score: number;
};

const SIGNAL_BUCKET_ORDER = [
  "firstBuy",
  "divergence",
  "consensus",
  "add",
  "trim",
  "fallback",
] as const;

function formatQuarter(quarter: QuarterPoint) {
  return `${quarter.year} Q${quarter.quarter}`;
}

function formatPct(value: number | null, digits = 2) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

function formatDeltaPct(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatShareCount(value: bigint | null) {
  if (value == null) return "—";
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(1)}B股`;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M股`;
  if (num >= 10_000) return `${Math.round(num / 10_000)}万股`;
  return `${Math.round(num)}股`;
}

function chip(label: string, tone: HomeSignalTone = "neutral"): HomeSignalChip {
  return { label, style: CHIP_STYLES[tone] };
}

function normalizeMeta(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  return metadata as Record<string, unknown>;
}

function cleanDisplayText(value: string) {
  return value.trim().replace(/[，,]+$/g, "");
}

function getCompanyInfo(row: HoldingRow) {
  const company = row.security?.company;
  const security = row.security;
  const meta = normalizeMeta(company?.metadata);

  const companyZh =
    (typeof meta.nameZh === "string" && cleanDisplayText(meta.nameZh)) ||
    company?.canonicalName ||
    (security?.company?.canonicalName ?? "-");
  const companyEn =
    (typeof meta.nameEnShort === "string" && cleanDisplayText(meta.nameEnShort)) ||
    company?.canonicalName ||
    (security?.company?.canonicalName ?? "-");
  const ticker = security?.ticker?.trim().toUpperCase() ?? company?.ticker?.trim().toUpperCase() ?? null;
  const primaryTicker = company?.ticker?.trim().toUpperCase() ?? null;
  const companyTickers = company?.securitiesAsCompany
    ?.map((s) => s.ticker?.trim().toUpperCase() ?? null)
    .filter((value): value is string => !!normalizeTicker(value))
    .sort((a, b) => a.localeCompare(b));
  const tickerLabelParts = [primaryTicker, ticker, ...(companyTickers ?? [])]
    .map((value) => normalizeTicker(value))
    .filter((value): value is string => !!value);
  const tickerDisplay = [...new Set(tickerLabelParts)].join("/");
  const tickerLabel = tickerDisplay ? `${companyZh}（${tickerDisplay}）` : companyZh;
  const cik = company?.cik ?? null;
  const companyKey = cik ? `cik:${cik}` : company?.id ? `entity:${company.id}` : `ticker:${normalizeTicker(ticker) ?? security?.id ?? ""}`;

  return {
    companyZh,
    companyEn,
    ticker,
    tickerLabel,
    cik,
    companyKey,
  };
}

function getMasterLabel(masterId: string) {
  return getTribeMember(masterId)?.nameZh ?? masterId;
}

async function buildMasterEvents(masterId: string): Promise<MasterEventsBundle | null> {
  const quarters = await getAvailableQuarters(masterId);
  const latest = quarters[0] ?? null;
  const base = quarters[1] ?? null;
  if (!latest) return null;

  const latestRows = await getHoldingsByQuarter(masterId, latest.year, latest.quarter);
  const baseRows = base ? await getHoldingsByQuarter(masterId, base.year, base.quarter) : [];
  const baseByCompany = new Map(baseRows.map((row) => [getCompanyInfo(row).companyKey, row] as const));
  const latestByCompany = new Map(latestRows.map((row) => [getCompanyInfo(row).companyKey, row] as const));

  const events: RawEvent[] = [];
  const masterNameZh = getMasterLabel(masterId);

  for (const row of latestRows) {
    const info = getCompanyInfo(row);
    const prev = baseByCompany.get(info.companyKey);
    const nowPct = row.percentOfPortfolio ?? 0;
    const prevPct = prev?.percentOfPortfolio ?? null;
    const deltaPct = prevPct == null ? null : nowPct - prevPct;

    if (!prev) {
      events.push({
        masterId,
        masterNameZh,
        companyKey: info.companyKey,
        ticker: info.ticker,
        tickerLabel: info.tickerLabel,
        company: info.companyEn,
        cik: info.cik,
        direction: "positive",
        kind: "new",
        nowPct,
        prevPct: null,
        deltaPct: null,
        shares: row.shares ?? null,
        valueUsd: row.valueUsd ?? null,
        sourceQuarter: latest,
      });
      continue;
    }

    if (deltaPct == null || Math.abs(deltaPct) < 0.08) continue;

    events.push({
      masterId,
      masterNameZh,
      companyKey: info.companyKey,
      ticker: info.ticker,
      tickerLabel: info.tickerLabel,
      company: info.companyEn,
      cik: info.cik,
      direction: deltaPct > 0 ? "positive" : "negative",
      kind: deltaPct > 0 ? "add" : "trim",
      nowPct,
      prevPct,
      deltaPct,
      shares: row.shares ?? null,
      valueUsd: row.valueUsd ?? null,
      sourceQuarter: latest,
    });
  }

  for (const row of baseRows) {
    const info = getCompanyInfo(row);
    if (latestByCompany.has(info.companyKey)) continue;
    events.push({
      masterId,
      masterNameZh,
      companyKey: info.companyKey,
      ticker: info.ticker,
      tickerLabel: info.tickerLabel,
      company: info.companyEn,
      cik: info.cik,
      direction: "negative",
      kind: "exit",
      nowPct: 0,
      prevPct: row.percentOfPortfolio ?? 0,
      deltaPct: null,
      shares: row.shares ?? null,
      valueUsd: row.valueUsd ?? null,
      sourceQuarter: latest,
    });
  }

  return { masterId, masterNameZh, latest, base, events };
}

function selectStrongest<T>(items: T[], scoreOf: (item: T) => number) {
  return [...items].sort((a, b) => scoreOf(b) - scoreOf(a))[0] ?? null;
}

function groupByCompany(events: RawEvent[]) {
  const groups = new Map<string, RawEvent[]>();
  for (const event of events) {
    const bucket = groups.get(event.companyKey);
    if (bucket) bucket.push(event);
    else groups.set(event.companyKey, [event]);
  }
  return groups;
}

function collapseByMaster(events: RawEvent[]) {
  const sorted = [...events].sort((a, b) => {
    const score = (item: RawEvent) => Math.abs(item.deltaPct ?? item.nowPct) + item.nowPct;
    return score(b) - score(a);
  });
  const seen = new Set<string>();
  const collapsed: RawEvent[] = [];
  for (const event of sorted) {
    if (seen.has(event.masterId)) continue;
    seen.add(event.masterId);
    collapsed.push(event);
  }
  return collapsed;
}

function buildFirstBuyCards(events: RawEvent[]): ScoredSignalCard[] {
  const groups = groupByCompany(events.filter((event) => event.kind === "new"));
  const cards: ScoredSignalCard[] = [];

  for (const group of groups.values()) {
    const collapsed = collapseByMaster(group);
    const event = selectStrongest(collapsed, (item) => item.nowPct);
    if (!event) continue;
    const extraMasters = collapsed.length - 1;
    const card: HomeSignalCard = {
      type: "new",
      tag: "↑ 首次建仓",
      ticker: event.companyKey,
      cik: event.cik,
      tickerLabel: event.tickerLabel,
      company: event.company,
      body: `${event.masterNameZh}在 ${formatQuarter(event.sourceQuarter)} 首次建仓，持仓 ${formatShareCount(event.shares)}，占组合 ${formatPct(event.nowPct)}。`,
      chips: [
        chip(formatQuarter(event.sourceQuarter), "positive"),
        chip(formatPct(event.nowPct), "positive"),
        ...(extraMasters > 0 ? [chip(`另有 ${extraMasters} 笔同类动作`, "neutral")] : []),
      ],
      companyKey: event.companyKey,
      sourceQuarter: formatQuarter(event.sourceQuarter),
      sourceMasters: [...new Set(group.map((item) => item.masterNameZh))],
    };
    cards.push({ card, score: event.nowPct + extraMasters });
  }

  return cards.sort((a, b) => b.score - a.score);
}

function buildConsensusCards(events: RawEvent[]): ScoredSignalCard[] {
  const groups = groupByCompany(events);
  const cards: ScoredSignalCard[] = [];

  for (const group of groups.values()) {
    const collapsed = collapseByMaster(group);
    const positive = collapsed.filter((event) => event.direction === "positive");
    const negative = collapsed.filter((event) => event.direction === "negative");
    if (positive.length < 2 && negative.length < 2) continue;
    if (positive.length > 0 && negative.length > 0) continue;

    const sameSide = positive.length > 0 ? positive : negative;
    const strongest = selectStrongest(sameSide, (item) => Math.abs(item.deltaPct ?? item.nowPct));
    if (!strongest) continue;
    const masterNames = [...new Set(sameSide.map((item) => item.masterNameZh))];
    const directionLabel = positive.length > 0 ? "同向加仓" : "同向减持";
    const score = sameSide.length * 10 + sameSide.reduce((sum, item) => sum + Math.abs(item.deltaPct ?? item.nowPct), 0);

    cards.push({
      score,
      card: {
        type: "consensus",
        tag: "★ 共识持仓",
        ticker: strongest.companyKey,
        cik: strongest.cik,
        tickerLabel: strongest.tickerLabel,
        company: strongest.company,
        body: `${masterNames.join("、")}在 ${formatQuarter(strongest.sourceQuarter)} ${directionLabel}，形成跨大师共识。`,
        chips: [
          chip(`${masterNames.length} 位大师`, "positive"),
          chip(directionLabel, positive.length > 0 ? "positive" : "negative"),
          chip(formatQuarter(strongest.sourceQuarter), "neutral"),
        ],
        companyKey: strongest.companyKey,
        sourceQuarter: formatQuarter(strongest.sourceQuarter),
        sourceMasters: masterNames,
      },
    });
  }

  return cards.sort((a, b) => b.score - a.score);
}

function describeDivergenceSide(event: RawEvent, masterNames: string[]) {
  const action =
    event.kind === "new"
      ? `建仓 ${formatPct(event.nowPct)}`
      : event.kind === "add"
        ? `加仓 ${formatDeltaPct(event.deltaPct)}`
        : event.kind === "exit"
          ? "清仓"
          : `减持 ${formatDeltaPct(event.deltaPct)}`;
  const name = masterNames.length > 1 ? `${event.masterNameZh}等${masterNames.length}人` : event.masterNameZh;
  return `${name} ${action}`;
}

function buildDivergenceCards(events: RawEvent[]): ScoredSignalCard[] {
  const groups = groupByCompany(events);
  const cards: ScoredSignalCard[] = [];

  for (const group of groups.values()) {
    const collapsed = collapseByMaster(group);
    const positive = collapsed.filter((event) => event.direction === "positive");
    const negative = collapsed.filter((event) => event.direction === "negative");
    if (!positive.length || !negative.length) continue;

    const strongest = selectStrongest(collapsed, (item) => Math.abs(item.deltaPct ?? item.nowPct));
    const strongestPositive = selectStrongest(positive, (item) => Math.abs(item.deltaPct ?? item.nowPct));
    const strongestNegative = selectStrongest(negative, (item) => Math.abs(item.deltaPct ?? item.nowPct));
    if (!strongest || !strongestPositive || !strongestNegative) continue;
    const positiveMasters = [...new Set(positive.map((item) => item.masterNameZh))];
    const negativeMasters = [...new Set(negative.map((item) => item.masterNameZh))];
    const score = (positiveMasters.length + negativeMasters.length) * 10 + group.reduce((sum, item) => sum + Math.abs(item.deltaPct ?? item.nowPct), 0);

    cards.push({
      score,
      card: {
        type: "divergent",
        tag: "⇅ 各有判断",
        ticker: strongest.companyKey,
        cik: strongest.cik,
        tickerLabel: strongest.tickerLabel,
        company: strongest.company,
        body: `${negativeMasters.join("、")}在 ${formatQuarter(strongest.sourceQuarter)} 减持/退出；${positiveMasters.join("、")}则在增持/新进。`,
        chips: [
          chip(describeDivergenceSide(strongestPositive, positiveMasters), "positive"),
          chip(describeDivergenceSide(strongestNegative, negativeMasters), "negative"),
          chip(formatQuarter(strongest.sourceQuarter), "neutral"),
        ],
        companyKey: strongest.companyKey,
        sourceQuarter: formatQuarter(strongest.sourceQuarter),
        sourceMasters: [...new Set(group.map((item) => item.masterNameZh))],
      },
    });
  }

  return cards.sort((a, b) => b.score - a.score);
}

function buildAddCards(events: RawEvent[]): ScoredSignalCard[] {
  const cards: ScoredSignalCard[] = [];
  for (const event of collapseByMaster(events.filter((item) => item.kind === "add" && item.direction === "positive"))) {
    cards.push({
      score: Math.abs(event.deltaPct ?? 0) + event.nowPct,
      card: {
        type: "add",
        tag: "↑ 增持",
        ticker: event.companyKey,
        cik: event.cik,
        tickerLabel: event.tickerLabel,
        company: event.company,
        body: `${event.masterNameZh}在 ${formatQuarter(event.sourceQuarter)} 加仓 ${formatDeltaPct(event.deltaPct)}，最新仓位 ${formatPct(event.nowPct)}。`,
        chips: [
          chip(formatQuarter(event.sourceQuarter), "positive"),
          chip(formatDeltaPct(event.deltaPct), "positive"),
          chip(formatPct(event.nowPct), "neutral"),
        ],
        companyKey: event.companyKey,
        sourceQuarter: formatQuarter(event.sourceQuarter),
        sourceMasters: [event.masterNameZh],
      },
    });
  }

  return cards.sort((a, b) => b.score - a.score);
}

function buildTrimCards(events: RawEvent[]): ScoredSignalCard[] {
  const cards: ScoredSignalCard[] = [];
  for (const event of collapseByMaster(events.filter((item) => item.kind !== "new" && item.direction === "negative"))) {
    cards.push({
      score: event.kind === "exit" ? (event.prevPct ?? 0) : Math.abs(event.deltaPct ?? 0),
      card: {
        type: "trim",
        tag: event.kind === "exit" ? "↓ 清仓" : "↓ 减持",
        ticker: event.companyKey,
        cik: event.cik,
        tickerLabel: event.tickerLabel,
        company: event.company,
        body:
          event.kind === "exit"
            ? `${event.masterNameZh}在 ${formatQuarter(event.sourceQuarter)} 清仓离场，上一季仓位 ${formatPct(event.prevPct)}。`
            : `${event.masterNameZh}在 ${formatQuarter(event.sourceQuarter)} 减持 ${formatDeltaPct(event.deltaPct)}，最新仓位 ${formatPct(event.nowPct)}。`,
        chips: [
          chip(formatQuarter(event.sourceQuarter), "negative"),
          chip(event.kind === "exit" ? "清仓" : formatDeltaPct(event.deltaPct), "negative"),
          chip(event.kind === "exit" ? formatPct(event.prevPct) : formatPct(event.nowPct), "neutral"),
        ],
        companyKey: event.companyKey,
        sourceQuarter: formatQuarter(event.sourceQuarter),
        sourceMasters: [event.masterNameZh],
      },
    });
  }

  return cards.sort((a, b) => b.score - a.score);
}

function buildFallbackCards(events: RawEvent[]): ScoredSignalCard[] {
  const groups = groupByCompany(events);
  const cards: ScoredSignalCard[] = [];

  for (const group of groups.values()) {
    const collapsed = collapseByMaster(group);
    const strongest = selectStrongest(collapsed, (item) => Math.abs(item.deltaPct ?? item.nowPct) + item.nowPct);
    if (!strongest) continue;
    const label = strongest.kind === "exit" ? "清仓" : strongest.kind === "trim" ? "减持" : strongest.kind === "add" ? "增持" : "新进";
    const score = Math.abs(strongest.deltaPct ?? strongest.nowPct) + strongest.nowPct;
    cards.push({
      score,
      card: {
        type: "fallback",
        tag: "● 最新动作",
        ticker: strongest.companyKey,
        cik: strongest.cik,
        tickerLabel: strongest.tickerLabel,
        company: strongest.company,
        body: `${strongest.masterNameZh}在 ${formatQuarter(strongest.sourceQuarter)} ${label} ${strongest.tickerLabel}。`,
        chips: [chip(formatQuarter(strongest.sourceQuarter), "neutral"), chip(label, "neutral")],
        companyKey: strongest.companyKey,
        sourceQuarter: formatQuarter(strongest.sourceQuarter),
        sourceMasters: [strongest.masterNameZh],
      },
    });
  }

  return cards.sort((a, b) => b.score - a.score);
}

function selectFromBuckets(buckets: Record<string, ScoredSignalCard[]>) {
  const seen = new Set<string>();
  const picked: HomeSignalCard[] = [];

  for (const bucketName of SIGNAL_BUCKET_ORDER) {
    const bucket = buckets[bucketName] ?? [];
    for (const item of bucket) {
      if (seen.has(item.card.companyKey)) continue;
      seen.add(item.card.companyKey);
      picked.push(item.card);
      break;
    }
  }

  return picked;
}

export async function buildHomeSignalSnapshotPayload(): Promise<HomeSignalSnapshotPayload> {
  const masterResults: MasterEventsBundle[] = [];
  const sourceQuarters: Record<string, string> = {};

  for (const masterId of MASTER_ORDER) {
    const result = await buildMasterEvents(masterId);
    if (!result) continue;
    masterResults.push(result);
    sourceQuarters[masterId] = formatQuarter(result.latest);
  }

  const events = masterResults.flatMap((result) => result.events);
  if (!events.length) {
    return {
      generatedAt: new Date().toISOString(),
      sourceQuarters,
      pools: {
        firstBuy: DEFAULT_HOME_SIGNALS,
        divergence: [],
        consensus: [],
        add: [],
        trim: [],
        fallback: [],
      },
      candidates: DEFAULT_HOME_SIGNALS,
      items: DEFAULT_HOME_SIGNALS.slice(0, HOME_SIGNAL_LIMIT),
    };
  }

  const pools = {
    firstBuy: buildFirstBuyCards(events),
    divergence: buildDivergenceCards(events),
    consensus: buildConsensusCards(events),
    add: buildAddCards(events),
    trim: buildTrimCards(events),
    fallback: buildFallbackCards(events),
  };

  const rankedCandidates = selectFromBuckets(pools);

  const items = rankedCandidates.length ? rankedCandidates.slice(0, HOME_SIGNAL_LIMIT) : DEFAULT_HOME_SIGNALS.slice(0, HOME_SIGNAL_LIMIT);

  return {
    generatedAt: new Date().toISOString(),
    sourceQuarters,
    pools: {
      firstBuy: pools.firstBuy.map((item) => item.card),
      divergence: pools.divergence.map((item) => item.card),
      consensus: pools.consensus.map((item) => item.card),
      add: pools.add.map((item) => item.card),
      trim: pools.trim.map((item) => item.card),
      fallback: pools.fallback.map((item) => item.card),
    },
    candidates: rankedCandidates,
    items,
  };
}

export async function upsertHomeSignalSnapshot(payload: HomeSignalSnapshotPayload) {
  await db.homeSignalSnapshot.upsert({
    where: { scope: HOME_SIGNAL_SCOPE },
    update: {
      payload,
      sourceQuarter:
        Object.values(payload.sourceQuarters).filter(Boolean).sort().slice(-1)[0] ?? null,
      generatedAt: new Date(payload.generatedAt),
      version: { increment: 1 },
    },
    create: {
      scope: HOME_SIGNAL_SCOPE,
      payload,
      sourceQuarter:
        Object.values(payload.sourceQuarters).filter(Boolean).sort().slice(-1)[0] ?? null,
      generatedAt: new Date(payload.generatedAt),
    },
  });
}

export async function getLatestHomeSignalCards(): Promise<HomeSignalCard[]> {
  try {
    const row = await db.homeSignalSnapshot.findUnique({
      where: { scope: HOME_SIGNAL_SCOPE },
      select: { payload: true },
    });

    const payload = row?.payload as HomeSignalSnapshotPayload | null;
    const items = payload?.items ?? [];
    if (items.length) return items.slice(0, HOME_SIGNAL_LIMIT);
  } catch {
    // fall through to static fallback
  }

  return DEFAULT_HOME_SIGNALS.slice(0, HOME_SIGNAL_LIMIT);
}
