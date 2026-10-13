export type ShareCountObservation = {
  year: number;
  shares: number | null;
};

type ShareCountAnnual = {
  year: number;
  shares: number | null;
  sharesSource?: string | null;
};

const isPeriodEndShareCount = (
  annual: ShareCountAnnual | undefined,
): annual is ShareCountAnnual & { shares: number } =>
  annual?.sharesSource === "disclosed_period_end" &&
  annual.shares != null &&
  Number.isFinite(annual.shares) &&
  annual.shares > 0;

export function getLatestPeriodEndShares(
  annuals: ShareCountAnnual[],
): number | null {
  const latest = annuals
    .filter(isPeriodEndShareCount)
    .sort((a, b) => b.year - a.year)[0];
  return latest?.shares ?? null;
}

export function getPeriodEndShareSeries(
  annuals: ShareCountAnnual[],
): ShareCountObservation[] {
  const years = annuals
    .map((annual) => annual.year)
    .filter((year) => Number.isInteger(year));
  if (!years.length) return [];

  const firstYear = Math.min(...years);
  const lastYear = Math.max(...years);
  const byYear = new Map(annuals.map((annual) => [annual.year, annual]));

  return Array.from({ length: lastYear - firstYear + 1 }, (_, index) => {
    const year = firstYear + index;
    const annual = byYear.get(year);
    return {
      year,
      shares: isPeriodEndShareCount(annual) ? annual.shares : null,
    };
  });
}

export function calculatePeriodEndShareChange(
  annuals: ShareCountAnnual[],
): number | null {
  const series = getPeriodEndShareSeries(annuals);
  if (series.length < 2 || series.some((point) => point.shares == null)) {
    return null;
  }

  const firstShares = series[0].shares!;
  const lastShares = series[series.length - 1].shares!;
  return Number((((lastShares - firstShares) / firstShares) * 100).toFixed(1));
}
