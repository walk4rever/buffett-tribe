/**
 * Shared sector classification logic for 7-way industry categorization
 * Used by: onboard scripts, batch classification, value-line calculations
 */

export type SectorModelType7 =
  | "consumer_brand"
  | "technology"
  | "industrial"
  | "bank_insurance"
  | "utilities"
  | "cyclical"
  | "conglomerate";

export interface SectorModel7Info {
  type: SectorModelType7;
  label: string;
  benchmarkPE: number;
  cagrMetrics: string[];
}

export const SECTOR_MODEL_7_CONFIG: Record<
  SectorModelType7,
  { label: string; benchmarkPE: number; cagrMetrics: string[] }
> = {
  consumer_brand: {
    label: "消费品牌",
    benchmarkPE: 22,
    cagrMetrics: ["营收", "净利润", "自由现金流"],
  },
  technology: {
    label: "科技平台",
    benchmarkPE: 25,
    cagrMetrics: ["营收", "净利润", "自由现金流"],
  },
  industrial: {
    label: "工业制造",
    benchmarkPE: 16,
    cagrMetrics: ["营收", "净利润", "自由现金流"],
  },
  bank_insurance: {
    label: "银行保险",
    benchmarkPE: 8,
    cagrMetrics: ["营收", "净利润", "总资产"],
  },
  utilities: {
    label: "公用事业",
    benchmarkPE: 14,
    cagrMetrics: ["营收", "净利润", "自由现金流"],
  },
  cyclical: {
    label: "强周期资源",
    benchmarkPE: 10,
    cagrMetrics: ["营收", "净利润", "自由现金流"],
  },
  conglomerate: {
    label: "多元化控股",
    benchmarkPE: 18,
    cagrMetrics: ["营收", "净利润", "账面价值"],
  },
};

export function getSectorModel7Info(type: SectorModelType7): SectorModel7Info {
  const conf = SECTOR_MODEL_7_CONFIG[type] ?? SECTOR_MODEL_7_CONFIG.industrial;
  return {
    type,
    label: conf.label,
    benchmarkPE: conf.benchmarkPE,
    cagrMetrics: conf.cagrMetrics,
  };
}

export function detectSectorModel7(
  sectorRaw?: string | null,
  industryRaw?: string | null,
  nameRaw?: string | null,
): SectorModel7Info {
  const text = `${sectorRaw ?? ""} ${industryRaw ?? ""} ${nameRaw ?? ""}`.toLowerCase();

  // 1. 多元化控股（最优先，以 Berkshire Hathaway、长和、太古等为代表）
  if (
    text.includes("berkshire hathaway") ||
    text.includes("伯克希尔") ||
    (text.includes("conglomerate") &&
      !text.includes("general electric") &&
      !text.includes("通用电气")) ||
    text.includes("diversified holding") ||
    text.includes("综合企业") ||
    text.includes("多元化控股") ||
    text.includes("multi-sector holdings")
  ) {
    return {
      type: "conglomerate",
      label: "多元化控股",
      benchmarkPE: 18,
      cagrMetrics: ["营收", "净利润", "账面价值"],
    };
  }

  // 2. 公用事业（必须排除 GE 等工业制造）
  // 放在周期之前：避免 Duke Energy / NextEra Energy 等公用事业因名称含 "Energy" 被误判为强周期能源
  if (
    !text.includes("general electric") &&
    !text.includes("通用电气") &&
    (text.includes("utilities") ||
      text.includes("utility") ||
      text.includes("electric utilities") ||
      text.includes("electric services") ||
      text.includes("water supply") ||
      text.includes("gas utility") ||
      text.includes("hydropower") ||
      text.includes("natural gas distribution") ||
      text.includes("power generation") ||
      text.includes("公用事业") ||
      text.includes("电力") ||
      text.includes("水务") ||
      text.includes("燃气") ||
      text.includes("热力") ||
      text.includes("水电") ||
      text.includes("电网") ||
      text.includes("核电"))
  ) {
    return {
      type: "utilities",
      label: "公用事业",
      benchmarkPE: 14,
      cagrMetrics: ["营收", "净利润", "自由现金流"],
    };
  }

  // 3. 强周期资源（优先于银行金融：把置于 Financials 下的地产/REITs/建筑商归入周期）
  if (
    // 能源石油天然气煤炭
    text.includes("energy") ||
    text.includes("oil & gas") ||
    text.includes("petroleum") ||
    text.includes("crude petroleum") ||
    text.includes("natural gas") ||
    text.includes("coal") ||
    text.includes("drilling") ||
    text.includes("pipeline") ||
    text.includes("refining") ||
    text.includes("能源") ||
    text.includes("石油") ||
    text.includes("煤炭") ||
    text.includes("油气") ||
    // 大宗材料/矿业/金属/化工
    text.includes("materials") ||
    text.includes("mining") ||
    text.includes("metals") ||
    text.includes("steel") ||
    text.includes("chemical") ||
    text.includes("chemicals") ||
    text.includes("aluminum") ||
    text.includes("copper") ||
    text.includes("iron ore") ||
    text.includes("precious metal") ||
    text.includes("gold mining") ||
    text.includes("cement") ||
    text.includes("lumber") ||
    text.includes("paper") ||
    text.includes("钢铁") ||
    text.includes("化工") ||
    text.includes("有色") ||
    text.includes("矿业") ||
    text.includes("水泥") ||
    text.includes("建材") ||
    text.includes("黄金") ||
    // 房地产与住宅建筑商 (Homebuilders)
    text.includes("real estate") ||
    text.includes("reit") ||
    text.includes("property") ||
    text.includes("properties") ||
    text.includes("operative builders") ||
    text.includes("residential bldgs") ||
    text.includes("building contractors") ||
    text.includes("homebuilder") ||
    text.includes("homebuilding") ||
    text.includes("地产") ||
    text.includes("房地") ||
    text.includes("物业") ||
    text.includes("住宅建筑")
  ) {
    return {
      type: "cyclical",
      label: "强周期资源",
      benchmarkPE: 10,
      cagrMetrics: ["营收", "净利润", "自由现金流"],
    };
  }

  // 4. 银行与保险（金融中介）
  if (
    text.includes("bank") ||
    text.includes("bancorp") ||
    text.includes("commercial bank") ||
    text.includes("savings institution") ||
    text.includes("insurance") ||
    text.includes("life insurance") ||
    text.includes("casualty insurance") ||
    text.includes("reinsurance") ||
    text.includes("insurer") ||
    text.includes("credit") ||
    text.includes("financials") ||
    text.includes("financial") ||
    text.includes("finance") ||
    text.includes("capital market") ||
    text.includes("securities") ||
    text.includes("security broker") ||
    text.includes("brokerage") ||
    text.includes("broker") ||
    text.includes("asset management") ||
    text.includes("wealth management") ||
    text.includes("investment banking") ||
    text.includes("investment advice") ||
    text.includes("loan broker") ||
    text.includes("loan") ||
    text.includes("mortgage") ||
    text.includes("银行") ||
    text.includes("保险") ||
    text.includes("寿险") ||
    text.includes("财险") ||
    text.includes("再保险") ||
    text.includes("券商") ||
    text.includes("证券") ||
    text.includes("信托") ||
    text.includes("金融") ||
    text.includes("基金") ||
    text.includes("资产管理")
  ) {
    return {
      type: "bank_insurance",
      label: "银行保险",
      benchmarkPE: 10,
      cagrMetrics: ["净利润", "EPS", "股东权益"],
    };
  }

  // 5. 科技平台（软硬件、半导体、互联网电商与数字支付）
  if (
    // 软件、云计算与IT服务
    text.includes("technology") ||
    text.includes("software") ||
    text.includes("cloud") ||
    text.includes("saas") ||
    text.includes("computer") ||
    text.includes("data processing") ||
    text.includes("it services") ||
    // 互联网、电商与平台
    text.includes("internet") ||
    text.includes("platform") ||
    text.includes("e-commerce") ||
    text.includes("ecommerce") ||
    text.includes("marketplace") ||
    // 芯片与半导体
    text.includes("semiconductor") ||
    text.includes("chip") ||
    text.includes("chips") ||
    text.includes("electronic computers") ||
    text.includes("printed circuit") ||
    // 通信与网络服务
    text.includes("telecom") ||
    text.includes("telecommunications") ||
    text.includes("communication services") ||
    text.includes("cable & other pay television") ||
    text.includes("broadband") ||
    // 知名互联网平台与金融科技（常处于 SEC SIC 7389 或 sector=null）
    text.includes("alibaba") ||
    text.includes("pinduoduo") ||
    text.includes("pdd") ||
    text.includes("uber") ||
    text.includes("lyft") ||
    text.includes("doordash") ||
    text.includes("grab") ||
    text.includes("mercadolibre") ||
    text.includes("meli") ||
    text.includes("trip.com") ||
    text.includes("booking") ||
    text.includes("expedia") ||
    text.includes("airbnb") ||
    text.includes("zillow") ||
    text.includes("ebay") ||
    text.includes("sea ltd") ||
    text.includes("visa") ||
    text.includes("mastercard") ||
    text.includes("paypal") ||
    text.includes("fiserv") ||
    text.includes("broadridge") ||
    text.includes("accenture") ||
    text.includes("asml") ||
    text.includes("lam research") ||
    // 中文科技关键词
    text.includes("科技") ||
    text.includes("软件") ||
    text.includes("互联网") ||
    text.includes("平台") ||
    text.includes("芯片") ||
    text.includes("半导体") ||
    text.includes("云计算") ||
    text.includes("通信") ||
    text.includes("电子") ||
    text.includes("信息技术") ||
    text.includes("电子商务") ||
    text.includes("阿里巴巴") ||
    text.includes("拼多多") ||
    text.includes("腾讯") ||
    text.includes("美团") ||
    text.includes("百度") ||
    text.includes("网易") ||
    text.includes("京东")
  ) {
    return {
      type: "technology",
      label: "科技平台",
      benchmarkPE: 25,
      cagrMetrics: ["营收", "净利润", "自由现金流"],
    };
  }

  // 6. 消费品牌（快消、生活服务、医药健康）
  if (
    // 医药健康 (Health Care)
    text.includes("health care") ||
    text.includes("healthcare") ||
    text.includes("health") ||
    text.includes("medical") ||
    text.includes("biotech") ||
    text.includes("biological products") ||
    text.includes("pharmaceutical") ||
    text.includes("pharma") ||
    text.includes("drug") ||
    text.includes("hospital") ||
    text.includes("surgical") ||
    text.includes("diagnostic") ||
    text.includes("医药") ||
    text.includes("医疗") ||
    text.includes("生物制药") ||
    text.includes("生物科技") ||
    text.includes("器械") ||
    // 消费品与零售
    text.includes("consumer") ||
    text.includes("brand") ||
    text.includes("staples") ||
    text.includes("discretionary") ||
    text.includes("retail") ||
    text.includes("beverage") ||
    text.includes("beverages") ||
    text.includes("food") ||
    text.includes("groceries") ||
    text.includes("apparel") ||
    text.includes("clothing") ||
    text.includes("footwear") ||
    text.includes("garment") ||
    text.includes("restaurant") ||
    text.includes("restaurants") ||
    text.includes("cafe") ||
    text.includes("dining") ||
    // 日化、个护与烟草
    text.includes("cosmetic") ||
    text.includes("cosmetics") ||
    text.includes("perfume") ||
    text.includes("toilet preparation") ||
    text.includes("soap") ||
    text.includes("detergent") ||
    text.includes("tobacco") ||
    text.includes("cigarette") ||
    // 酒店文旅与娱乐
    text.includes("hotel") ||
    text.includes("hotels") ||
    text.includes("motel") ||
    text.includes("lodging") ||
    text.includes("resort") ||
    text.includes("amusement") ||
    text.includes("recreation") ||
    text.includes("entertainment") ||
    text.includes("disney") ||
    // 中文消费品关键词
    text.includes("快消") ||
    text.includes("消费") ||
    text.includes("品牌") ||
    text.includes("零售") ||
    text.includes("饮料") ||
    text.includes("食品") ||
    text.includes("服装") ||
    text.includes("餐饮") ||
    text.includes("白酒") ||
    text.includes("啤酒") ||
    text.includes("乳业") ||
    text.includes("美妆") ||
    text.includes("日化") ||
    text.includes("烟草") ||
    text.includes("酒店") ||
    text.includes("旅游") ||
    text.includes("文旅") ||
    text.includes("家电") ||
    text.includes("百货") ||
    text.includes("超市")
  ) {
    return {
      type: "consumer_brand",
      label: "消费品牌",
      benchmarkPE: 22,
      cagrMetrics: ["营收", "净利润", "自由现金流"],
    };
  }

  // 7. 工业制造（兜底）
  return {
    type: "industrial",
    label: "工业制造",
    benchmarkPE: 16,
    cagrMetrics: ["营收", "净利润", "自由现金流"],
  };
}
