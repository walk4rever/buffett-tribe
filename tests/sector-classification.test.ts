import { describe, expect, it } from "vitest";
import {
  SECTOR_MODEL_13_CONFIG,
  SECTOR_MODEL_13_TYPES,
  detectSectorModel7,
  getSectorModel13Info,
  getSectorModel7Info,
  isSectorModelType13,
  SectorModelType7,
} from "../src/lib/sector-classification";

describe("detectSectorModel7", () => {
  const testCases: Array<{
    name: string;
    sector: string | null;
    industry: string | null;
    expected: SectorModelType7;
  }> = [
    // 消费品牌 (含食品饮料、服饰、快消、医药医疗、酒店文旅)
    { name: "Coca-Cola", sector: "Consumer Staples", industry: "Beverages", expected: "consumer_brand" },
    { name: "贵州茅台", sector: null, industry: "白酒", expected: "consumer_brand" },
    { name: "Nike", sector: "Consumer Discretionary", industry: "Apparel", expected: "consumer_brand" },
    { name: "Starbucks", sector: "Consumer Discretionary", industry: "Restaurants", expected: "consumer_brand" },
    { name: "Procter & Gamble", sector: null, industry: "Soap, Detergents, Cleang Preparations, Perfumes, Cosmetics", expected: "consumer_brand" },
    { name: "Philip Morris International", sector: null, industry: "Cigarettes", expected: "consumer_brand" },
    { name: "e.l.f. Beauty", sector: null, industry: "Perfumes, Cosmetics & Other Toilet Preparations", expected: "consumer_brand" },
    { name: "Moderna, Inc.", sector: "Health Care", industry: "Biological Products, (No Diagnostic Substances)", expected: "consumer_brand" },
    { name: "UNITEDHEALTH GROUP INC", sector: "Health Care", industry: "Hospital & Medical Service Plans", expected: "consumer_brand" },
    { name: "GILEAD SCIENCES, INC.", sector: "Health Care", industry: "Biological Products, (No Diagnostic Substances)", expected: "consumer_brand" },
    { name: "Pfizer Inc", sector: "Health Care", industry: "Pharmaceutical Preparations", expected: "consumer_brand" },
    { name: "Walt Disney Co", sector: null, industry: "Services-Miscellaneous Amusement & Recreation", expected: "consumer_brand" },
    { name: "Marriott International", sector: null, industry: "Hotels & Motels", expected: "consumer_brand" },

    // 科技平台 (含软件、半导体、互联网电商、数字支付)
    { name: "Apple Inc.", sector: "Technology", industry: "Consumer Electronics", expected: "technology" },
    { name: "Microsoft", sector: "Technology", industry: "Software", expected: "technology" },
    { name: "Tencent", sector: "Communication Services", industry: "Internet", expected: "technology" },
    { name: "NVIDIA", sector: null, industry: "Semiconductors & Related Devices", expected: "technology" },
    { name: "台积电", sector: null, industry: "半导体", expected: "technology" },
    { name: "Alphabet", sector: "Technology", industry: "Internet", expected: "technology" },
    { name: "Alibaba Group Holding Ltd 阿里巴巴", sector: null, industry: "Services-Business Services, NEC", expected: "technology" },
    { name: "PDD Holdings Inc. 拼多多", sector: null, industry: "Services-Business Services, NEC", expected: "technology" },
    { name: "VISA INC.", sector: null, industry: "Services-Business Services, NEC", expected: "technology" },
    { name: "Mastercard Inc", sector: null, industry: "Services-Business Services, NEC", expected: "technology" },
    { name: "Uber Technologies, Inc", sector: null, industry: "Services-Business Services, NEC", expected: "technology" },

    // 工业制造
    { name: "Boeing", sector: "Industrials", industry: "Aerospace & Defense", expected: "industrial" },
    { name: "General Electric", sector: "Industrials", industry: "Industrial Conglomerates", expected: "industrial" },
    { name: "Caterpillar", sector: "Industrials", industry: "Machinery", expected: "industrial" },
    { name: "3M", sector: "Industrials", industry: "Diversified Industrials", expected: "industrial" },
    { name: "Union Pacific", sector: "Industrials", industry: "Railroads, Line-Haul Operating", expected: "industrial" },

    // 银行保险
    { name: "Bank of America", sector: "Financials", industry: "National Commercial Banks", expected: "bank_insurance" },
    { name: "中国平安", sector: null, industry: "保险", expected: "bank_insurance" },
    { name: "AMERICAN EXPRESS CO", sector: "Financials", industry: "Finance Services", expected: "bank_insurance" },
    { name: "GOLDMAN SACHS GROUP INC", sector: "Financials", industry: "Security Brokers, Dealers & Flotation Companies", expected: "bank_insurance" },
    { name: "Morgan Stanley", sector: "Financials", industry: "Security Brokers, Dealers & Flotation Companies", expected: "bank_insurance" },

    // 公用事业
    { name: "Duke Energy", sector: "Utilities", industry: "Electric Utilities", expected: "utilities" },
    { name: "长江电力", sector: null, industry: "水电", expected: "utilities" },
    { name: "中国燃气", sector: null, industry: "燃气", expected: "utilities" },

    // 强周期 (能源、矿产材料、房地产与住宅建筑商)
    { name: "Chevron", sector: "Energy", industry: "Petroleum Refining", expected: "cyclical" },
    { name: "中国石油", sector: null, industry: "石油", expected: "cyclical" },
    { name: "万科A", sector: null, industry: "地产", expected: "cyclical" },
    { name: "保利地产", sector: "Financials", industry: "Real Estate", expected: "cyclical" },
    { name: "LENNAR CORP", sector: null, industry: "General Bldg Contractors - Residential Bldgs", expected: "cyclical" },
    { name: "NVR INC", sector: null, industry: "Operative Builders", expected: "cyclical" },
    { name: "BHP", sector: "Materials", industry: "Mining", expected: "cyclical" },
    { name: "中国神华", sector: null, industry: "煤炭", expected: "cyclical" },

    // 多元化控股
    { name: "Berkshire Hathaway", sector: "Financials", industry: "Multi-Sector Holdings", expected: "conglomerate" },
    { name: "长和 CK HUTCHISON", sector: "Industrials", industry: "综合企业", expected: "conglomerate" },
    { name: "太古股份 Swire Pacific", sector: "Industrials", industry: "综合企业", expected: "conglomerate" },
  ];

  for (const tc of testCases) {
    it(`classifies ${tc.name} as ${tc.expected}`, () => {
      const result = detectSectorModel7(tc.sector, tc.industry, tc.name);
      expect(result.type).toBe(tc.expected);
    });
  }

  it("provides valid config for all 7 sectors via getSectorModel7Info", () => {
    const allTypes: SectorModelType7[] = [
      "consumer_brand",
      "technology",
      "industrial",
      "bank_insurance",
      "utilities",
      "cyclical",
      "conglomerate",
    ];
    for (const t of allTypes) {
      const info = getSectorModel7Info(t);
      expect(info.type).toBe(t);
      expect(info.label.length).toBeGreaterThan(0);
      expect(info.benchmarkPE).toBeGreaterThan(0);
      expect(info.cagrMetrics.length).toBeGreaterThan(0);
    }
  });
});

describe("SECTOR_MODEL_13_CONFIG（估值逻辑分类）", () => {
  it("恰好 13 类，key 与 type 一致", () => {
    expect(SECTOR_MODEL_13_TYPES).toHaveLength(13);
    expect(new Set(SECTOR_MODEL_13_TYPES).size).toBe(13);
    for (const type of SECTOR_MODEL_13_TYPES) {
      expect(SECTOR_MODEL_13_CONFIG[type].type).toBe(type);
    }
  });

  it("13 类是 GICS 11 的五处偏离后的结果（净 +2）", () => {
    // Energy + Materials 合并、CD + CS 合并、Financials 拆三类、IT 拆两类、新增控股
    expect(SECTOR_MODEL_13_TYPES).toContain("energy_materials");
    expect(SECTOR_MODEL_13_TYPES).toContain("banks");
    expect(SECTOR_MODEL_13_TYPES).toContain("insurance");
    expect(SECTOR_MODEL_13_TYPES).toContain("capital_markets");
    expect(SECTOR_MODEL_13_TYPES).toContain("software_platform");
    expect(SECTOR_MODEL_13_TYPES).toContain("semiconductor_hardware");
    // 被拆掉的旧类不应残留
    expect(SECTOR_MODEL_13_TYPES).not.toContain("technology");
    expect(SECTOR_MODEL_13_TYPES).not.toContain("cyclical");
    expect(SECTOR_MODEL_13_TYPES).not.toContain("bank_insurance");
  });

  it("每类都有唯一标签、合理 PE 种子值与可读定义", () => {
    const labels = new Set<string>();
    for (const type of SECTOR_MODEL_13_TYPES) {
      const info = getSectorModel13Info(type);
      expect(info.label.length).toBeGreaterThan(0);
      expect(labels.has(info.label)).toBe(false);
      labels.add(info.label);
      expect(info.benchmarkPE).toBeGreaterThanOrEqual(8);
      expect(info.benchmarkPE).toBeLessThanOrEqual(40);
      expect(info.cagrMetrics.length).toBeGreaterThan(0);
      // definition 是 prompt 的唯一来源，必须说清「装什么」和估值锚
      expect(info.definition.length).toBeGreaterThan(40);
      expect(info.definition).toContain("装：");
    }
  });

  it("估值锚互不相同的类，倍数也不相同", () => {
    // banks 用 PB-ROE、capital_markets 用收费型轻资产倍数，两者不能同桶（这是拆分的理由）
    expect(SECTOR_MODEL_13_CONFIG.banks.benchmarkPE).toBeLessThan(
      SECTOR_MODEL_13_CONFIG.capital_markets.benchmarkPE,
    );
    expect(SECTOR_MODEL_13_CONFIG.energy_materials.benchmarkPE).toBeLessThan(
      SECTOR_MODEL_13_CONFIG.software_platform.benchmarkPE,
    );
  });

  it("isSectorModelType13 只接受 13 个 key", () => {
    for (const type of SECTOR_MODEL_13_TYPES) expect(isSectorModelType13(type)).toBe(true);
    for (const invalid of ["technology", "cyclical", "bank_insurance", "unknown", "", null, undefined, 7]) {
      expect(isSectorModelType13(invalid)).toBe(false);
    }
  });
});
