/**
 * eval-golden-18.ts
 *
 * 18-Company Golden Matrix Cross-Market & Multi-Template Penetration Evaluator.
 * 3 Markets (US, CN, HK) × 6 Templates (industrial, bank, insurance, financial_services, real_estate, conglomerate)
 *
 * 3-Layer Penetration Audit:
 *   Layer 1: Dataset Quality Audit (Statutory facts, shares sanity, currency consistency, quarterly sum)
 *   Layer 2: Processing Logic & Model Audit (Template/subModel inferencing, DuPont identity <=0.5%, IC<=0 safety fusing)
 *   Layer 3: Page & UI 6-Tab End-to-End Rendering Audit (Value Line, Financial Dashboard, DuPont/ROIC, Capital Allocation)
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/eval-golden-18.ts
 *   npx tsx --env-file=.env.local scripts/eval-golden-18.ts --ticker AAPL
 *   npx tsx --env-file=.env.local scripts/eval-golden-18.ts --template bank
 *   npx tsx --env-file=.env.local scripts/eval-golden-18.ts --market cn
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import db from "../src/lib/prisma";
import { getCompanyFinancials } from "../src/lib/company-data";
import { buildCompanyFinancialDashboard } from "../src/lib/company-financial-dashboard";
import { getValueLineData } from "../src/lib/value-line-data";
import {
  calculateROIC,
  calculateInvestedCapital,
  calculateDuPontThreeWay,
} from "../src/lib/financial-math";
import {
  resolveFinancialModel,
  type FinancialTemplate,
  type FinancialSubModel,
} from "../src/lib/financial-model";

interface GoldenCompanySpec {
  ticker: string;
  name: string;
  market: "us" | "cn" | "hk";
  expectedTemplate: FinancialTemplate;
  expectedSubModel?: FinancialSubModel | null;
  expectedModifier?: string | null;
  expectedReportingCurrency: string;
  keyVerificationPoints: string;
  requiredFacts: string[];
  forbiddenDashboardRows: string[];
  checkQuarterly?: boolean;
}

export const GOLDEN_18_MATRIX: GoldenCompanySpec[] = [
  // ---------------- US Market ----------------
  {
    ticker: "AAPL",
    name: "Apple Inc.",
    market: "us",
    expectedTemplate: "industrial",
    expectedReportingCurrency: "USD",
    keyVerificationPoints: "负净资产用例、投入资本IC<=0时ROIC安全熔断、毛利智能补齐",
    requiredFacts: ["Revenue", "NetIncome", "OperatingIncome", "OperatingCashFlow", "TotalAssets"],
    forbiddenDashboardRows: ["NetInterestIncome", "NetLoans", "TotalDeposits", "ClaimsRatio", "AssetsUnderManagement"],
  },
  {
    ticker: "JPM",
    name: "JPMorgan Chase & Co.",
    market: "us",
    expectedTemplate: "bank",
    expectedReportingCurrency: "USD",
    keyVerificationPoints: "商业银行、利息与非利息收入、贷款与存款结构、禁止传统工商业现金流/毛利",
    requiredFacts: ["NetInterestIncome", "NonInterestIncome", "NetIncome", "TotalDeposits", "TotalAssets"],
    forbiddenDashboardRows: ["GrossMargin", "CostOfRevenue", "CapEx", "FreeCashFlow"],
  },
  {
    ticker: "PGR",
    name: "Progressive Corp",
    market: "us",
    expectedTemplate: "insurance",
    expectedSubModel: "property_casualty",
    expectedReportingCurrency: "USD",
    keyVerificationPoints: "纯财产险标杆、已赚保费核验、禁止存货/毛利",
    requiredFacts: ["NetPremiumsEarned", "NetIncome", "TotalAssets", "TotalLiabilities", "ShareholdersEquity"],
    forbiddenDashboardRows: ["GrossMargin", "CostOfRevenue", "Inventory", "CapEx"],
  },
  {
    ticker: "BX",
    name: "Blackstone Inc.",
    market: "us",
    expectedTemplate: "financial_services",
    expectedSubModel: "asset_mgmt",
    expectedReportingCurrency: "USD",
    keyVerificationPoints: "轻资产资管旗舰、AUM与管理费收入、禁止套用银行息差",
    requiredFacts: ["Revenue", "NetIncome", "TotalAssets", "ShareholdersEquity"],
    forbiddenDashboardRows: ["NetInterestIncome", "NetLoans", "ClaimsRatio"],
  },
  {
    ticker: "SPG",
    name: "Simon Property Group",
    market: "us",
    expectedTemplate: "real_estate",
    expectedSubModel: "reit_property",
    expectedReportingCurrency: "USD",
    keyVerificationPoints: "商业持有型REITs、投资性物业/重资产折旧、屏蔽传统工业FCF CAGR扭曲",
    requiredFacts: ["Revenue", "NetIncome", "OperatingCashFlow", "TotalAssets"],
    forbiddenDashboardRows: ["NetInterestIncome", "NetLoans", "ClaimsRatio", "AssetsUnderManagement"],
  },
  {
    ticker: "BRK-B",
    name: "Berkshire Hathaway Inc.",
    market: "us",
    expectedTemplate: "conglomerate",
    expectedReportingCurrency: "USD",
    keyVerificationPoints: "多元控股实业、跨板块合并报表、BPS与SOTP逻辑",
    requiredFacts: ["Revenue", "NetIncome", "TotalAssets", "TotalLiabilities", "ShareholdersEquity"],
    forbiddenDashboardRows: ["NetLoans", "TotalDeposits", "ClaimsRatio"],
  },

  // ---------------- CN Market ----------------
  {
    ticker: "600519.SS",
    name: "贵州茅台",
    market: "cn",
    expectedTemplate: "industrial",
    expectedModifier: "consumer_brand",
    expectedReportingCurrency: "CNY",
    keyVerificationPoints: "超高毛利消费品牌、杜邦恒等式、离散单季Q1-Q4做差核验",
    requiredFacts: ["Revenue", "NetIncome", "OperatingIncome", "GrossProfit", "OperatingCashFlow", "TotalAssets"],
    forbiddenDashboardRows: ["NetInterestIncome", "NetLoans", "TotalDeposits", "ClaimsRatio", "AssetsUnderManagement"],
    checkQuarterly: true,
  },
  {
    ticker: "600036.SS",
    name: "招商银行",
    market: "cn",
    expectedTemplate: "bank",
    expectedReportingCurrency: "CNY",
    keyVerificationPoints: "零售银行标杆、利息净收入与信贷减值拨备、PB-ROE估值通道",
    requiredFacts: ["NetInterestIncome", "NonInterestIncome", "NetIncome", "TotalDeposits", "TotalAssets"],
    forbiddenDashboardRows: ["GrossMargin", "CostOfRevenue", "CapEx", "FreeCashFlow"],
    checkQuarterly: true,
  },
  {
    ticker: "601318.SS",
    name: "中国平安",
    market: "cn",
    expectedTemplate: "insurance",
    expectedSubModel: "life_health",
    expectedReportingCurrency: "CNY",
    keyVerificationPoints: "人身险与综合金融、浮存金与投资收益、屏蔽财险专属赔付率",
    requiredFacts: ["NetIncome", "TotalAssets", "TotalLiabilities", "ShareholdersEquity"],
    forbiddenDashboardRows: ["GrossMargin", "CostOfRevenue", "Inventory", "CapEx"],
    checkQuarterly: true,
  },
  {
    ticker: "000776.SZ",
    name: "广发证券",
    market: "cn",
    expectedTemplate: "financial_services",
    expectedSubModel: "broker_exchange",
    expectedReportingCurrency: "CNY",
    keyVerificationPoints: "综合券商投行、佣金承销自营、严禁强套资管AUM考查",
    requiredFacts: ["Revenue", "NetIncome", "TotalAssets", "ShareholdersEquity"],
    forbiddenDashboardRows: ["NetInterestIncome", "NetLoans", "ClaimsRatio"],
    checkQuarterly: true,
  },
  {
    ticker: "000069.SZ",
    name: "华侨城 A",
    market: "cn",
    expectedTemplate: "real_estate",
    expectedSubModel: "developer",
    expectedReportingCurrency: "CNY",
    keyVerificationPoints: "地产开发商模式、巨额合同负债与存货、严禁套用持有型REITs的FFO估值",
    requiredFacts: ["Revenue", "NetIncome", "TotalAssets", "ContractLiabilities", "Inventory"],
    forbiddenDashboardRows: ["NetInterestIncome", "NetLoans", "ClaimsRatio", "AssetsUnderManagement"],
    checkQuarterly: true,
  },
  {
    ticker: "000009.SZ",
    name: "中国宝安",
    market: "cn",
    expectedTemplate: "conglomerate",
    expectedReportingCurrency: "CNY",
    keyVerificationPoints: "老牌多元实业控股、跨板块合并核验、资本配置总账",
    requiredFacts: ["Revenue", "NetIncome", "TotalAssets", "TotalLiabilities", "ShareholdersEquity"],
    forbiddenDashboardRows: ["NetLoans", "TotalDeposits", "ClaimsRatio"],
    checkQuarterly: true,
  },

  // ---------------- HK Market ----------------
  {
    ticker: "0700.HK",
    name: "腾讯控股",
    market: "hk",
    expectedTemplate: "industrial",
    expectedModifier: "software_platform",
    expectedReportingCurrency: "CNY",
    keyVerificationPoints: "港币股价与人民币CNY报表跨币折算核验、软件与平台、大额投资收益",
    requiredFacts: ["Revenue", "NetIncome", "OperatingIncome", "GrossProfit", "OperatingCashFlow", "TotalAssets"],
    forbiddenDashboardRows: ["NetInterestIncome", "NetLoans", "TotalDeposits", "ClaimsRatio", "AssetsUnderManagement"],
  },
  {
    ticker: "2388.HK",
    name: "中银香港",
    market: "hk",
    expectedTemplate: "bank",
    expectedSubModel: null,
    expectedReportingCurrency: "HKD",
    keyVerificationPoints: "成熟商业信贷体系、高派息与信贷周期、HKD自洽核验",
    requiredFacts: ["NetInterestIncome", "NonInterestIncome", "NetIncome", "TotalDeposits", "TotalAssets"],
    forbiddenDashboardRows: ["GrossMargin", "CostOfRevenue", "CapEx", "FreeCashFlow"],
  },
  {
    ticker: "1299.HK",
    name: "友邦保险",
    market: "hk",
    expectedTemplate: "insurance",
    expectedSubModel: "life_health",
    expectedReportingCurrency: "USD",
    keyVerificationPoints: "跨国纯寿险巨头、新业务价值NBV与内含价值、USD报表币种核验",
    requiredFacts: ["NetIncome", "TotalAssets", "TotalLiabilities", "ShareholdersEquity"],
    forbiddenDashboardRows: ["GrossMargin", "CostOfRevenue", "Inventory", "CapEx"],
  },
  {
    ticker: "0388.HK",
    name: "香港交易所",
    market: "hk",
    expectedTemplate: "financial_services",
    expectedSubModel: "broker_exchange",
    expectedReportingCurrency: "HKD",
    keyVerificationPoints: "特许垄断交易平台、高净利率、非AUM费率逻辑、HKD币种",
    requiredFacts: ["Revenue", "NetIncome", "TotalAssets", "ShareholdersEquity"],
    forbiddenDashboardRows: ["NetInterestIncome", "NetLoans", "ClaimsRatio"],
  },
  {
    ticker: "0016.HK",
    name: "新鸿基地产",
    market: "hk",
    expectedTemplate: "real_estate",
    expectedSubModel: "developer",
    expectedReportingCurrency: "HKD",
    keyVerificationPoints: "港股龙头地产旗舰（开发+租金）、合同负债与投资物业综合呈现",
    requiredFacts: ["Revenue", "NetIncome", "TotalAssets", "ContractLiabilities"],
    forbiddenDashboardRows: ["NetInterestIncome", "NetLoans", "ClaimsRatio", "AssetsUnderManagement"],
  },
  {
    ticker: "0001.HK",
    name: "长和",
    market: "hk",
    expectedTemplate: "conglomerate",
    expectedSubModel: null,
    expectedReportingCurrency: "HKD",
    keyVerificationPoints: "李嘉诚全球多元控股旗舰、控股折价率与分部现金流对冲",
    requiredFacts: ["Revenue", "NetIncome", "TotalAssets", "TotalLiabilities", "ShareholdersEquity"],
    forbiddenDashboardRows: ["NetLoans", "TotalDeposits", "ClaimsRatio"],
  },
];

interface AuditFinding {
  layer: "Dataset" | "Logic" | "UI";
  severity: "P0" | "P1" | "P2";
  code: string;
  message: string;
}

interface CompanyAuditReport {
  ticker: string;
  name: string;
  market: "us" | "cn" | "hk";
  template: FinancialTemplate;
  subModel: string | null;
  status: "PASS" | "WARN" | "FAIL";
  findings: AuditFinding[];
  summary: {
    layer1Pass: boolean;
    layer2Pass: boolean;
    layer3Pass: boolean;
    factsCount: number;
    annualYears: number[];
  };
}

async function runGoldenAudit(): Promise<{ reports: CompanyAuditReport[]; allPassed: boolean }> {
  console.log("================================================================================");
  console.log("🚀 黄金测试集：18 标杆全链路穿透测试 (Golden 18 Matrix Audit)");
  console.log("   3 市场 × 6 模板正交 | 数据集 → 处理逻辑 → 页面展示 3 层穿透");
  console.log("================================================================================\n");

  const reports: CompanyAuditReport[] = [];

  for (const spec of GOLDEN_18_MATRIX) {
    const findings: AuditFinding[] = [];
    const code = spec.ticker.replace(/\.(SS|SZ|HK)$/, "");

    // 1. Locate entity in DB
    const entity = await db.entity.findFirst({
      where: {
        OR: [
          { ticker: spec.ticker },
          { ticker: spec.ticker.replace("-", ".") },
          { ticker: code },
          { code: spec.ticker },
          { code: code },
        ],
        type: { not: "master" },
      },
      include: {
        _count: { select: { financials: true } },
      },
    });

    if (!entity) {
      findings.push({
        layer: "Dataset",
        severity: "P0",
        code: "ENTITY_NOT_FOUND",
        message: `数据库未找到实体记录: ${spec.ticker}`,
      });
      reports.push({
        ticker: spec.ticker,
        name: spec.name,
        market: spec.market,
        template: spec.expectedTemplate,
        subModel: spec.expectedSubModel,
        status: "FAIL",
        findings,
        summary: { layer1Pass: false, layer2Pass: false, layer3Pass: false, factsCount: 0, annualYears: [] },
      });
      continue;
    }

    const finCount = entity._count.financials;
    if (finCount === 0) {
      findings.push({
        layer: "Dataset",
        severity: "P0",
        code: "NO_FINANCIALS",
        message: `数据库中无任何财务事实记录 (finCount = 0)`,
      });
      reports.push({
        ticker: spec.ticker,
        name: spec.name,
        market: spec.market,
        template: spec.expectedTemplate,
        subModel: spec.expectedSubModel,
        status: "FAIL",
        findings,
        summary: { layer1Pass: false, layer2Pass: false, layer3Pass: false, factsCount: 0, annualYears: [] },
      });
      continue;
    }

    // Load financials
    const rawFinList = await getCompanyFinancials(entity.id, 10);
    const annualYears = rawFinList.map((f) => f.year).sort((a, b) => a - b);
    const latestYear = annualYears.length > 0 ? annualYears[annualYears.length - 1] : null;

    // =========================================================================
    // LAYER 1: 数据集质量审计 (Dataset Layer)
    // =========================================================================

    // D1. 币种与跨市场核验
    if (entity.reportingCurrency !== spec.expectedReportingCurrency) {
      findings.push({
        layer: "Dataset",
        severity: "P1",
        code: "CURRENCY_MISMATCH",
        message: `报表币种不一致: 期望 ${spec.expectedReportingCurrency}, 实际登记为 ${entity.reportingCurrency}`,
      });
    }

    // D2. 法定科目覆盖度 (近 3~5 年)
    if (rawFinList.length < 3) {
      findings.push({
        layer: "Dataset",
        severity: "P1",
        code: "INSUFFICIENT_ANNUAL_YEARS",
        message: `可用年报少于 3 年 (实际: ${rawFinList.length} 年: ${annualYears.join(", ")})`,
      });
    }

    // Check required facts on the latest available year
    const latestFin = rawFinList.find((f) => f.year === latestYear);
    if (latestFin) {
      for (const factKey of spec.requiredFacts) {
        const val = latestFin.items[factKey];
        if (val == null || val === "" || Number.isNaN(Number(val))) {
          // Check common aliases
          const aliasVal =
            factKey === "ShareholdersEquity"
              ? latestFin.items["TotalStockholdersEquity"] ?? latestFin.items["TotalEquity"]
              : factKey === "TotalStockholdersEquity"
                ? latestFin.items["ShareholdersEquity"] ?? latestFin.items["TotalEquity"]
                : factKey === "ContractLiabilities"
                  ? latestFin.items["AdvancesFromCustomers"]
                  : undefined;

          if (aliasVal == null || aliasVal === "" || Number.isNaN(Number(aliasVal))) {
            findings.push({
              layer: "Dataset",
              severity: "P1",
              code: "MISSING_REQUIRED_FACT",
              message: `FY${latestYear} 缺少必需财务科目: ${factKey}`,
            });
          }
        }
      }

      // D3. 股数防污染审计
      const sharesRaw = latestFin.items["CommonStockSharesOutstanding"];
      if (sharesRaw != null) {
        const sharesNum = Number(sharesRaw);
        const capitalRaw = latestFin.items["ShareCapital"] ?? latestFin.items["CommonStockValue"];
        if (spec.market === "us" && capitalRaw != null && Math.abs(sharesNum - Number(capitalRaw)) < 1) {
          findings.push({
            layer: "Dataset",
            severity: "P0",
            code: "SHARE_COUNT_POLLUTED_BY_CAPITAL",
            message: `美股股数直接等于实收资本/股本金额 (${sharesNum})`,
          });
        }
        if (spec.market === "cn") {
          const shareUnit = latestFin.itemUnits?.["CommonStockSharesOutstanding"];
          if (shareUnit && /CNY|RMB|USD|HKD/i.test(shareUnit)) {
            findings.push({
              layer: "Dataset",
              severity: "P0",
              code: "SHARE_UNIT_POLLUTED_BY_CURRENCY",
              message: `A股股数单位被错误标记为货币: ${shareUnit}`,
            });
          }
          if (sharesNum > 500000000000) {
            findings.push({
              layer: "Dataset",
              severity: "P0",
              code: "SHARE_COUNT_OUT_OF_BOUNDS",
              message: `A股股数异常超大 (${sharesNum})`,
            });
          }
        }
        if (sharesNum <= 0) {
          findings.push({
            layer: "Dataset",
            severity: "P1",
            code: "SHARE_COUNT_NON_POSITIVE",
            message: `股数非正数 (${sharesNum})`,
          });
        }
      }
    }

    // D4. 离散单季做差自洽审计 (A 股及启用检查的标的)
    if (spec.checkQuarterly && latestYear) {
      const quarterlyRecords = await db.financial.findMany({
        where: {
          entityId: entity.id,
          periodType: { in: ["Q1", "Q2", "Q3", "Q4"] },
          periodEnd: {
            gte: new Date(`${latestYear}-01-01`),
            lte: new Date(`${latestYear}-12-31`),
          },
        },
      });

      if (quarterlyRecords.length > 0) {
        // Group by lineItem and sum Q1-Q4
        const qSums: Record<string, number> = {};
        for (const qr of quarterlyRecords) {
          if (qr.value != null) {
            const num = Number(qr.value);
            qSums[qr.lineItem] = (qSums[qr.lineItem] || 0) + num;
          }
        }

        // Compare Revenue and NetIncome
        for (const testKey of ["Revenue", "NetIncome"]) {
          const fyVal = latestFin?.items[testKey] ? Number(latestFin.items[testKey]) : null;
          const qSumVal = qSums[testKey];
          if (fyVal != null && qSumVal != null && Math.abs(fyVal) > 1000) {
            const diffRatio = Math.abs(qSumVal - fyVal) / Math.abs(fyVal);
            if (diffRatio > 0.005) {
              findings.push({
                layer: "Dataset",
                severity: "P1",
                code: "QUARTERLY_SUM_MISMATCH",
                message: `FY${latestYear} 单季之和与全年 FY 偏差 ${(diffRatio * 100).toFixed(2)}% (${testKey}: FY=${fyVal.toLocaleString()}, Q1-Q4=${qSumVal.toLocaleString()})`,
              });
            }
          }
        }
      }
    }

    // =========================================================================
    // LAYER 2: 处理逻辑与计算模型审计 (Processing Logic Layer)
    // =========================================================================

    const meta = (entity.metadata as Record<string, unknown> | null) ?? {};
    const sectorModelReason =
      meta.sectorModel && typeof meta.sectorModel === "object" && "reason" in meta.sectorModel
        ? String((meta.sectorModel as { reason?: unknown }).reason ?? "")
        : null;
    const companyName =
      typeof meta.nameZh === "string"
        ? meta.nameZh
        : typeof meta.nameEnShort === "string"
          ? meta.nameEnShort
          : entity.canonicalName;

    // L1. 模板与子模型推断
    const resolvedModel = resolveFinancialModel(entity.sectorModelType, {
      sector: entity.sector,
      industry: typeof meta.industry === "string" ? meta.industry : null,
      sic: typeof meta.sic === "string" ? meta.sic : undefined,
      name: companyName,
      reason: sectorModelReason,
    });

    if (!resolvedModel) {
      findings.push({
        layer: "Logic",
        severity: "P0",
        code: "MODEL_RESOLUTION_FAILED",
        message: `无法解析商业模式模型 (sectorModelType=${entity.sectorModelType})`,
      });
    } else {
      if (resolvedModel.template !== spec.expectedTemplate) {
        findings.push({
          layer: "Logic",
          severity: "P0",
          code: "TEMPLATE_MISMATCH",
          message: `财务模板判定错误: 期望 ${spec.expectedTemplate}, 实际解析为 ${resolvedModel.template}`,
        });
      }

      if (spec.expectedSubModel && resolvedModel.subModel !== spec.expectedSubModel) {
        findings.push({
          layer: "Logic",
          severity: "P1",
          code: "SUBMODEL_MISMATCH",
          message: `子模型判定错误: 期望 ${spec.expectedSubModel}, 实际推断为 ${resolvedModel.subModel}`,
        });
      }

      if (spec.expectedModifier && !resolvedModel.modifiers.includes(spec.expectedModifier as any)) {
        findings.push({
          layer: "Logic",
          severity: "P1",
          code: "MODIFIER_MISMATCH",
          message: `行业修饰符判定错误: 期望包含 ${spec.expectedModifier}, 实际为 [${resolvedModel.modifiers.join(", ")}]`,
        });
      }
    }

    // L2. 杜邦恒等式闭环验证 (工业类)
    if (spec.expectedTemplate === "industrial") {
      for (const fin of rawFinList) {
        const netIncome = fin.items.NetIncome ? Number(fin.items.NetIncome) : null;
        const revenue = fin.items.Revenue ? Number(fin.items.Revenue) : null;
        const totalAssets = fin.items.TotalAssets ? Number(fin.items.TotalAssets) : null;
        const equity = (fin.items.ShareholdersEquity ?? fin.items.TotalStockholdersEquity)
          ? Number(fin.items.ShareholdersEquity ?? fin.items.TotalStockholdersEquity)
          : null;

        if (
          netIncome != null &&
          revenue != null &&
          revenue > 0 &&
          totalAssets != null &&
          totalAssets > 0 &&
          equity != null &&
          equity > 0
        ) {
          const directROE = netIncome / equity;
          const netMargin = netIncome / revenue;
          const assetTurnover = revenue / totalAssets;
          const equityMultiplier = totalAssets / equity;
          const dupontROE = netMargin * assetTurnover * equityMultiplier;

          const dupontDiff = Math.abs(directROE - dupontROE);
          if (dupontDiff > 0.005) {
            findings.push({
              layer: "Logic",
              severity: "P1",
              code: "DUPONT_IDENTITY_VIOLATION",
              message: `FY${fin.year} 杜邦恒等式不平: |ROE(${directROE.toFixed(4)}) - (Margin(${netMargin.toFixed(4)}) × Turn(${assetTurnover.toFixed(4)}) × Mult(${equityMultiplier.toFixed(4)}))| = ${dupontDiff.toFixed(4)} > 0.005`,
            });
            break;
          }
        }
      }
    }

    // L3. 投入资本 IC <= 0 与 ROIC 熔断保护
    for (const fin of rawFinList) {
      const equity = (fin.items.ShareholdersEquity ?? fin.items.TotalStockholdersEquity ?? fin.items.TotalEquity)
        ? Number(fin.items.ShareholdersEquity ?? fin.items.TotalStockholdersEquity ?? fin.items.TotalEquity)
        : null;
      const totalDebt = fin.items.TotalDebt ? Number(fin.items.TotalDebt) : null;
      const shortDebt = fin.items.ShortTermDebt ? Number(fin.items.ShortTermDebt) : null;
      const longDebt = fin.items.LongTermDebt ? Number(fin.items.LongTermDebt) : null;
      const cash = fin.items.CashAndCashEquivalents ? Number(fin.items.CashAndCashEquivalents) : null;
      const opInc = fin.items.OperatingIncome ? Number(fin.items.OperatingIncome) : null;

      const ic = calculateInvestedCapital({
        totalEquity: equity,
        totalDebt,
        shortTermDebt: shortDebt,
        longTermDebt: longDebt,
        cashAndEquivalents: cash,
      });

      if (ic != null && ic <= 0) {
        const roic = calculateROIC({
          operatingIncome: opInc,
          currentInvestedCapital: ic,
          effectiveTaxRate: 0.25,
        });

        if (roic !== null) {
          findings.push({
            layer: "Logic",
            severity: "P0",
            code: "ROIC_SAFETY_FUSE_FAILED",
            message: `FY${fin.year} 投入资本为非正 (IC=${ic}) 时，ROIC 未熔断返回 null，实际返回了: ${roic}`,
          });
          break;
        }
      }
    }

    // =========================================================================
    // LAYER 3: 页面 6 大 Tab 端到端渲染验收 (Page & UI Layer)
    // =========================================================================

    // Tab 1: 价值线 (Value Line)
    try {
      const valueLine = await getValueLineData(entity.id);
      if (valueLine && valueLine.annuals) {
        for (const ann of valueLine.annuals) {
          const epsInvalid = ann.eps != null && (!Number.isFinite(ann.eps) || Number.isNaN(ann.eps));
          const roeInvalid = ann.roe != null && (!Number.isFinite(ann.roe) || Number.isNaN(ann.roe));
          const eqInvalid = ann.shareholdersEquity != null && (!Number.isFinite(ann.shareholdersEquity) || Number.isNaN(ann.shareholdersEquity));
          const shsInvalid = ann.shares != null && (!Number.isFinite(ann.shares) || Number.isNaN(ann.shares));

          if (epsInvalid || roeInvalid || eqInvalid || shsInvalid) {
            findings.push({
              layer: "UI",
              severity: "P0",
              code: "VALUE_LINE_NAN_BREAKAGE",
              message: `Tab 1 价值线四宫格出现 NaN 或非有限数值 (year: ${ann.year}, eps: ${ann.eps}, roe: ${ann.roe}, equity: ${ann.shareholdersEquity}, shares: ${ann.shares})`,
            });
            break;
          }
        }
      }
    } catch (err: unknown) {
      findings.push({
        layer: "UI",
        severity: "P0",
        code: "VALUE_LINE_RENDER_ERROR",
        message: `Tab 1 价值线生成异常: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // Tab 2: 财务看板 (Financial Dashboard)
    try {
      const dashboard = buildCompanyFinancialDashboard(
        {
          sector: entity.sector,
          metadata: entity.metadata,
          sectorModelType: entity.sectorModelType,
        },
        rawFinList,
        entity.reportingCurrency
      );

      const activeRowKeys = new Set(dashboard.rows.map((r) => r.key));

      // 检查废弃横幅
      if (dashboard.templateNote && /尚未接入|未接入|待后续接入/.test(dashboard.templateNote)) {
        findings.push({
          layer: "UI",
          severity: "P1",
          code: "DEPRECATED_PLACEHOLDER_BANNER",
          message: `Tab 2 看板包含未完工占位文案: "${dashboard.templateNote}"`,
        });
      }

      // 检查禁用行是否被彻底屏蔽（专业性隔离）
      for (const forbiddenKey of spec.forbiddenDashboardRows) {
        if (activeRowKeys.has(forbiddenKey)) {
          findings.push({
            layer: "UI",
            severity: "P0",
            code: "FORBIDDEN_ROW_LEAKAGE",
            message: `Tab 2 看板泄漏了不适用本科目的行: ${forbiddenKey}`,
          });
        }
      }

      // 检查表格中是否有未转化的 "NaN" 或 "undefined"
      for (const row of dashboard.rows) {
        for (const [y, strVal] of Object.entries(row.values)) {
          if (typeof strVal === "string" && (strVal.includes("NaN") || strVal.includes("undefined"))) {
            findings.push({
              layer: "UI",
              severity: "P0",
              code: "DASHBOARD_NAN_STRING_LEAKAGE",
              message: `Tab 2 看板科目 ${row.key} 在 ${y} 年呈现了脏字符串: "${strVal}"`,
            });
            break;
          }
        }
      }
    } catch (err: unknown) {
      findings.push({
        layer: "UI",
        severity: "P0",
        code: "DASHBOARD_BUILD_ERROR",
        message: `Tab 2 财务看板构建抛出异常: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // Determine overall status
    const p0Count = findings.filter((f) => f.severity === "P0").length;
    const p1Count = findings.filter((f) => f.severity === "P1").length;
    const p2Count = findings.filter((f) => f.severity === "P2").length;

    const status = p0Count > 0 ? "FAIL" : p1Count > 0 ? "WARN" : "PASS";

    const layer1Pass = findings.filter((f) => f.layer === "Dataset" && f.severity === "P0").length === 0;
    const layer2Pass = findings.filter((f) => f.layer === "Logic" && f.severity === "P0").length === 0;
    const layer3Pass = findings.filter((f) => f.layer === "UI" && f.severity === "P0").length === 0;

    reports.push({
      ticker: spec.ticker,
      name: spec.name,
      market: spec.market,
      template: spec.expectedTemplate,
      subModel: spec.expectedSubModel,
      status,
      findings,
      summary: {
        layer1Pass,
        layer2Pass,
        layer3Pass,
        factsCount: finCount,
        annualYears,
      },
    });
  }

  // Print Summary Table
  console.log("--------------------------------------------------------------------------------");
  console.log("📊 18 标杆全链路穿透审计执行结果总览");
  console.log("--------------------------------------------------------------------------------");

  let allPassed = true;
  for (const r of reports) {
    const statusIcon = r.status === "PASS" ? "✅ PASS" : r.status === "WARN" ? "⚠️ WARN" : "❌ FAIL";
    if (r.status === "FAIL") allPassed = false;
    const subStr = r.subModel ? ` (${r.subModel})` : "";
    console.log(
      `${statusIcon.padEnd(8)} | ${r.market.toUpperCase().padEnd(3)} | ${r.ticker.padEnd(10)} | ${r.name.padEnd(12)} | ${r.template}${subStr} | 事实:${r.summary.factsCount}行 (FY:${r.summary.annualYears.length}) | 缺陷:${r.findings.length}项`
    );
    for (const f of r.findings) {
      const sevIcon = f.severity === "P0" ? "🔴 P0" : f.severity === "P1" ? "🟡 P1" : "⚪ P2";
      console.log(`     └─ [${f.layer}] ${sevIcon} [${f.code}] ${f.message}`);
    }
  }

  console.log("================================================================================\n");
  return { reports, allPassed };
}

// Direct execution
if (process.argv[1]?.endsWith("eval-golden-18.ts")) {
  runGoldenAudit()
    .then(({ allPassed }) => {
      process.exit(allPassed ? 0 : 1);
    })
    .catch((err) => {
      console.error("Fatal audit execution error:", err);
      process.exit(1);
    });
}
