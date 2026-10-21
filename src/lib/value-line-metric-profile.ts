import type { FinancialModelResolution } from "@/lib/financial-model";
import { buildFinancialServicesMetricCard } from "@/lib/financial-services-metrics";
import { isPeriodEndShareSource } from "@/lib/share-count-utils";

export type ValueLineMetricAnnual = {
  year: number;
  revenue?: number | null;
  netIncome?: number | null;
  operatingCashFlow?: number | null;
  freeCashFlow?: number | null;
  shareholdersEquity?: number | null;
  totalAssets?: number | null;
  eps?: number | null;
  shares?: number | null;
  sharesSource?: "disclosed" | "disclosed_period_end" | "weighted_average" | "derived" | null;
  dividendsPaid?: number | null;
  assetsUnderManagement?: number | null;
  netClientFlows?: number | null;
  investmentManagementFeeIncome?: number | null;
  netFeeAndCommissionIncome?: number | null;
  netPremiumsEarned?: number | null;
  policyClaimsAndBenefits?: number | null;
  investmentIncome?: number | null;
  totalInvestments?: number | null;
  contractLiabilities?: number | null;
  inventory?: number | null;
  operatingIncome?: number | null;
  investmentProperty?: number | null;
};

export type ValueLineMetricCard = {
  key: string;
  title: string;
  value: string;
  badge: string;
  badgeClass: string;
  subText: string;
};

export type ValueLineMetricProfile = {
  operatingMetric: ValueLineMetricCard;
  growthMetrics: ValueLineMetricCard[];
};

type GrowthSeries = {
  key: string;
  title: string;
  subText?: string;
  value: (annual: ValueLineMetricAnnual) => number | null | undefined;
  allowTurnaround?: boolean;
};

function finite(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

function average(values: number[]) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function recentAnnuals(annuals: ValueLineMetricAnnual[]) {
  return [...annuals].sort((a, b) => a.year - b.year).slice(-5);
}

function cagrValue(
  annuals: ValueLineMetricAnnual[],
  getValue: GrowthSeries["value"],
) {
  const rows = recentAnnuals(annuals);
  const first = rows.find((row) => finite(getValue(row)));
  const last = [...rows].reverse().find((row) => finite(getValue(row)));
  if (!first || !last || first.year >= last.year) return null;

  const firstValue = getValue(first)!;
  const lastValue = getValue(last)!;
  const span = last.year - first.year;
  if (firstValue <= 0 || lastValue <= 0) return null;
  return Number((((lastValue / firstValue) ** (1 / span) - 1) * 100).toFixed(1));
}

function growthBadge(value: number | null) {
  if (value == null) return { badge: "趋势观察", badgeClass: "vl-badge--neutral" };
  if (value >= 15) return { badge: "高速增长", badgeClass: "vl-badge--stellar" };
  if (value >= 10) return { badge: "稳健增长", badgeClass: "vl-badge--solid" };
  if (value >= 5) return { badge: "温和增长", badgeClass: "vl-badge--neutral" };
  if (value < 0) return { badge: "负增长", badgeClass: "vl-badge--alert" };
  return { badge: "增长平稳", badgeClass: "vl-badge--neutral" };
}

function makeGrowthCard(
  annuals: ValueLineMetricAnnual[],
  series: GrowthSeries,
): ValueLineMetricCard | null {
  const value = cagrValue(annuals, series.value);
  if (value == null && series.allowTurnaround) {
    const points = recentAnnuals(annuals)
      .map((annual) => ({ annual, value: series.value(annual) }))
      .filter(
        (point): point is { annual: ValueLineMetricAnnual; value: number } =>
          finite(point.value),
      );
    const first = points[0];
    const last = points[points.length - 1];
    if (first && last && first.annual.year < last.annual.year) {
      let label: string;
      if (first.value <= 0 && last.value > 0) {
        label = "扭亏为盈";
      } else if (first.value > 0 && last.value <= 0) {
        label = "由盈转亏";
      } else if (last.value > first.value) {
        label = "持续减亏";
      } else if (last.value < first.value) {
        label = "持续亏损";
      } else {
        label = "盈亏持平";
      }

      return {
        key: series.key,
        title: series.title,
        value: label,
        badge: first.value <= 0 && last.value > 0 ? "盈利改善" : "趋势观察",
        badgeClass:
          first.value > 0 && last.value <= 0
            ? "vl-badge--alert"
            : "vl-badge--neutral",
        subText: `${first.annual.year}–${last.annual.year} 盈利变化`,
      };
    }
  }
  if (value == null) return null;
  const badge = growthBadge(value);
  return {
    key: series.key,
    title: series.title,
    value: `${value > 0 ? "+" : ""}${value}%`,
    badge: badge.badge,
    badgeClass: badge.badgeClass,
    subText: series.subText ?? "复合增速 (CAGR)",
  };
}

function selectGrowthMetrics(
  annuals: ValueLineMetricAnnual[],
  slots: GrowthSeries[][],
) {
  const selectedKeys = new Set<string>();
  const metrics: ValueLineMetricCard[] = [];
  for (const [slotIndex, candidates] of slots.entries()) {
    let selectedMetric: ValueLineMetricCard | null = null;
    for (const candidate of candidates) {
      if (selectedKeys.has(candidate.key)) continue;
      const metric = makeGrowthCard(annuals, candidate);
      if (!metric) continue;
      selectedMetric = metric;
      break;
    }

    if (selectedMetric) {
      metrics.push(selectedMetric);
      selectedKeys.add(selectedMetric.key);
      continue;
    }

    const primary = candidates[0];
    if (!primary) continue;
    metrics.push({
      key: `${primary.key}-unavailable-${slotIndex}`,
      title: primary.title,
      value: "—",
      badge: "趋势观察",
      badgeClass: "vl-badge--neutral",
      subText: primary.subText ?? "复合增速 (CAGR)",
    });
  }
  return metrics;
}

function unavailableOperatingMetric(
  model: FinancialModelResolution,
): ValueLineMetricCard {
  let title = "现金转化率";
  let subText = "经营现金流 / 净利润";

  if (model.template === "bank") {
    title = "5年 ROA 均值";
    subText = "净利润 / 平均总资产";
  } else if (model.template === "insurance") {
    title =
      model.subModel === "property_casualty" ? "5年赔付率" : "5年投资回报率";
    subText =
      model.subModel === "property_casualty"
        ? "赔付及保单利益 / 净已赚保费"
        : "投资收益 / 平均投资资产";
  } else if (model.template === "financial_services") {
    title = "5年净利率";
    subText = "净利润 / 营收";
  } else if (model.template === "real_estate") {
    title =
      model.subModel === "reit_property"
        ? "物业经营回报"
        : "合同负债 / 营收";
    subText =
      model.subModel === "reit_property"
        ? "经营利润 / 投资性房地产"
        : "预售合同负债 / 年度营收";
  } else if (model.template === "conglomerate") {
    title = "综合现金造血";
    subText = "合并经营现金流 / 净利润";
  }

  return {
    key: "operating-metric-unavailable",
    title,
    value: "—",
    badge: "趋势观察",
    badgeClass: "vl-badge--neutral",
    subText,
  };
}

function rateOfReturn(
  annuals: ValueLineMetricAnnual[],
  numerator: (annual: ValueLineMetricAnnual) => number | null | undefined,
  denominator: (annual: ValueLineMetricAnnual) => number | null | undefined,
) {
  const rows = recentAnnuals(annuals);
  const rates: number[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const prior = rows[index - 1];
    const current = rows[index];
    const opening = denominator(prior);
    const closing = denominator(current);
    const income = numerator(current);
    if (
      current.year !== prior.year + 1 ||
      !finite(opening) ||
      !finite(closing) ||
      !finite(income) ||
      opening <= 0 ||
      closing <= 0
    ) {
      continue;
    }
    rates.push((income / ((opening + closing) / 2)) * 100);
  }
  return average(rates);
}

function percentageCard(
  key: string,
  title: string,
  value: number | null,
  subText: string,
  badge = "行业指标",
): ValueLineMetricCard | null {
  if (value == null || !Number.isFinite(value)) return null;
  return {
    key,
    title,
    value: `${value.toFixed(1)}%`,
    badge,
    badgeClass: "vl-badge--neutral",
    subText,
  };
}

function returnOnAssets(annuals: ValueLineMetricAnnual[]) {
  return rateOfReturn(annuals, (annual) => annual.netIncome, (annual) => annual.totalAssets);
}

function operatingMetric(
  model: FinancialModelResolution,
  annuals: ValueLineMetricAnnual[],
  options: {
    cashConversionRatio?: number | null;
    currencySymbol?: string;
  },
): ValueLineMetricCard | null {
  const rows = recentAnnuals(annuals);
  const latest = [...annuals].sort((a, b) => b.year - a.year)[0];
  const roa = returnOnAssets(annuals);

  if (model.template === "bank") {
    const latestRoa =
      latest &&
      finite(latest.netIncome) &&
      finite(latest.totalAssets) &&
      latest.totalAssets > 0
        ? (latest.netIncome / latest.totalAssets) * 100
        : null;
    return (
      percentageCard(
        "roa",
        "5年 ROA 均值",
        roa,
        "净利润 / 平均总资产",
        "资产回报",
      ) ??
      percentageCard(
        "roa-latest",
        `FY${latest?.year ?? ""} ROA`,
        latestRoa,
        "净利润 / 期末总资产",
        "当年资产回报",
      )
    );
  }

  if (model.template === "insurance") {
    if (model.subModel === "property_casualty") {
      const disclosedClaims = rows.filter(
        (annual) =>
          finite(annual.netPremiumsEarned) &&
          annual.netPremiumsEarned > 0 &&
          finite(annual.policyClaimsAndBenefits),
      );
      const claims = disclosedClaims
        .map((annual) => Math.abs(annual.policyClaimsAndBenefits!))
        .reduce((sum, value) => sum + value, 0);
      const premiums = disclosedClaims
        .map((annual) => annual.netPremiumsEarned!)
        .reduce((sum, value) => sum + value, 0);
      if (premiums > 0) {
        return percentageCard(
          "claims-ratio",
          "5年赔付率",
          (claims / premiums) * 100,
          "赔付及保单利益 / 净已赚保费",
          "承保质量",
        );
      }
    }

    const investmentYield = rateOfReturn(
      annuals,
      (annual) => annual.investmentIncome,
      (annual) => annual.totalInvestments,
    );
    const latestInvestmentYield =
      latest &&
      finite(latest.investmentIncome) &&
      finite(latest.totalInvestments) &&
      latest.totalInvestments > 0
        ? (latest.investmentIncome / latest.totalInvestments) * 100
        : null;
    return (
      percentageCard(
        "investment-yield",
        "5年投资回报率",
        investmentYield,
        "投资收益 / 平均投资资产",
        "投资质量",
      ) ??
      percentageCard(
        "investment-yield-latest",
        `FY${latest?.year ?? ""} 投资回报率`,
        latestInvestmentYield,
        "投资收益 / 期末投资资产",
        "当年投资回报",
      ) ??
      percentageCard("roa", "5年 ROA 均值", roa, "净利润 / 平均总资产", "资产回报")
    );
  }

  if (model.template === "financial_services") {
    const serviceMetric = buildFinancialServicesMetricCard(
      annuals.map((annual) => ({ ...annual, year: annual.year })),
      options.currencySymbol ?? "",
    );
    if (serviceMetric.applicable) {
      return {
        key: "financial-services",
        title: serviceMetric.title,
        value: serviceMetric.mainNum,
        badge: serviceMetric.badge,
        badgeClass: "vl-badge--neutral",
        subText: serviceMetric.subText,
      };
    }
    const margins = rows
      .filter(
        (annual) =>
          finite(annual.netIncome) &&
          finite(annual.revenue) &&
          annual.revenue > 0,
      )
      .map((annual) => (annual.netIncome! / annual.revenue!) * 100);
    return percentageCard(
      "net-margin",
      "5年净利率",
      average(margins),
      "净利润 / 营收",
      "盈利能力",
    );
  }

  if (model.template === "real_estate" && latest) {
    if (model.subModel === "reit_property") {
      const propertyReturn =
        finite(latest.operatingIncome) &&
        finite(latest.investmentProperty) &&
        latest.investmentProperty > 0
          ? (latest.operatingIncome / latest.investmentProperty) * 100
          : null;
      return (
        percentageCard(
          "property-operating-return",
          "物业经营回报",
          propertyReturn,
          "经营利润 / 投资性房地产",
          "物业运营",
        ) ??
        percentageCard("roa", "5年 ROA 均值", roa, "净利润 / 平均总资产", "资产回报")
      );
    }

    const contractCoverage =
      finite(latest.contractLiabilities) &&
      finite(latest.revenue) &&
      latest.revenue > 0
        ? (latest.contractLiabilities / latest.revenue) * 100
        : null;
    const inventoryCoverage =
      finite(latest.inventory) &&
      finite(latest.revenue) &&
      latest.revenue > 0
        ? (latest.inventory / latest.revenue) * 100
        : null;
    return (
      percentageCard(
        "contract-coverage",
        "合同负债 / 营收",
        contractCoverage,
        "预售合同负债 / 年度营收",
        "预售覆盖",
      ) ??
      percentageCard(
        "inventory-coverage",
        "存货 / 营收",
        inventoryCoverage,
        "存货规模 / 年度营收",
        "库存规模",
      ) ??
      percentageCard("roa", "5年 ROA 均值", roa, "净利润 / 平均总资产", "资产回报")
    );
  }

  const pairedCashFlows = rows.filter(
    (annual) => finite(annual.operatingCashFlow) && finite(annual.netIncome),
  );
  const netIncome = pairedCashFlows.reduce(
    (sum, annual) => sum + annual.netIncome!,
    0,
  );
  const operatingCashFlow = pairedCashFlows.reduce(
    (sum, annual) => sum + annual.operatingCashFlow!,
    0,
  );
  if (pairedCashFlows.length && netIncome > 0 && operatingCashFlow > 0) {
    const ratio = options.cashConversionRatio ?? operatingCashFlow / netIncome;
    const specialIndustry =
      model.sectorModelType === "utilities"
        ? { title: "特许现金造血", subText: "经营现金流 / 净利润" }
        : model.sectorModelType === "energy_materials"
          ? { title: "周期现金造血", subText: "经营现金流 / 净利润 · 受行业周期影响" }
          : model.template === "conglomerate"
            ? { title: "综合现金造血", subText: "合并经营现金流 / 净利润" }
            : { title: "现金转化率", subText: "经营现金流 / 净利润" };
    return {
      key: "cash-conversion",
      title: specialIndustry.title,
      value: `${ratio.toFixed(2)}x`,
      badge: ratio >= 1 ? "现金覆盖良好" : "现金转化偏弱",
      badgeClass: ratio >= 1 ? "vl-badge--cash" : "vl-badge--neutral",
      subText: specialIndustry.subText,
    };
  }

  return percentageCard(
    "net-margin",
    "5年净利率",
    average(
      rows
        .filter(
          (annual) =>
            finite(annual.netIncome) &&
            finite(annual.revenue) &&
            annual.revenue > 0,
        )
        .map((annual) => (annual.netIncome! / annual.revenue!) * 100),
    ),
    "净利润 / 营收",
    "盈利能力",
  );
}

function perShareDividend(annual: ValueLineMetricAnnual) {
  if (
    !finite(annual.dividendsPaid) ||
    !finite(annual.shares) ||
    !isPeriodEndShareSource(annual.sharesSource) ||
    annual.shares <= 0 ||
    annual.dividendsPaid === 0
  ) {
    return null;
  }
  return Math.abs(annual.dividendsPaid) / annual.shares;
}

function growthMetrics(
  model: FinancialModelResolution,
  annuals: ValueLineMetricAnnual[],
) {
  const revenue: GrowthSeries = {
    key: "revenue",
    title: "营收增长",
    value: (annual) => annual.revenue,
  };
  const netIncome: GrowthSeries = {
    key: "net-income",
    title: "净利润增长",
    value: (annual) => annual.netIncome,
    allowTurnaround: true,
  };
  const eps: GrowthSeries = {
    key: "eps",
    title: "每股收益增长",
    value: (annual) => annual.eps,
  };
  const operatingCashFlow: GrowthSeries = {
    key: "operating-cash-flow",
    title: "经营现金流增长",
    subText: "复合增速 (CAGR) · 经营现金创造能力",
    value: (annual) => annual.operatingCashFlow,
  };
  const assets: GrowthSeries = {
    key: "assets",
    title: "总资产增长",
    subText: "复合增速 (CAGR) · 业务规模扩张",
    value: (annual) => annual.totalAssets,
  };
  const equity: GrowthSeries = {
    key: "equity",
    title: "股东权益增长",
    subText: "复合增速 (CAGR) · 账面股东权益变化",
    value: (annual) => annual.shareholdersEquity,
  };
  const fcf: GrowthSeries = {
    key: "free-cash-flow",
    title: "自由现金流增长",
    subText: "复合增速 (CAGR) · 经营自由现金流",
    value: (annual) => annual.freeCashFlow,
  };
  const investmentProperty: GrowthSeries = {
    key: "investment-property",
    title: "投资物业增长",
    subText: "复合增速 (CAGR) · 物业资产组合扩张",
    value: (annual) => annual.investmentProperty,
  };
  const operatingIncome: GrowthSeries = {
    key: "operating-income",
    title: "经营利润增长",
    value: (annual) => annual.operatingIncome,
  };
  const contractLiabilities: GrowthSeries = {
    key: "contract-liabilities",
    title: "合同负债增长",
    value: (annual) => annual.contractLiabilities,
  };
  const inventory: GrowthSeries = {
    key: "inventory",
    title: "存货规模增长",
    value: (annual) => annual.inventory,
  };
  const shares: GrowthSeries = {
    key: "shares",
    title: "期末股数变化",
    subText: "5年复合变化率 · 股本稀释或回购",
    value: (annual) =>
      isPeriodEndShareSource(annual.sharesSource) ? annual.shares : null,
  };
  const totalDistributions: GrowthSeries = {
    key: "total-distributions",
    title: "现金分红增长",
    value: (annual) =>
      finite(annual.dividendsPaid) ? Math.abs(annual.dividendsPaid) : null,
  };

  let slots: GrowthSeries[][];
  switch (model.template) {
    case "bank":
      slots = [
        [netIncome, revenue],
        [eps, revenue, assets],
        [assets, equity],
        [equity, assets, shares],
      ];
      break;
    case "insurance": {
      const premiums: GrowthSeries = {
        key: "premiums",
        title: "已赚保费增长",
        value: (annual) => annual.netPremiumsEarned,
      };
      slots = [
        [premiums, assets, revenue],
        [netIncome, eps, revenue],
        [eps, assets, revenue],
        [equity, assets, shares],
      ];
      break;
    }
    case "financial_services": {
      const aum: GrowthSeries = {
        key: "aum",
        title: "管理资产规模增长",
        value: (annual) => annual.assetsUnderManagement,
      };
      const managementFees: GrowthSeries = {
        key: "management-fees",
        title: "管理费收入增长",
        value: (annual) => annual.investmentManagementFeeIncome,
      };
      const netFees: GrowthSeries = {
        key: "net-fees",
        title: "手续费收入增长",
        value: (annual) => annual.netFeeAndCommissionIncome,
      };
      const servicesScale: GrowthSeries = {
        key: "service-scale",
        title: "业务规模增长",
        value: (annual) => annual.totalAssets,
      };
      const servicesRevenue: GrowthSeries = {
        ...revenue,
        key: "service-revenue",
      };
      if (model.subModel === "asset_mgmt") {
        slots = [
          [aum, servicesRevenue],
          [managementFees, netFees, servicesRevenue, servicesScale],
          [netIncome, eps, servicesRevenue],
          [eps, equity, shares],
        ];
      } else {
        slots = [
          [netFees, servicesRevenue],
          [servicesRevenue, servicesScale],
          [netIncome, eps, servicesRevenue],
          [eps, equity, shares],
        ];
      }
      break;
    }
    case "real_estate":
      if (model.subModel === "reit_property") {
        const dividendPerShare: GrowthSeries = {
          key: "dividend-per-share",
          title: "每股已实施分红增长",
          subText: "按年度已实施分红 / 期末股数计算",
          value: perShareDividend,
        };
        const reitOperatingIncome: GrowthSeries = {
          ...operatingIncome,
          title: "物业经营收益增长",
        };
        slots = [
          [revenue, reitOperatingIncome, assets],
          [dividendPerShare, reitOperatingIncome, totalDistributions],
          [investmentProperty, assets],
          [equity, assets, shares],
        ];
      } else {
        slots = [
          [revenue, contractLiabilities, inventory],
          [netIncome, operatingIncome, eps],
          [assets, inventory, contractLiabilities],
          [equity, assets, shares],
        ];
      }
      break;
    case "conglomerate":
      slots = [
        [revenue, operatingIncome, assets],
        [netIncome, eps],
        [fcf, operatingCashFlow],
        [equity, assets, shares],
      ];
      break;
    default:
      slots = [
        [revenue, operatingIncome, assets],
        [netIncome, eps, operatingCashFlow],
        [fcf, operatingCashFlow, revenue],
        [equity, assets, shares],
      ];
      break;
  }

  return selectGrowthMetrics(annuals, slots);
}

export function buildValueLineMetricProfile(
  model: FinancialModelResolution,
  annuals: ValueLineMetricAnnual[],
  options: {
    cashConversionRatio?: number | null;
    currencySymbol?: string;
  } = {},
): ValueLineMetricProfile {
  return {
    operatingMetric:
      operatingMetric(model, annuals, options) ??
      unavailableOperatingMetric(model),
    growthMetrics: growthMetrics(model, annuals),
  };
}
