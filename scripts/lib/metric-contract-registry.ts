export type MetricStatus = "已实现" | "部分" | "缺失" | "排除";

export type DataRequirement = {
  alternatives?: string[][];
  needsPrice?: boolean;
  minYears?: number;
  coverageYears?: number;
  minCoverageRatio?: number;
  noKnownSchema?: boolean;
};

export type MetricContractBasis =
  | "reported"
  | "derived"
  | "modeled"
  | "reported_or_derived";

export type MetricContractRow = {
  section:
    | "general_raw"
    | "general_derived"
    | "capital_allocation"
    | "valuation"
    | "bank"
    | "insurance"
    | "real_estate"
    | "conglomerate"
    | "financial_services"
    | "modifier";
  subsection: string | null;
  name: string;
  definition: string;
  formulaOrRule: string;
  source: string;
  status: MetricStatus;
  gap: string;
  detail: string;
};

export type MetricContractRecord = MetricContractRow & {
  id: string;
  key: string;
  basis: MetricContractBasis;
  roles: ValidationRole[];
  requirement: DataRequirement;
};

export type MetricContractArtifact = {
  version: number;
  source: string;
  metrics: MetricContractRecord[];
};

export function assertMetricContract(
  contract: MetricContractArtifact,
  expectedMetricCount = 99,
) {
  if (contract.version !== 1 || contract.source !== "METRICS.md") {
    throw new Error(
      `Unexpected metric contract header: v${contract.version} from ${contract.source}`,
    );
  }
  if (contract.metrics.length !== expectedMetricCount) {
    throw new Error(
      `Expected ${expectedMetricCount} metric contract rows, got ${contract.metrics.length}`,
    );
  }

  const ids = new Set<string>();
  const keys = new Set<string>();
  for (const metric of contract.metrics) {
    for (const field of [
      "id",
      "key",
      "name",
      "definition",
      "formulaOrRule",
      "source",
      "status",
      "gap",
    ] as const) {
      if (!metric[field]?.trim?.()) {
        throw new Error(
          `Metric contract field ${field} is empty for ${metric.name || metric.id}`,
        );
      }
    }
    if (metric.status === "排除") {
      throw new Error(`Excluded metric leaked into contract: ${metric.name}`);
    }
    if (!metric.roles.length) {
      throw new Error(`Metric contract has no validation role: ${metric.name}`);
    }
    if (
      metric.requirement.coverageYears == null ||
      metric.requirement.coverageYears < 1 ||
      metric.requirement.coverageYears > 5
    ) {
      throw new Error(
        `Metric contract has invalid coverage window: ${metric.name}`,
      );
    }
    if (
      metric.requirement.minCoverageRatio == null ||
      metric.requirement.minCoverageRatio < 0 ||
      metric.requirement.minCoverageRatio > 1
    ) {
      throw new Error(
        `Metric contract has invalid coverage ratio: ${metric.name}`,
      );
    }
    if (ids.has(metric.id)) {
      throw new Error(`Duplicate metric contract id: ${metric.id}`);
    }
    if (keys.has(metric.key)) {
      throw new Error(`Duplicate metric contract key: ${metric.key}`);
    }
    ids.add(metric.id);
    keys.add(metric.key);
  }
}

export type ValidationRole =
  | "consumer_brand"
  | "healthcare"
  | "software_platform"
  | "semiconductor_hardware"
  | "energy_materials"
  | "utilities"
  | "telecommunications"
  | "bank"
  | "property_casualty"
  | "life_health"
  | "asset_mgmt"
  | "broker_exchange"
  | "reit_property"
  | "developer"
  | "conglomerate";

export const VALIDATION_ROLES: ValidationRole[] = [
  "consumer_brand",
  "healthcare",
  "software_platform",
  "semiconductor_hardware",
  "energy_materials",
  "utilities",
  "telecommunications",
  "bank",
  "property_casualty",
  "life_health",
  "asset_mgmt",
  "broker_exchange",
  "reit_property",
  "developer",
  "conglomerate",
];

const INDUSTRIAL_ROLES: ValidationRole[] = [
  "consumer_brand",
  "healthcare",
  "software_platform",
  "semiconductor_hardware",
  "energy_materials",
  "utilities",
  "telecommunications",
];

const CASH_FLOW_ROLES: ValidationRole[] = [
  ...INDUSTRIAL_ROLES,
  "reit_property",
  "developer",
  "conglomerate",
];

const sectionByHeading: Record<string, MetricContractRow["section"]> = {
  "四、通用原始财务指标": "general_raw",
  "五、通用派生指标": "general_derived",
  "六、资本配置指标": "capital_allocation",
  "七、估值指标": "valuation",
  "八、行业专属指标": "bank",
};

const subsectionByHeading: Record<string, MetricContractRow["section"]> = {
  "8.1 银行": "bank",
  "8.2 保险": "insurance",
  "8.3 REITs 与地产": "real_estate",
  "8.4 多元控股": "conglomerate",
  "8.5 金融服务": "financial_services",
  "8.6 工业修饰符": "modifier",
};

export function parseMetricContract(markdown: string): MetricContractRow[] {
  const rows: MetricContractRow[] = [];
  let section: MetricContractRow["section"] | null = null;
  let subsection: string | null = null;
  let isIndustrySection = false;

  for (const line of markdown.split("\n")) {
    if (line.startsWith("## ")) {
      const heading = line.slice(3).trim();
      section = sectionByHeading[heading] ?? null;
      isIndustrySection = heading === "八、行业专属指标";
      subsection = null;
      continue;
    }
    if (line.startsWith("### ")) {
      const heading = line.slice(4).trim();
      if (isIndustrySection && heading.startsWith("8.")) {
        section = subsectionByHeading[heading] ?? section;
        subsection = heading;
      }
      continue;
    }
    if (!section || !line.startsWith("|") || line.startsWith("| ---")) continue;

    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (!cells.length || ["指标", "修饰符", "分类"].includes(cells[0])) continue;

    const status = cells.find((cell): cell is MetricStatus =>
      ["已实现", "部分", "缺失", "排除"].includes(cell),
    );
    if (!status) continue;

    if (section === "modifier") {
      rows.push({
        section,
        subsection,
        name: cells[0],
        definition: cells[1] ?? "",
        formulaOrRule: cells[1] ?? "",
        source: "company disclosure",
        status,
        gap: cells[3] ?? "",
        detail: cells[4] ?? "",
      });
    } else {
      const isDerived =
        section === "general_derived" || section === "capital_allocation";
      rows.push({
        section,
        subsection,
        name: cells[0],
        definition: cells[1] ?? "",
        formulaOrRule: cells[1] ?? "",
        source: isDerived ? `inputs:${cells[2] ?? ""}` : cells[2] ?? "",
        status,
        gap: cells[4] ?? "",
        detail: cells[5] ?? "",
      });
    }
  }

  return rows;
}

export function rolesForMetric(row: MetricContractRow): ValidationRole[] {
  if (row.section === "general_raw") {
    if (["营业成本", "毛利润", "营业利润", "合同负债/预收款"].includes(row.name)) {
      return [...INDUSTRIAL_ROLES, "developer"];
    }
    if (row.name === "研发费用") {
      return [
        "healthcare",
        "software_platform",
        "semiconductor_hardware",
      ];
    }
    if (row.name === "存货/开发成本") {
      return [
        "consumer_brand",
        "healthcare",
        "semiconductor_hardware",
        "energy_materials",
        "developer",
      ];
    }
    if (row.name === "投资性物业") return ["reit_property", "developer"];
    if (
      ["资本开支", "短期有息债务", "长期有息债务", "总有息债务"].includes(
        row.name,
      )
    ) {
      return [...CASH_FLOW_ROLES];
    }
    return [...VALIDATION_ROLES];
  }

  if (row.section === "general_derived") {
    if (["毛利率", "营业利润率"].includes(row.name)) {
      return [...INDUSTRIAL_ROLES, "developer"];
    }
    if (["FCF", "FCF Margin", "现金转化率", "净负债率"].includes(row.name)) {
      return [...CASH_FLOW_ROLES];
    }
    if (row.name === "ROIC") {
      return [...INDUSTRIAL_ROLES, "developer"];
    }
    return [...VALIDATION_ROLES];
  }

  if (row.section === "capital_allocation") {
    if (
      [
        "完整现金流年度",
        "累计经营现金流",
        "累计资本开支",
        "累计自由现金流",
        "累计并购",
        "并购覆盖率",
        "累计回购",
        "累计分红",
        "股东回报",
        "FCF 扣除分配结余",
      ].includes(row.name)
    ) {
      return [...CASH_FLOW_ROLES];
    }
    return [...VALIDATION_ROLES];
  }

  if (row.section === "valuation") {
    if (row.name === "FCF Yield") {
      return [...CASH_FLOW_ROLES];
    }
    return [...VALIDATION_ROLES];
  }

  if (row.section === "bank") return ["bank"];

  if (row.section === "insurance") {
    if (["EV", "NBV", "新业务价值率"].includes(row.name)) {
      return ["life_health"];
    }
    if (["赔付率", "综合成本率"].includes(row.name)) {
      return ["property_casualty"];
    }
    return ["life_health", "property_casualty"];
  }

  if (row.section === "real_estate") {
    if (["合同负债", "存货/开发成本"].includes(row.name)) return ["developer"];
    return ["reit_property"];
  }

  if (row.section === "conglomerate") return ["conglomerate"];

  if (row.section === "financial_services") {
    if (row.name === "手续费及佣金净收入") {
      return ["asset_mgmt", "broker_exchange"];
    }
    return ["asset_mgmt"];
  }

  if (row.section === "modifier") {
    const roleByMetric: Partial<Record<string, ValidationRole>> = {
      消费品牌: "consumer_brand",
      医药健康: "healthcare",
      软件平台: "software_platform",
      半导体硬件: "semiconductor_hardware",
      能源材料: "energy_materials",
      公用事业: "utilities",
      电信: "telecommunications",
    };
    const role = roleByMetric[row.name];
    return role ? [role] : [];
  }

  return [];
}
