import { formatUsdInYi } from "@/lib/currency";

export type FinancialServicesAnnualMetrics = {
  year: number;
  assetsUnderManagement?: number | null;
  netClientFlows?: number | null;
  investmentManagementFeeIncome?: number | null;
  netFeeAndCommissionIncome?: number | null;
};

export type FinancialServicesMetricCard = {
  applicable: boolean;
  title: string;
  badge: string;
  mainNum: string;
  subText: string;
};

export function buildFinancialServicesMetricCard(
  annuals: FinancialServicesAnnualMetrics[],
  currencySymbol: string,
): FinancialServicesMetricCard {
  const latestWith = (
    key: keyof Omit<FinancialServicesAnnualMetrics, "year">,
  ) => [...annuals]
    .sort((a, b) => b.year - a.year)
    .find((annual) => annual[key] != null) ?? null;

  const aum = latestWith("assetsUnderManagement");
  const flows = latestWith("netClientFlows");
  const managementFees = latestWith("investmentManagementFeeIncome");
  const netFees = latestWith("netFeeAndCommissionIncome");
  const primary = aum ?? flows ?? managementFees ?? netFees;
  if (!primary) {
    return { applicable: false, title: "", badge: "", mainNum: "", subText: "" };
  }

  const amount = (value: number | null | undefined) => {
    if (value == null || !Number.isFinite(value)) return "—";
    const formatted = Math.abs(value) >= 1e12
      ? `${(value / 1e12).toFixed(1)}万亿`
      : formatUsdInYi(value);
    return `${currencySymbol}${formatted}`;
  };
  const primaryValue =
    aum?.assetsUnderManagement ??
    flows?.netClientFlows ??
    managementFees?.investmentManagementFeeIncome ??
    netFees?.netFeeAndCommissionIncome;
  const title = aum
    ? "管理资产规模"
    : flows
      ? "客户资产净流量"
      : managementFees
        ? "资产管理费收入"
        : "手续费及佣金净收入";
  const isNonStandardDisclosure = Boolean(aum || (!aum && flows));
  const subText = [
    aum ? `FY${aum.year} 期末客户管理资产（公司披露）` : null,
    flows ? `FY${flows.year} 净流入 ${amount(flows.netClientFlows)}（公司披露）` : null,
    managementFees
      ? `FY${managementFees.year} 管理费 ${amount(managementFees.investmentManagementFeeIncome)}`
      : null,
    netFees
      ? `FY${netFees.year} 手续费净收入 ${amount(netFees.netFeeAndCommissionIncome)}`
      : null,
  ]
    .filter((part): part is string => part != null)
    .join(" · ");

  return {
    applicable: true,
    title,
    badge: isNonStandardDisclosure ? `FY${primary.year} · 公司披露` : `FY${primary.year}`,
    mainNum: amount(primaryValue),
    subText,
  };
}
