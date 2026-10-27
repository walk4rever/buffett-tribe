import {
  isSectorModelType13,
  type SectorModelType13,
} from "@/lib/sector-classification";

export const FINANCIAL_MODEL_TEMPLATES = [
  "industrial",
  "bank",
  "insurance",
  "financial_services",
  "real_estate",
  "conglomerate",
] as const;

export type FinancialTemplate = (typeof FINANCIAL_MODEL_TEMPLATES)[number];

export type RealEstateSubModel = "reit_property" | "developer";
export type FinancialServicesSubModel = "asset_mgmt" | "broker_exchange";
export type InsuranceSubModel = "property_casualty" | "life_health";

export type FinancialSubModel =
  | RealEstateSubModel
  | FinancialServicesSubModel
  | InsuranceSubModel;

export type FinancialModelModifier =
  | "consumer_brand"
  | "healthcare"
  | "software_platform"
  | "semiconductor_hardware"
  | "energy_materials"
  | "utilities"
  | "telecommunications";

export type FinancialValuationAnchor =
  | "earnings_fcf"
  | "earnings_quality"
  | "pipeline_earnings"
  | "growth_cashflow"
  | "cycle_adjusted_earnings"
  | "pb_roe"
  | "embedded_value_pb"
  | "fee_earnings"
  | "nav_ffo"
  | "normalized_earnings"
  | "regulated_assets"
  | "cashflow_yield"
  | "sotp";

export const PE_PRIMARY_VALUATION_ANCHORS: FinancialValuationAnchor[] = [
  "earnings_fcf",
  "earnings_quality",
  "pipeline_earnings",
  "growth_cashflow",
  "fee_earnings",
];

export type ImplementedValuationMethod = "pe" | "pb";

export type CapitalAllocationModel =
  | "operating_cashflow"
  | "financial_returns"
  | "financial_services_returns"
  | "property_returns"
  | "group_returns";

export type FinancialModelFallbackContext = {
  sector?: string | null;
  industry?: string | null;
  sic?: unknown;
  name?: string | null;
  reason?: string | null;
};

export type FinancialModelResolution = {
  sectorModelType: SectorModelType13 | null;
  template: FinancialTemplate;
  templateLabel: string;
  subModel?: FinancialSubModel | null;
  subModelLabel?: string | null;
  modifiers: FinancialModelModifier[];
  modifierLabels: string[];
  valuationAnchor: FinancialValuationAnchor;
  /** Intended sector-specific valuation model for classification and future work.
   * It is not necessarily the valuation method currently executed by production. */
  valuationAnchorLabel: string;
  capitalAllocationModel: CapitalAllocationModel;
  showIndustrialCashFlow: boolean;
};

type TemplateDefinition = Pick<
  FinancialModelResolution,
  | "templateLabel"
  | "valuationAnchor"
  | "valuationAnchorLabel"
  | "capitalAllocationModel"
  | "showIndustrialCashFlow"
>;

const templateDefinitions: Record<FinancialTemplate, TemplateDefinition> = {
  industrial: {
    templateLabel: "工商业",
    valuationAnchor: "earnings_fcf",
    valuationAnchorLabel: "盈利与自由现金流",
    capitalAllocationModel: "operating_cashflow",
    showIndustrialCashFlow: true,
  },
  bank: {
    templateLabel: "银行",
    valuationAnchor: "pb_roe",
    valuationAnchorLabel: "市净率与 ROE",
    capitalAllocationModel: "financial_returns",
    showIndustrialCashFlow: false,
  },
  insurance: {
    templateLabel: "保险",
    valuationAnchor: "embedded_value_pb",
    valuationAnchorLabel: "内含价值与市净率",
    capitalAllocationModel: "financial_returns",
    showIndustrialCashFlow: false,
  },
  financial_services: {
    templateLabel: "金融服务",
    valuationAnchor: "fee_earnings",
    valuationAnchorLabel: "手续费收入与盈利",
    capitalAllocationModel: "financial_services_returns",
    showIndustrialCashFlow: false,
  },
  real_estate: {
    templateLabel: "房地产与 REITs",
    valuationAnchor: "nav_ffo",
    valuationAnchorLabel: "资产净值与 FFO",
    capitalAllocationModel: "property_returns",
    showIndustrialCashFlow: false,
  },
  conglomerate: {
    templateLabel: "多元控股",
    valuationAnchor: "sotp",
    valuationAnchorLabel: "分部估值加总",
    capitalAllocationModel: "group_returns",
    showIndustrialCashFlow: true,
  },
};

type SectorModelDefinition = {
  template: FinancialTemplate;
  modifier?: FinancialModelModifier;
  valuationAnchor?: FinancialValuationAnchor;
  valuationAnchorLabel?: string;
  capitalAllocationModel?: CapitalAllocationModel;
  showIndustrialCashFlow?: boolean;
};

const sectorModelDefinitions: Record<SectorModelType13, SectorModelDefinition> = {
  consumer_brand: {
    template: "industrial",
    modifier: "consumer_brand",
    valuationAnchor: "earnings_quality",
    valuationAnchorLabel: "盈利质量与定价权",
  },
  healthcare: {
    template: "industrial",
    modifier: "healthcare",
    valuationAnchor: "pipeline_earnings",
    valuationAnchorLabel: "管线与盈利",
  },
  software_platform: {
    template: "industrial",
    modifier: "software_platform",
    valuationAnchor: "growth_cashflow",
    valuationAnchorLabel: "增长与现金流",
  },
  semiconductor_hardware: {
    template: "industrial",
    modifier: "semiconductor_hardware",
    valuationAnchor: "cycle_adjusted_earnings",
    valuationAnchorLabel: "周期调整后盈利",
  },
  industrial: {
    template: "industrial",
  },
  banks: {
    template: "bank",
  },
  insurance: {
    template: "insurance",
  },
  capital_markets: {
    template: "financial_services",
  },
  real_estate: {
    template: "real_estate",
  },
  energy_materials: {
    template: "industrial",
    modifier: "energy_materials",
    valuationAnchor: "normalized_earnings",
    valuationAnchorLabel: "周期中枢盈利",
  },
  utilities: {
    template: "industrial",
    modifier: "utilities",
    valuationAnchor: "regulated_assets",
    valuationAnchorLabel: "监管资产与核准回报",
  },
  telecommunications: {
    template: "industrial",
    modifier: "telecommunications",
    valuationAnchor: "cashflow_yield",
    valuationAnchorLabel: "现金流与资本开支",
  },
  conglomerate: {
    template: "conglomerate",
  },
};

const modifierLabels: Record<FinancialModelModifier, string> = {
  consumer_brand: "消费品牌",
  healthcare: "医药健康",
  software_platform: "软件与平台",
  semiconductor_hardware: "半导体与硬件",
  energy_materials: "能源与材料周期",
  utilities: "受监管公用事业",
  telecommunications: "电信运营",
};

export function inferSubModel(
  template: FinancialTemplate,
  context: FinancialModelFallbackContext,
): { subModel: FinancialSubModel | null; subModelLabel: string | null } {
  const industry = (context.industry ?? "").toLowerCase();
  const text = `${industry} ${context.sector ?? ""} ${context.name ?? ""} ${context.reason ?? ""}`.toLowerCase();

  if (template === "real_estate") {
    // 1. Explicit REITs / trusts
    if (
      text.includes("reit") ||
      text.includes("real estate investment trust") ||
      text.includes("property trust") ||
      text.includes("信托基金") ||
      text.includes("房托")
    ) {
      return { subModel: "reit_property", subModelLabel: "持有型 REITs" };
    }
    // 2. Property development (sales, development, builders)
    if (
      text.includes("develop") ||
      text.includes("builder") ||
      text.includes("开发") ||
      text.includes("物业发展") ||
      text.includes("物业销售") ||
      text.includes("地产销售")
    ) {
      return { subModel: "developer", subModelLabel: "地产开发商" };
    }
    // 3. Commercial holding / rental properties
    if (
      text.includes("收租") ||
      text.includes("商业不动产") ||
      text.includes("物业租赁")
    ) {
      return { subModel: "reit_property", subModelLabel: "持有型 REITs" };
    }
    return { subModel: null, subModelLabel: null };
  }

  if (template === "financial_services") {
    // 1. Brokers and exchanges take precedence (full-service brokerages often have asset management lines)
    if (
      text.includes("broker") ||
      text.includes("exchange") ||
      text.includes("trading") ||
      text.includes("securit") ||
      text.includes("证券") ||
      text.includes("券商") ||
      text.includes("交易所")
    ) {
      return { subModel: "broker_exchange", subModelLabel: "券商与交易所" };
    }
    // 2. Asset management and wealth management
    if (
      text.includes("asset management") ||
      text.includes("wealth management") ||
      text.includes("资管") ||
      text.includes("资产管理") ||
      text.includes("基金")
    ) {
      return { subModel: "asset_mgmt", subModelLabel: "资产管理与财富" };
    }
    return { subModel: null, subModelLabel: null };
  }

  if (template === "insurance") {
    const sic = String(context.sic ?? "");
    // 1. Life, health, and composite financial groups (like Ping An or AIA)
    if (
      sic === "6311" ||
      text.includes("life") ||
      text.includes("health") ||
      text.includes("人寿") ||
      text.includes("寿险") ||
      text.includes("人身险") ||
      text.includes("友邦") ||
      text.includes("综合金融") ||
      text.includes("综合险") ||
      text.includes("内含价值") ||
      (text.includes("平安") && text.includes("保险"))
    ) {
      return { subModel: "life_health", subModelLabel: "人身险与综合险" };
    }
    // 2. Pure property, casualty, and reinsurance (like Progressive PGR)
    if (
      sic === "6331" ||
      text.includes("property") ||
      text.includes("casualty") ||
      text.includes("fire") ||
      text.includes("marine") ||
      text.includes("p&c") ||
      text.includes("财产险") ||
      text.includes("财险") ||
      text.includes("车险")
    ) {
      return { subModel: "property_casualty", subModelLabel: "财产险与再保险" };
    }
    return { subModel: null, subModelLabel: null };
  }

  return { subModel: null, subModelLabel: null };
}

function inferSectorModelType(
  context: FinancialModelFallbackContext,
): SectorModelType13 | null {
  const sic = typeof context.sic === "string"
    ? context.sic
    : String(context.sic ?? "");
  const sector = (context.sector ?? "").toLowerCase();
  const industry = (context.industry ?? "").toLowerCase();

  if (/^60(1|2|3|6|9)/.test(sic) || industry.includes("bank") || industry.includes("银行")) {
    return "banks";
  }
  if (/^63/.test(sic) || industry.includes("insurance") || industry.includes("保险")) {
    return "insurance";
  }
  if (
    industry.includes("real estate") ||
    industry.includes("房地产") ||
    industry.includes("reit")
  ) {
    return "real_estate";
  }
  if (
    industry.includes("conglomerate") ||
    industry.includes("multi-sector") ||
    industry.includes("控股")
  ) {
    return "conglomerate";
  }
  if (
    /^62/.test(sic) ||
    industry.includes("broker") ||
    industry.includes("asset management") ||
    industry.includes("capital market") ||
    industry.includes("证券") ||
    industry.includes("资产管理")
  ) {
    return "capital_markets";
  }
  if (sector.includes("financial")) return "capital_markets";
  return null;
}

export function resolveFinancialModel(
  sectorModelType: unknown,
  fallbackContext: FinancialModelFallbackContext = {},
): FinancialModelResolution | null {
  const resolvedSectorType = isSectorModelType13(sectorModelType)
    ? sectorModelType
    : inferSectorModelType(fallbackContext);
  if (!resolvedSectorType) return null;

  const sectorDefinition = sectorModelDefinitions[resolvedSectorType];
  const templateDefinition = templateDefinitions[sectorDefinition.template];
  const modifiers = sectorDefinition.modifier
    ? [sectorDefinition.modifier]
    : [];
  const { subModel, subModelLabel } = inferSubModel(
    sectorDefinition.template,
    fallbackContext,
  );

  return {
    sectorModelType: resolvedSectorType,
    template: sectorDefinition.template,
    ...templateDefinition,
    subModel,
    subModelLabel,
    modifiers,
    modifierLabels: modifiers.map((modifier) => modifierLabels[modifier]),
    valuationAnchor:
      sectorDefinition.valuationAnchor ?? templateDefinition.valuationAnchor,
    valuationAnchorLabel:
      sectorDefinition.valuationAnchorLabel ??
      templateDefinition.valuationAnchorLabel,
    capitalAllocationModel:
      sectorDefinition.capitalAllocationModel ??
      templateDefinition.capitalAllocationModel,
    showIndustrialCashFlow:
      sectorDefinition.showIndustrialCashFlow ??
      templateDefinition.showIndustrialCashFlow,
  };
}

export function getDefaultFinancialModel(
  template: FinancialTemplate = "industrial",
): FinancialModelResolution {
  return {
    sectorModelType: null,
    ...templateDefinitions[template],
    templateLabel:
      template === "industrial"
        ? "通用工商业"
        : templateDefinitions[template].templateLabel,
    template,
    modifiers: [],
    modifierLabels: [],
  };
}

export function isPePrimaryValuationAnchor(
  anchor: FinancialValuationAnchor,
): boolean {
  return PE_PRIMARY_VALUATION_ANCHORS.includes(anchor);
}

export function getImplementedValuationMethod(
  anchor: FinancialValuationAnchor,
): ImplementedValuationMethod {
  return isPePrimaryValuationAnchor(anchor) ? "pe" : "pb";
}

export function getImplementedValuationLabel(
  anchor: FinancialValuationAnchor,
): "P/E" | "P/B" {
  return getImplementedValuationMethod(anchor) === "pe" ? "P/E" : "P/B";
}
