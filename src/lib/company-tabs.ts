export type CompanyTabDefinition = {
  id: string;
  label: string;
  desc: string;
  disabled?: boolean;
};

type CompanyTabOptions = {
  market: string | null;
  hasBusinessCanvas: boolean;
  hasRealMoat: boolean;
  hasCapitalAllocation: boolean;
  hasValuation: boolean;
  showDeepAnalysisButton: boolean;
};

export function buildCompanyTabs({
  market,
  hasBusinessCanvas,
  hasRealMoat,
  hasCapitalAllocation,
  hasValuation,
  showDeepAnalysisButton,
}: CompanyTabOptions): CompanyTabDefinition[] {
  const tabs: CompanyTabDefinition[] = [
    { id: "valueline", label: "价值线", desc: "数字价值线核心全景" },
    {
      id: "business",
      label: "商业模式",
      desc: "九宫格商业模式画布",
      ...(!hasBusinessCanvas ? { disabled: true } : {}),
    },
    {
      id: "value",
      label: "竞争优势",
      desc: "护城河雷达与资本回报",
      ...(!hasRealMoat ? { disabled: true } : {}),
    },
    { id: "financial", label: "财务分析", desc: "年度趋势与明细" },
    {
      id: "management",
      label: "资本配置",
      desc: "资本去向与股东回报纪律",
      ...(!hasCapitalAllocation ? { disabled: true } : {}),
    },
    {
      id: "valuation",
      label: "估值分析",
      desc: "历史分位与情景推演",
      ...(!hasValuation ? { disabled: true } : {}),
    },
  ];

  if (market === "us") {
    tabs.push({
      id: "holdings",
      label: "13F持仓",
      desc: "机构与大师季度动向",
    });
  }

  return showDeepAnalysisButton ? tabs.filter((tab) => !tab.disabled) : tabs;
}
