import {
  calculateCapitalAllocationShareChange,
  getCapitalAllocationShareSeries,
} from "@/lib/share-count-utils";

export type CapitalAllocationAnnualInput = {
  year: number;
  netIncome?: number | null;
  operatingCashFlow: number | null;
  capEx: number | null;
  repurchaseAmt: number | null;
  dividendsPaid: number | null;
  acquisitionsAmt?: number | null;
  shares: number | null;
  sharesSource?: "disclosed" | "disclosed_period_end" | "weighted_average" | "derived" | null;
  roe: number | null;
};

export type CapitalAllocationStats = {
  annuals: CapitalAllocationAnnualInput[];
  flowAnnuals: Array<CapitalAllocationAnnualInput & { freeCashFlow: number }>;
  earliestYear: number;
  latestYear: number;
  periodCount: number;
  calendarYearSpan: number;
  flowCoverage: number;
  cumOcf: number | null;
  cumCapEx: number | null;
  cumFcf: number | null;
  cumAcquisitions: number | null;
  acquisitionsCoverage: number;
  flowAcquisitionsCoverage: number;
  flowAcquisitionsComplete: boolean;
  acquisitionsPct: number | null;
  cumNetIncome: number | null;
  netIncomeCoverage: number;
  netIncomeBuybackCoverage: number;
  netIncomeDividendCoverage: number;
  netIncomeDistributionComplete: boolean;
  netIncomeBuybackTotal: number | null;
  netIncomeDividendTotal: number | null;
  retainedEarnings: number | null;
  retainedEarningsPct: number | null;
  shareholderReturnAmt: number | null;
  shareholderReturnPct: number | null;
  netIncomeDividendPayoutPct: number | null;
  netIncomeBuybackPayoutPct: number | null;
  cumBuybacks: number | null;
  cumDividends: number | null;
  buybackCoverage: number;
  dividendCoverage: number;
  flowBuybackCoverage: number;
  flowDividendCoverage: number;
  completeFlowBuybacks: number | null;
  completeFlowDividends: number | null;
  fcfAfterBuybacks: number | null;
  fcfAfterDistributions: number | null;
  distributionScope: "both" | "buyback_only" | "dividend_only" | "none";
  capexPct: number | null;
  buybackPct: number | null;
  dividendPct: number | null;
  fcfPct: number | null;
  sharesStart: number | null;
  sharesEnd: number | null;
  shareDeltaPct: number | null;
  avgRoe: number | null;
};

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function computeCapitalAllocationStats(
  input: CapitalAllocationAnnualInput[],
): CapitalAllocationStats | null {
  const annuals = input
    .filter(
      (annual) =>
        Number.isFinite(annual.year) &&
        (annual.operatingCashFlow != null ||
          annual.capEx != null ||
          annual.roe != null ||
          annual.netIncome != null),
    )
    .slice()
    .sort((a, b) => a.year - b.year)
    .slice(-5);

  if (annuals.length < 2) return null;

  const flowAnnuals = annuals.flatMap((annual) => {
    if (annual.operatingCashFlow == null || annual.capEx == null) return [];
    return [{
      ...annual,
      freeCashFlow: annual.operatingCashFlow - Math.abs(annual.capEx),
    }];
  });

  const flowCoverage = flowAnnuals.length;
  const cumOcf = flowCoverage ? sum(flowAnnuals.map((annual) => annual.operatingCashFlow!)) : null;
  const cumCapEx = flowCoverage ? sum(flowAnnuals.map((annual) => Math.abs(annual.capEx!))) : null;
  const cumFcf = flowCoverage ? sum(flowAnnuals.map((annual) => annual.freeCashFlow)) : null;

  const knownBuybacks = annuals.filter((annual) => annual.repurchaseAmt != null);
  const cumBuybacks = knownBuybacks.length
    ? sum(knownBuybacks.map((annual) => Math.abs(annual.repurchaseAmt!)))
    : null;
  const knownDividends = annuals.filter((annual) => annual.dividendsPaid != null);
  const cumDividends = knownDividends.length
    ? sum(knownDividends.map((annual) => Math.abs(annual.dividendsPaid!)))
    : null;

  const hasCompleteFlowBuybacks =
    flowCoverage > 0 && flowAnnuals.every((annual) => annual.repurchaseAmt != null);
  const hasCompleteFlowDividends =
    flowCoverage > 0 && flowAnnuals.every((annual) => annual.dividendsPaid != null);
  const flowKnownAcquisitions = flowAnnuals.filter(
    (annual) => annual.acquisitionsAmt != null,
  );
  const flowAcquisitionsCoverage = flowKnownAcquisitions.length;
  const flowAcquisitionsComplete =
    flowCoverage > 0 && flowAcquisitionsCoverage === flowCoverage;
  const cumAcquisitions = flowAcquisitionsCoverage
    ? sum(flowKnownAcquisitions.map((annual) => annual.acquisitionsAmt!))
    : null;
  const acquisitionsPct =
    flowAcquisitionsComplete &&
    cumFcf != null &&
    cumAcquisitions != null &&
    cumAcquisitions > 0 &&
    cumFcf > 0
      ? Number(((cumAcquisitions / cumFcf) * 100).toFixed(1))
      : null;
  const flowBuybackCoverage = flowAnnuals.filter(
    (annual) => annual.repurchaseAmt != null,
  ).length;
  const flowDividendCoverage = flowAnnuals.filter(
    (annual) => annual.dividendsPaid != null,
  ).length;
  const completeFlowBuybacks = hasCompleteFlowBuybacks
    ? sum(flowAnnuals.map((annual) => Math.abs(annual.repurchaseAmt!)))
    : null;
  const completeFlowDividends = hasCompleteFlowDividends
    ? sum(flowAnnuals.map((annual) => Math.abs(annual.dividendsPaid!)))
    : null;
  const fcfAfterBuybacks =
    cumFcf != null && completeFlowBuybacks != null
      ? cumFcf - completeFlowBuybacks
      : null;

  let distributionScope: "both" | "buyback_only" | "dividend_only" | "none" = "none";
  let fcfAfterDistributions: number | null = null;

  if (
    cumFcf != null &&
    flowAcquisitionsComplete &&
    completeFlowBuybacks != null &&
    completeFlowDividends != null
  ) {
    distributionScope = "both";
    fcfAfterDistributions =
      cumFcf -
      (cumAcquisitions ?? 0) -
      completeFlowBuybacks -
      completeFlowDividends;
  }

  const capexPct =
    cumOcf != null && cumCapEx != null && cumOcf > 0
      ? Number(((cumCapEx / cumOcf) * 100).toFixed(1))
      : null;
  const fcfPct =
    cumOcf != null && cumFcf != null && cumOcf > 0
      ? Number(((cumFcf / cumOcf) * 100).toFixed(1))
      : null;
  const buybackPct =
    cumFcf != null && completeFlowBuybacks != null && cumFcf > 0
      ? Number(((completeFlowBuybacks / cumFcf) * 100).toFixed(1))
      : null;
  const dividendPct =
    cumFcf != null && completeFlowDividends != null && cumFcf > 0
      ? Number(((completeFlowDividends / cumFcf) * 100).toFixed(1))
      : null;

  const shareSeries = getCapitalAllocationShareSeries(annuals);
  const hasCompleteShareSeries =
    shareSeries.length >= 2 && shareSeries.every((point) => point.shares != null);
  const sharesStart = hasCompleteShareSeries ? shareSeries[0].shares : null;
  const sharesEnd = hasCompleteShareSeries
    ? shareSeries[shareSeries.length - 1].shares
    : null;
  const shareDeltaPct = hasCompleteShareSeries
    ? calculateCapitalAllocationShareChange(annuals)
    : null;

  const roes = annuals
    .map((annual) => annual.roe)
    .filter((roe): roe is number => roe != null && Number.isFinite(roe));

  const netIncomeAnnuals = annuals.filter(
    (annual) => annual.netIncome != null && Number.isFinite(annual.netIncome),
  );
  const cumNetIncome = netIncomeAnnuals.length
    ? sum(netIncomeAnnuals.map((annual) => annual.netIncome!))
    : null;
  const netIncomeCoverage = netIncomeAnnuals.length;
  const netIncomeKnownBuybacks = netIncomeAnnuals.filter(
    (annual) => annual.repurchaseAmt != null,
  );
  const netIncomeKnownDividends = netIncomeAnnuals.filter(
    (annual) => annual.dividendsPaid != null,
  );
  const netIncomeBuybackCoverage = netIncomeKnownBuybacks.length;
  const netIncomeDividendCoverage = netIncomeKnownDividends.length;
  const netIncomeBuybacksComplete =
    netIncomeCoverage > 0 && netIncomeBuybackCoverage === netIncomeCoverage;
  const netIncomeDividendsComplete =
    netIncomeCoverage > 0 && netIncomeDividendCoverage === netIncomeCoverage;
  const netIncomeDistributionComplete =
    netIncomeBuybacksComplete && netIncomeDividendsComplete;
  const netIncomeBuybackTotal = netIncomeBuybacksComplete
    ? sum(netIncomeKnownBuybacks.map((annual) => Math.abs(annual.repurchaseAmt!)))
    : null;
  const netIncomeDividendTotal = netIncomeDividendsComplete
    ? sum(netIncomeKnownDividends.map((annual) => Math.abs(annual.dividendsPaid!)))
    : null;

  const shareholderReturnAmt =
    netIncomeDistributionComplete &&
    netIncomeBuybackTotal != null &&
    netIncomeDividendTotal != null
      ? netIncomeBuybackTotal + netIncomeDividendTotal
      : null;

  const retainedEarnings =
    cumNetIncome != null && shareholderReturnAmt != null
      ? cumNetIncome - shareholderReturnAmt
      : null;

  const retainedEarningsPct =
    cumNetIncome != null && cumNetIncome > 0 && retainedEarnings != null
      ? Number(((retainedEarnings / cumNetIncome) * 100).toFixed(1))
      : null;

  const shareholderReturnPct =
    cumNetIncome != null && cumNetIncome > 0 && shareholderReturnAmt != null
      ? Number(((shareholderReturnAmt / cumNetIncome) * 100).toFixed(1))
      : null;

  const netIncomeDividendPayoutPct =
    cumNetIncome != null &&
    netIncomeDividendTotal != null &&
    cumNetIncome > 0
      ? Number(((netIncomeDividendTotal / cumNetIncome) * 100).toFixed(1))
      : null;

  const netIncomeBuybackPayoutPct =
    cumNetIncome != null &&
    netIncomeBuybackTotal != null &&
    cumNetIncome > 0
      ? Number(((netIncomeBuybackTotal / cumNetIncome) * 100).toFixed(1))
      : null;

  return {
    annuals,
    flowAnnuals,
    earliestYear: annuals[0].year,
    latestYear: annuals.at(-1)!.year,
    periodCount: annuals.length,
    calendarYearSpan: annuals.at(-1)!.year - annuals[0].year + 1,
    flowCoverage,
    cumOcf,
    cumCapEx,
    cumFcf,
    cumNetIncome,
    netIncomeCoverage,
    netIncomeBuybackCoverage,
    netIncomeDividendCoverage,
    netIncomeDistributionComplete,
    netIncomeBuybackTotal,
    netIncomeDividendTotal,
    retainedEarnings,
    retainedEarningsPct,
    shareholderReturnAmt,
    shareholderReturnPct,
    netIncomeDividendPayoutPct,
    netIncomeBuybackPayoutPct,
    cumBuybacks,
    cumDividends,
    cumAcquisitions,
    acquisitionsCoverage: flowAcquisitionsCoverage,
    flowAcquisitionsCoverage,
    flowAcquisitionsComplete,
    acquisitionsPct,
    buybackCoverage: knownBuybacks.length,
    dividendCoverage: knownDividends.length,
    flowBuybackCoverage,
    flowDividendCoverage,
    completeFlowBuybacks,
    completeFlowDividends,
    fcfAfterBuybacks,
    fcfAfterDistributions,
    distributionScope,
    capexPct,
    buybackPct,
    dividendPct,
    fcfPct,
    sharesStart,
    sharesEnd,
    shareDeltaPct,
    avgRoe: roes.length
      ? Number((sum(roes) / roes.length).toFixed(1))
      : null,
  };
}
