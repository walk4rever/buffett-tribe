export type AnnualEps = {
  year: number;
  eps: number | null;
  disclosedAt?: string | null;
};

export type HistoricalPrice = {
  date: string;
  close: number;
};

export type HistoricalPePoint = HistoricalPrice & {
  eps: number;
  pe: number;
};

export type HistoricalPeMetrics = {
  peMin: number | null;
  peMedian: number | null;
  peMax: number | null;
  currentPercentile: number | null;
  sampleCount: number;
};

export function getAnnualEpsAvailableOnDate(
  annuals: AnnualEps[],
  date: string,
): AnnualEps | null {
  const priceYear = Number(date.slice(0, 4));
  if (!Number.isFinite(priceYear)) return null;

  return annuals
    .filter((annual) => {
      if (
        !Number.isFinite(annual.year) ||
        annual.eps == null ||
        !Number.isFinite(annual.eps) ||
        annual.eps <= 0
      ) {
        return false;
      }
      if (!annual.disclosedAt) return annual.year < priceYear;
      const disclosedAt = new Date(annual.disclosedAt);
      return !Number.isNaN(disclosedAt.getTime()) &&
        disclosedAt.toISOString().slice(0, 10) <= date;
    })
    .sort((a, b) => a.year - b.year)
    .at(-1) ?? null;
}

export function buildHistoricalPeSeries(
  prices: HistoricalPrice[],
  annuals: AnnualEps[],
): HistoricalPePoint[] {
  const validAnnuals = annuals
    .filter(
      (annual) =>
        Number.isFinite(annual.year) &&
        annual.eps != null &&
        Number.isFinite(annual.eps) &&
        annual.eps > 0,
    )
    .slice()
    .sort((a, b) => a.year - b.year);

  return prices.flatMap((price) => {
    if (!Number.isFinite(price.close) || price.close <= 0) {
      return [];
    }

    const annual = getAnnualEpsAvailableOnDate(validAnnuals, price.date);
    if (!annual?.eps) return [];

    const pe = price.close / annual.eps;
    if (!Number.isFinite(pe) || pe <= 2 || pe >= 300) return [];
    return [{ ...price, eps: annual.eps, pe }];
  });
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 0
    ? (values[middle - 1] + values[middle]) / 2
    : values[middle];
}

export function computeHistoricalPeMetrics(
  series: Array<{ pe: number }>,
  currentPe: number | null,
): HistoricalPeMetrics {
  const values = series
    .map((point) => point.pe)
    .filter((pe) => Number.isFinite(pe) && pe > 0)
    .sort((a, b) => a - b);

  if (!values.length) {
    return {
      peMin: null,
      peMedian: null,
      peMax: null,
      currentPercentile: null,
      sampleCount: 0,
    };
  }

  const percentileIndex = (pct: number) =>
    Math.min(values.length - 1, Math.floor((values.length - 1) * pct));
  const below = currentPe != null && currentPe > 0
    ? values.filter((pe) => pe <= currentPe).length
    : null;

  return {
    peMin: Number(values[percentileIndex(0.05)].toFixed(1)),
    peMedian: Number(median(values)!.toFixed(1)),
    peMax: Number(values[percentileIndex(0.95)].toFixed(1)),
    currentPercentile:
      below == null ? null : Number(((below / values.length) * 100).toFixed(0)),
    sampleCount: values.length,
  };
}

export function computeAnnualEpsGrowthPct(annuals: AnnualEps[]): number | null {
  const validAnnuals = annuals
    .filter(
      (annual) =>
        Number.isFinite(annual.year) &&
        annual.eps != null &&
        Number.isFinite(annual.eps) &&
        annual.eps > 0,
    )
    .slice()
    .sort((a, b) => a.year - b.year);
  const first = validAnnuals[0];
  const last = validAnnuals.at(-1);
  if (!first?.eps || !last?.eps || first.year === last.year) return null;

  const years = last.year - first.year;
  return Number((((last.eps / first.eps) ** (1 / years) - 1) * 100).toFixed(1));
}
