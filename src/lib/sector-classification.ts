/**
 * The single persisted sector taxonomy used by classification and valuation.
 */

export type SectorModelType13 =
  | "consumer_brand"
  | "healthcare"
  | "software_platform"
  | "semiconductor_hardware"
  | "industrial"
  | "banks"
  | "insurance"
  | "capital_markets"
  | "real_estate"
  | "energy_materials"
  | "utilities"
  | "telecommunications"
  | "conglomerate";

export interface SectorModel13Info {
  type: SectorModelType13;
  label: string;
  benchmarkPE: number;
  cagrMetrics: string[];
  /** 一句话定义：估值锚 + 装什么。用于拼 LLM prompt 与人工复核。 */
  definition: string;
}

export const SECTOR_MODEL_13_CONFIG: Record<SectorModelType13, SectorModel13Info> = {
  consumer_brand: {
    type: "consumer_brand",
    label: "消费品牌",
    benchmarkPE: 22,
    cagrMetrics: ["营收", "净利润", "自由现金流"],
    definition:
      "品牌溢价与定价权决定毛利率能否长期维持，需求受消费景气而非商品价格驱动。PE 15–25x，看同店增长/量价/毛利率/会员复购。装：食品饮料、酒类、日化、服饰、零售（百货/超市/专业零售）、酒店餐饮、教育、汽车整车及零部件、传媒内容与广告。",
  },
  healthcare: {
    type: "healthcare",
    label: "医药健康",
    benchmarkPE: 20,
    cagrMetrics: ["营收", "净利润", "自由现金流"],
    definition:
      "管线价值与专利悬崖决定远期现金流，研发成败是主要变量；无收入的生物科技不能用 PE。大药厂 PE 15–20x。装：制药、生物科技、医疗器械与耗材、医院与医学检测、CXO、管理式医疗（UNH/CI/CNC）。",
  },
  software_platform: {
    type: "software_platform",
    label: "软件与平台",
    benchmarkPE: 28,
    cagrMetrics: ["营收", "净利润", "自由现金流"],
    definition:
      "用户/收费规模增长加网络效应，轻资产、高毛利、收入可预测；早期看 PS/ARR，成熟期 PE 25–40x。装：SaaS 与企业软件、互联网平台、电商、数字广告、支付网络（V/MA）。",
  },
  semiconductor_hardware: {
    type: "semiconductor_hardware",
    label: "半导体与硬件",
    benchmarkPE: 22,
    cagrMetrics: ["营收", "净利润", "自由现金流"],
    definition:
      "资本开支周期与技术代际决定当期景气位置，利润可周期内剧烈波动；PE 15–30x，周期底部看 PB/PS。装：芯片设计、晶圆制造、半导体设备与材料、电子元器件、通信设备、服务器与硬件 OEM。",
  },
  industrial: {
    type: "industrial",
    label: "工业制造",
    benchmarkPE: 16,
    cagrMetrics: ["营收", "净利润", "自由现金流"],
    definition:
      "订单簿与产能利用率决定收入节奏，需求跟随资本开支与工程周期；PE 12–18x，看 EV/EBITDA 与订单/积压。装：机械、电气设备、航空航天与国防、建筑与工程承包、交通运输（铁路/航运/空运/物流）、人力与项目型专业服务。",
  },
  banks: {
    type: "banks",
    label: "银行",
    benchmarkPE: 10,
    cagrMetrics: ["净利润", "EPS", "股东权益"],
    definition:
      "承担资产负债表风险，净息差与信用成本决定 ROE，估值锚是 PB-ROE 与股息率，不是 PE/S。装：商业银行、储蓄机构、消费信贷与信用卡发行、抵押贷款、信托与融资租赁。",
  },
  insurance: {
    type: "insurance",
    label: "保险",
    benchmarkPE: 12,
    cagrMetrics: ["净利润", "EPS", "股东权益"],
    definition:
      "承保综合成本率加投资收益决定利润，先收保费后赔付形成浮存金；估值看内含价值（EV）、P/B 与综合成本率。装：寿险、财险、再保险、保险经纪。",
  },
  capital_markets: {
    type: "capital_markets",
    label: "资本市场与资管",
    benchmarkPE: 20,
    cagrMetrics: ["营收", "净利润", "自由现金流"],
    definition:
      "收费型轻资产，收入由 AUM 与成交量驱动，不承担大额信用风险，因此估值倍数显著高于银行；PE 15–35x。装：交易所、资产管理公司、券商与投行、评级与金融数据服务、托管银行。",
  },
  real_estate: {
    type: "real_estate",
    label: "地产与 REITs",
    benchmarkPE: 14,
    cagrMetrics: ["营收", "净利润", "股东权益"],
    definition:
      "价值来自存量资产评估值（NAV）与资本化率，对利率高度敏感，利润被折旧与非现金重估扰动；估值锚是 PB/NAV、派息率与 FFO。装：住宅与商业地产开发商、收租型 REITs、地产经纪与服务。",
  },
  energy_materials: {
    type: "energy_materials",
    label: "能源与材料",
    benchmarkPE: 11,
    cagrMetrics: ["营收", "净利润", "自由现金流"],
    definition:
      "产品同质、价格由全球供需决定，利润在周期两端不可年化（高点低 PE、低点高 PE 是常态）；PE 8–12x，周期底部看 PB/EV/EBITDA。装：油气勘探与生产、煤炭、矿业、钢铁、化工、水泥与建材。",
  },
  utilities: {
    type: "utilities",
    label: "公用事业",
    benchmarkPE: 15,
    cagrMetrics: ["营收", "净利润", "自由现金流"],
    definition:
      "受监管特许经营，核准回报率决定收益上限，需求刚性、类债券属性（利率敏感）；PE 13–16x，看股息率与 EV/EBITDA。装：电力发电与输配、燃气、水务、电网、核电、独立发电商。",
  },
  telecommunications: {
    type: "telecommunications",
    label: "电信",
    benchmarkPE: 14,
    cagrMetrics: ["营收", "净利润", "自由现金流"],
    definition:
      "竞争强度决定 ARPU，重资本开支侵蚀自由现金流，价格战常态化；PE 12–18x，看 EV/EBITDA 与自由现金流。装：无线与固网电信运营商、有线电视网络运营、卫星通信运营。注意：电信设备制造归 semiconductor_hardware。",
  },
  conglomerate: {
    type: "conglomerate",
    label: "多元化控股",
    benchmarkPE: 18,
    cagrMetrics: ["营收", "净利润", "账面价值"],
    definition:
      "多元经营或投资控股，资产加总后存在控股折价，估值锚是分部估值加总（SOTP）/NAV 与账面价值，而非单一业务倍数。装：业务横跨多个不相关行业的控股公司（伯克希尔、长和、太古、复星）。注意：单一主业加参股按主业归，不算控股。",
  },
};

export const SECTOR_MODEL_13_TYPES = Object.keys(SECTOR_MODEL_13_CONFIG) as SectorModelType13[];

export function isSectorModelType13(value: unknown): value is SectorModelType13 {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(SECTOR_MODEL_13_CONFIG, value);
}

export function getSectorModel13Info(type: SectorModelType13): SectorModel13Info {
  if (!isSectorModelType13(type)) {
    throw new Error(`Unknown 13-way sector model: ${String(type)}`);
  }
  return SECTOR_MODEL_13_CONFIG[type];
}

export function getExplicitSectorModel13Info(value: unknown): SectorModel13Info | null {
  return isSectorModelType13(value) ? SECTOR_MODEL_13_CONFIG[value] : null;
}
