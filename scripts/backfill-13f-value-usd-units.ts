import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const apply = process.argv.includes("--apply");
const tickerArg = process.argv.find((_, i, arr) => arr[i - 1] === "--ticker")?.trim().toUpperCase() ?? null;

type HoldingRow = Awaited<ReturnType<typeof loadHoldings>>[number];

type SourcePlan = {
  sourceId: string;
  period: string;
  holder: string | null;
  url: string | null;
  count: number;
  medianPrice: number;
  underOneRatio: number;
  holdingsToScale: HoldingRow[];
};

async function loadHoldings() {
  return db.holding.findMany({
    where: {
      source: { kind: "13f" },
      shares: { not: null },
      valueUsd: { not: null },
      ...(tickerArg
        ? {
            OR: [
              { securityProfile: { ticker: { equals: tickerArg, mode: "insensitive" } } },
              { security: { ticker: { equals: tickerArg, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      shares: true,
      valueUsd: true,
      sourceId: true,
      holder: { select: { canonicalName: true, tribeId: true } },
      security: { select: { ticker: true, canonicalName: true } },
      securityProfile: { select: { ticker: true } },
      source: {
        select: {
          id: true,
          url: true,
          periodYear: true,
          periodQuarter: true,
          metadata: true,
        },
      },
    },
  });
}

function impliedPrice(row: HoldingRow) {
  if (!row.valueUsd || !row.shares || row.shares === BigInt(0)) return null;
  const price = Number(row.valueUsd) / Number(row.shares);
  return Number.isFinite(price) ? price : null;
}

function buildPlan(rows: HoldingRow[]): SourcePlan[] {
  const bySource = new Map<string, HoldingRow[]>();
  for (const row of rows) {
    const bucket = bySource.get(row.sourceId) ?? [];
    bucket.push(row);
    bySource.set(row.sourceId, bucket);
  }

  const plan: SourcePlan[] = [];
  for (const [sourceId, holdings] of bySource.entries()) {
    const prices = holdings
      .map(impliedPrice)
      .filter((price): price is number => price != null)
      .sort((a, b) => a - b);
    if (!prices.length) continue;

    const medianPrice = prices[Math.floor(prices.length / 2)] ?? 0;
    const underOneRatio = prices.filter((price) => price < 1).length / prices.length;
    if (!(medianPrice < 1 || underOneRatio >= 0.6)) continue;

    const first = holdings[0];
    const holdingsToScale = holdings.filter((holding) => {
      const price = impliedPrice(holding);
      return price != null && price < 10;
    });
    if (!holdingsToScale.length) continue;

    plan.push({
      sourceId,
      period: `${first.source.periodYear ?? "?"}Q${first.source.periodQuarter ?? "?"}`,
      holder: first.holder.tribeId ?? first.holder.canonicalName,
      url: first.source.url,
      count: holdingsToScale.length,
      medianPrice,
      underOneRatio,
      holdingsToScale,
    });
  }

  return plan.sort((a, b) => `${a.holder}-${a.period}`.localeCompare(`${b.holder}-${b.period}`));
}

function printPlan(plan: SourcePlan[]) {
  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    filterTicker: tickerArg,
    sourceCount: plan.length,
    holdingsToScale: plan.reduce((sum, item) => sum + item.count, 0),
    sources: plan.map((item) => ({
      sourceId: item.sourceId,
      holder: item.holder,
      period: item.period,
      count: item.count,
      medianPrice: item.medianPrice,
      underOneRatio: item.underOneRatio,
      url: item.url,
      samples: item.holdingsToScale.slice(0, 5).map((holding) => ({
        id: holding.id,
        ticker: holding.securityProfile?.ticker ?? holding.security?.ticker,
        name: holding.security?.canonicalName,
        oldValueUsd: holding.valueUsd?.toString(),
        newValueUsd: holding.valueUsd ? (holding.valueUsd * BigInt(1000)).toString() : null,
        shares: holding.shares?.toString(),
        oldPrice: impliedPrice(holding),
        newPrice: impliedPrice(holding) == null ? null : impliedPrice(holding)! * 1000,
      })),
    })),
  }, null, 2));
}

async function applyPlan(plan: SourcePlan[]) {
  for (const source of plan) {
    for (const holding of source.holdingsToScale) {
      if (!holding.valueUsd) continue;
      await db.holding.update({
        where: { id: holding.id },
        data: { valueUsd: holding.valueUsd * BigInt(1000) },
      });
    }

    const metadata = (source.holdingsToScale[0].source.metadata && typeof source.holdingsToScale[0].source.metadata === "object" && !Array.isArray(source.holdingsToScale[0].source.metadata))
      ? source.holdingsToScale[0].source.metadata as Record<string, unknown>
      : {};
    await db.extSource.update({
      where: { id: source.sourceId },
      data: { metadata: { ...metadata, valueUsdScaleApplied: 1000 } },
    });
  }
}

async function main() {
  const rows = await loadHoldings();
  const plan = buildPlan(rows);
  printPlan(plan);
  if (apply) {
    await applyPlan(plan);
    console.log("[backfill-13f-value-usd-units] done");
  }
}

main()
  .catch((err) => {
    console.error("[backfill-13f-value-usd-units] fatal", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
