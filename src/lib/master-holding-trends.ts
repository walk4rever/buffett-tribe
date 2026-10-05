export type MasterHolderRankInput = {
  activity?: string | null;
  sourceYear?: number | null;
  sourceQuarter?: number | null;
  weightPct?: number | null;
  valueUsd?: number | null;
};

export type MasterHolderTrendGroup = {
  key: string;
  holderIds: string[];
};

export type MasterHolderTrendQuarter = {
  holderId: string;
  year: number;
  quarter: number;
};

export type MasterHolderTrendPosition = {
  holderId: string;
  securityKey: string;
  putCall: string;
  year: number;
  quarter: number;
  weightPct: number | null;
  sharesNumber: number | null;
  valueUsd: number | null;
};

export type MasterHolderTrendPoint = {
  year: number;
  quarter: number;
  weightPct: number | null;
  sharesNumber: number | null;
  valueUsd: number | null;
};

function quarterScore(holder: MasterHolderRankInput) {
  return (holder.sourceYear ?? 0) * 4 + (holder.sourceQuarter ?? 0);
}

export function selectTopMasterHolders<T extends MasterHolderRankInput>(
  holders: readonly T[],
  limit: number,
): T[] {
  return [...holders]
    .sort((a, b) => {
      const aSoldOut = a.activity === "SoldOut";
      const bSoldOut = b.activity === "SoldOut";
      if (aSoldOut !== bSoldOut) return aSoldOut ? 1 : -1;

      const byQuarter = quarterScore(b) - quarterScore(a);
      if (byQuarter !== 0) return byQuarter;

      const byWeight = (b.weightPct ?? 0) - (a.weightPct ?? 0);
      if (Math.abs(byWeight) > 0.001) return byWeight;

      return (b.valueUsd ?? 0) - (a.valueUsd ?? 0);
    })
    .slice(0, Math.max(0, limit));
}

function periodKey(year: number, quarter: number) {
  return `${year}-Q${quarter}`;
}

export function buildMasterHolderTrends(
  groups: readonly MasterHolderTrendGroup[],
  filings: readonly MasterHolderTrendQuarter[],
  positions: readonly MasterHolderTrendPosition[],
): Map<string, MasterHolderTrendPoint[]> {
  const filingsByHolder = new Map<string, Set<string>>();
  for (const filing of filings) {
    if (!Number.isInteger(filing.year) || filing.quarter < 1 || filing.quarter > 4) continue;
    const key = periodKey(filing.year, filing.quarter);
    const holderPeriods = filingsByHolder.get(filing.holderId) ?? new Set<string>();
    holderPeriods.add(key);
    filingsByHolder.set(filing.holderId, holderPeriods);
  }

  const positionsByHolderPeriod = new Map<
    string,
    Map<string, MasterHolderTrendPosition>
  >();
  for (const position of positions) {
    if (!Number.isInteger(position.year) || position.quarter < 1 || position.quarter > 4) continue;
    const period = periodKey(position.year, position.quarter);
    const holderPeriodKey = `${position.holderId}|${period}`;
    const securities = positionsByHolderPeriod.get(holderPeriodKey) ?? new Map();
    const securityKey = `${position.securityKey.trim().toUpperCase()}|${position.putCall}`;
    const previous = securities.get(securityKey);
    if (
      !previous ||
      (position.valueUsd ?? 0) >= (previous.valueUsd ?? 0)
    ) {
      securities.set(securityKey, position);
    }
    positionsByHolderPeriod.set(holderPeriodKey, securities);
  }

  const result = new Map<string, MasterHolderTrendPoint[]>();
  for (const group of groups) {
    const holderIds = [...new Set(group.holderIds)];
    const reportersByPeriod = new Map<string, Set<string>>();
    for (const holderId of holderIds) {
      for (const period of filingsByHolder.get(holderId) ?? []) {
        const reporters = reportersByPeriod.get(period) ?? new Set<string>();
        reporters.add(holderId);
        reportersByPeriod.set(period, reporters);
      }
    }

    const history = [...reportersByPeriod.entries()]
      .map(([period, reporters]) => {
        const [year, quarter] = period.split("-Q").map(Number);
        let totalWeight = 0;
        let totalShares = 0;
        let totalValueUsd = 0;
        let hasMissingWeight = false;
        let hasMissingShares = false;
        let hasMissingValue = false;

        for (const holderId of reporters) {
          const securityRows = positionsByHolderPeriod.get(`${holderId}|${period}`);
          if (!securityRows?.size) continue;

          for (const position of securityRows.values()) {
            if (position.weightPct == null || !Number.isFinite(position.weightPct)) {
              hasMissingWeight = true;
            } else {
              totalWeight += position.weightPct;
            }
            if (position.sharesNumber == null || !Number.isFinite(position.sharesNumber)) {
              hasMissingShares = true;
            } else {
              totalShares += position.sharesNumber;
            }
            if (position.valueUsd == null || !Number.isFinite(position.valueUsd)) {
              hasMissingValue = true;
            } else {
              totalValueUsd += position.valueUsd;
            }
          }
        }

        return {
          year,
          quarter,
          weightPct: hasMissingWeight ? null : Number(totalWeight.toFixed(3)),
          sharesNumber: hasMissingShares ? null : totalShares,
          valueUsd: hasMissingValue ? null : totalValueUsd,
        };
      })
      .sort((a, b) => a.year * 4 + a.quarter - (b.year * 4 + b.quarter));

    result.set(group.key, history);
  }

  return result;
}
