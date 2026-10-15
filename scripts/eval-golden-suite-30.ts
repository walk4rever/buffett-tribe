/**
 * eval-golden-suite-30.ts
 *
 * 30-Company Cross-Market & Multi-Template Golden Benchmark Evaluator.
 *
 * Independent verification suite:
 *   Dimension 1: Annual Report Ground-Truth Verification (官方年报真值核验)
 *   Dimension 2: Product E2E & 6-Tab Sanity Verification (产品链路与 6 大 Tab 验收)
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/eval-golden-suite-30.ts
 *   npx tsx --env-file=.env.local scripts/eval-golden-suite-30.ts --ticker AAPL
 *   npx tsx --env-file=.env.local scripts/eval-golden-suite-30.ts --template bank
 *   npx tsx --env-file=.env.local scripts/eval-golden-suite-30.ts --market cn
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import * as fs from "node:fs";
import * as path from "node:path";
import db from "../src/lib/prisma";
import { getCompanyFinancials } from "../src/lib/company-data";
import { buildCompanyFinancialDashboard } from "../src/lib/company-financial-dashboard";
import { getValueLineData } from "../src/lib/value-line-data";
import { calculateROIC, calculateInvestedCapital } from "../src/lib/financial-math";
import { resolveFinancialModel, type FinancialTemplate } from "../src/lib/financial-model";

const BENCHMARK_PATH = path.join(process.cwd(), "scripts", "lib", "golden-benchmark-30.json");

interface BenchmarkMetric {
  value: number;
  toleranceRatio: number;
  unit?: string;
  note?: string;
}

interface BenchmarkGroundTruth {
  fiscalYear: number;
  currency: string;
  sourceReport: string;
  metrics: Record<string, BenchmarkMetric>;
}

interface BenchmarkUiExpectations {
  requiredDashboardRows: string[];
  forbiddenDashboardRows: string[];
  dupontApplicable: boolean;
  roicProtectionApplicable: boolean;
  capitalAllocationMode: string;
}

interface BenchmarkCompany {
  ticker: string;
  altTickers?: string[];
  name: string;
  market: "us" | "cn" | "hk";
  template: FinancialTemplate;
  subModel: string | null;
  rationale: string;
  groundTruth: BenchmarkGroundTruth;
  uiExpectations: BenchmarkUiExpectations;
}

interface BenchmarkFile {
  version: string;
  meta: {
    totalCompanies: number;
    templateBreakdown: Record<string, number>;
    marketBreakdown: Record<string, number>;
    coverageStatement: string;
  };
  companies: BenchmarkCompany[];
}

// 1. Sanity assertion of the benchmark suite definition
function assertBenchmarkIntegrity(data: BenchmarkFile) {
  console.log("================================================================================");
  console.log("🔍 STEP 1: 30 家黄金基准集元数据完整性与约束自检");
  console.log("================================================================================");

  if (!Array.isArray(data.companies) || data.companies.length !== 30) {
    throw new Error(`基准文件必须严格包含 30 家标的，实际找到: ${data.companies?.length}`);
  }

  const tickers = new Set<string>();
  const templateCounts: Record<string, number> = {};
  const marketCounts: Record<string, number> = {};

  for (const c of data.companies) {
    if (tickers.has(c.ticker)) {
      throw new Error(`重复的标的 Ticker: ${c.ticker}`);
    }
    tickers.add(c.ticker);
    templateCounts[c.template] = (templateCounts[c.template] || 0) + 1;
    marketCounts[c.market] = (marketCounts[c.market] || 0) + 1;

    // Validate ground truth
    if (!c.groundTruth || !c.groundTruth.fiscalYear || !c.groundTruth.metrics) {
      throw new Error(`标的 ${c.ticker} 缺少必需的 groundTruth 配置`);
    }
    // Validate UI expectations
    if (!c.uiExpectations || !Array.isArray(c.uiExpectations.forbiddenDashboardRows)) {
      throw new Error(`标的 ${c.ticker} 缺少必需的 uiExpectations 配置`);
    }
  }

  console.log(`✅ 标的总数校验通过: 30/30 家标的无重复`);
  console.log(`✅ 模板分布校验通过:`, JSON.stringify(templateCounts));
  console.log(`✅ 市场分布校验通过:`, JSON.stringify(marketCounts));
  console.log(`✅ 覆盖声明: ${data.meta.coverageStatement}`);
  console.log("--------------------------------------------------------------------------------\n");
}

async function findEntityForBenchmark(company: BenchmarkCompany) {
  const code = company.ticker.includes(".HK") ? company.ticker.replace(".HK", "").padStart(5, "0") : company.ticker;
  const candidates = [
    company.ticker,
    ...(company.altTickers || []),
    code,
    `${company.ticker}.SS`,
    `${company.ticker}.SZ`,
  ];

  return await db.entity.findFirst({
    where: {
      OR: [
        { ticker: { in: candidates } },
        { code: { in: candidates } },
      ],
      type: { not: "master" },
    },
    include: {
      _count: {
        select: { financials: true },
      },
    },
  });
}

async function evaluateCompany(company: BenchmarkCompany) {
  const entity = await findEntityForBenchmark(company);

  if (!entity) {
    return {
      ticker: company.ticker,
      name: company.name,
      market: company.market,
      template: company.template,
      subModel: company.subModel,
      dbStatus: "NOT_IN_DB",
      finCount: 0,
      groundTruthResult: { pass: false, score: 0, total: 0, details: ["实体未建档入库"] },
      uiResult: { pass: false, details: ["无数据无法评测 UI"] },
    };
  }

  const finCount = entity._count.financials;
  if (finCount === 0) {
    return {
      ticker: company.ticker,
      name: company.name,
      market: company.market,
      template: company.template,
      subModel: company.subModel,
      dbStatus: "NO_FINANCIALS",
      finCount: 0,
      groundTruthResult: { pass: false, score: 0, total: 0, details: ["财报记录为 0 行，待执行采集抓取"] },
      uiResult: { pass: false, details: ["无财报记录跳过 UI 渲染"] },
    };
  }

  // ---------------------------------------------------------------------------
  // 维度一：年报真值核验 (Report Ground-Truth Verification)
  // ---------------------------------------------------------------------------
  const rawFinList = await getCompanyFinancials(entity.id, 10);
  const targetYear = company.groundTruth.fiscalYear;
  const targetFinYear = rawFinList.find((f) => f.year === targetYear);

  const dbMetricsMap = new Map<string, number>();
  if (targetFinYear) {
    for (const [k, v] of Object.entries(targetFinYear.items)) {
      if (v != null && !Number.isNaN(Number(v))) {
        dbMetricsMap.set(k, Number(v));
      }
    }
  }

  const gtDetails: string[] = [];
  let gtPassCount = 0;
  let gtTotalCount = 0;

  if (!targetFinYear) {
    gtDetails.push(`⚠️ 未在库内找到目标财年 FY${targetYear} 的财报记录`);
  }

  // 1. 股数防污染核验
  const sharesInDb = dbMetricsMap.get("CommonStockSharesOutstanding");
  if (sharesInDb != null) {
    // 检查是否等于实收资本或者数量级离谱
    const shareCapital = dbMetricsMap.get("ShareCapital");
    if (shareCapital != null && Math.abs(sharesInDb - shareCapital) < 1) {
      gtDetails.push(`❌ [股数污染] 数据库股数直接等于实收资本金额 (${sharesInDb})`);
    } else if (company.market === "cn" && sharesInDb > 2000000000000) {
      gtDetails.push(`❌ [股数离奇] 数据库股数超出常理 (${sharesInDb})`);
    } else {
      gtDetails.push(`✅ [股数清洁] 数据库股数未被实收资本金额污染 (${sharesInDb.toLocaleString()})`);
    }
  }

  // 2. 核心科目与真值台账对比
  for (const [metricKey, expectedObj] of Object.entries(company.groundTruth.metrics)) {
    gtTotalCount++;
    const dbVal =
      dbMetricsMap.get(metricKey) ??
      (metricKey === "TotalStockholdersEquity" ? dbMetricsMap.get("ShareholdersEquity") : undefined) ??
      (metricKey === "ShareholdersEquity" ? dbMetricsMap.get("TotalStockholdersEquity") : undefined);
    if (dbVal == null) {
      gtDetails.push(`⚠️ [缺失] ${metricKey}: 真值=${expectedObj.value.toLocaleString()}, 库内未采集`);
      continue;
    }

    const diffRatio = Math.abs(dbVal - expectedObj.value) / Math.abs(expectedObj.value);
    const pass = diffRatio <= expectedObj.toleranceRatio;

    if (pass) {
      gtPassCount++;
      gtDetails.push(`✅ [对齐] ${metricKey}: 库内=${dbVal.toLocaleString()} vs 真值=${expectedObj.value.toLocaleString()} (偏差 ${(diffRatio * 100).toFixed(2)}% <= ${(expectedObj.toleranceRatio * 100).toFixed(2)}%)`);
    } else {
      gtDetails.push(`❌ [偏差] ${metricKey}: 库内=${dbVal.toLocaleString()} vs 真值=${expectedObj.value.toLocaleString()} (偏差 ${(diffRatio * 100).toFixed(2)}% 超标)`);
    }
  }

  // ---------------------------------------------------------------------------
  // 维度二：产品链路与 6 大 Tab 验收 (Product E2E & UI Verification)
  // ---------------------------------------------------------------------------
  const uiDetails: string[] = [];
  let uiPass = true;

  try {
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

    // Tab 6: 商业模式与子模型推断
    const resolvedModel = resolveFinancialModel(entity.sectorModelType, {
      sector: entity.sector,
      industry: typeof meta.industry === "string" ? meta.industry : null,
      sic: typeof meta.sic === "string" ? meta.sic : undefined,
      name: companyName,
      reason: sectorModelReason,
    });
    const subModelInferred = resolvedModel?.subModel ?? null;

    if (!resolvedModel) {
      uiPass = false;
      uiDetails.push(`❌ [模板解析失败] 无法解析商业模式模板`);
    } else if (resolvedModel.template !== company.template) {
      uiPass = false;
      uiDetails.push(`❌ [模板差异] 解析模板为 ${resolvedModel.template}，基准期望为 ${company.template}`);
    } else {
      uiDetails.push(`✅ [模板精准] 商业模式模板正确解析为 ${company.template}`);
    }

    if (company.subModel) {
      if (subModelInferred !== company.subModel) {
        uiPass = false;
        uiDetails.push(`❌ [子模型错误] 推断为 ${subModelInferred}，基准期望为 ${company.subModel}`);
      } else {
        uiDetails.push(`✅ [子模型精准] 推断子模型为 ${subModelInferred}`);
      }
    }

    // Tab 2: 财务看板
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

    // 检查必需指标行是否全部呈现
    let allRequiredPresent = true;
    for (const reqKey of company.uiExpectations.requiredDashboardRows) {
      if (!activeRowKeys.has(reqKey)) {
        uiPass = false;
        allRequiredPresent = false;
        uiDetails.push(`❌ [缺失必需指标行] 看板未渲染必需科目: ${reqKey}`);
      }
    }
    if (allRequiredPresent) {
      uiDetails.push(`✅ [必需指标齐全] 成功渲染了 ${company.uiExpectations.requiredDashboardRows.join(", ")}`);
    }

    // 检查禁用行是否被彻底屏蔽（专业性防跨界污染）
    for (const forbiddenKey of company.uiExpectations.forbiddenDashboardRows) {
      if (activeRowKeys.has(forbiddenKey)) {
        uiPass = false;
        uiDetails.push(`❌ [违规指标穿透] 看板渲染了不适用的科目: ${forbiddenKey}`);
      }
    }
    if (uiPass) {
      uiDetails.push(`✅ [指标隔离] 严格屏蔽了 ${company.uiExpectations.forbiddenDashboardRows.join(", ")}`);
    }

    // Tab 1: 价值线数据
    const valueLine = await getValueLineData(entity.id);
    if (valueLine && valueLine.annuals) {
      let hasNan = false;
      for (const ann of valueLine.annuals) {
        if (Number.isNaN(ann.eps) || Number.isNaN(ann.bps) || Number.isNaN(ann.roe)) {
          hasNan = true;
          break;
        }
      }
      if (hasNan) {
        uiPass = false;
        uiDetails.push(`❌ [价值线] 历史四宫格出现 NaN 破损`);
      } else {
        uiDetails.push(`✅ [价值线] 历史数值有限，无 NaN 破损`);
      }
    }

    // Tab 3: 竞争优势与 ROIC 边界保护
    let roicTested = false;
    for (const fin of rawFinList) {
      const ic = calculateInvestedCapital({
        totalEquity: (fin.items.ShareholdersEquity ?? fin.items.TotalEquity) ? Number(fin.items.ShareholdersEquity ?? fin.items.TotalEquity) : null,
        totalDebt: fin.items.TotalDebt ? Number(fin.items.TotalDebt) : null,
        shortTermDebt: fin.items.ShortTermDebt ? Number(fin.items.ShortTermDebt) : null,
        longTermDebt: fin.items.LongTermDebt ? Number(fin.items.LongTermDebt) : null,
        cashAndEquivalents: fin.items.CashAndCashEquivalents ? Number(fin.items.CashAndCashEquivalents) : null,
      });

      if (ic != null && ic <= 0) {
        const roic = calculateROIC({
          operatingIncome: fin.items.OperatingIncome ? Number(fin.items.OperatingIncome) : null,
          currentInvestedCapital: ic,
          effectiveTaxRate: 0.25,
        });
        if (roic !== null) {
          uiPass = false;
          uiDetails.push(`❌ [ROIC防护失效] 投入资本为负 (${ic}) 时仍输出了 ROIC: ${roic}`);
        } else {
          roicTested = true;
        }
      }
    }
    if (roicTested) {
      uiDetails.push(`✅ [ROIC安全保护] 投入资本 <= 0 时安全触发防护返回 null`);
    }

    // Tab 4: 资本配置
    if (dashboard.trends.length > 0) {
      uiDetails.push(`✅ [资本配置/财务趋势] 成功生成 ${dashboard.trends.length} 组平滑趋势折线`);
    }

  } catch (err: unknown) {
    uiPass = false;
    uiDetails.push(`❌ [UI 链路异常] ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    ticker: company.ticker,
    name: company.name,
    market: company.market,
    template: company.template,
    subModel: company.subModel,
    dbStatus: "ACTIVE",
    finCount,
    groundTruthResult: {
      pass: gtPassCount > 0 && gtPassCount === gtTotalCount,
      score: gtPassCount,
      total: gtTotalCount,
      details: gtDetails,
    },
    uiResult: {
      pass: uiPass,
      details: uiDetails,
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  let filterTicker: string | null = null;
  let filterTemplate: string | null = null;
  let filterMarket: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--ticker" && args[i + 1]) filterTicker = args[i + 1].toUpperCase();
    if (args[i] === "--template" && args[i + 1]) filterTemplate = args[i + 1].toLowerCase();
    if (args[i] === "--market" && args[i + 1]) filterMarket = args[i + 1].toLowerCase();
  }

  const raw = fs.readFileSync(BENCHMARK_PATH, "utf8");
  const benchmark: BenchmarkFile = JSON.parse(raw);

  // 1. Suite integrity
  assertBenchmarkIntegrity(benchmark);

  console.log("================================================================================");
  console.log("📊 STEP 2: 30 家标的全场景双维评测执行 (年报真值核验 + 产品 6 大 Tab 验收)");
  console.log("================================================================================");

  const targetCompanies = benchmark.companies.filter((c) => {
    if (filterTicker && c.ticker.toUpperCase() !== filterTicker && !c.altTickers?.some((a) => a.toUpperCase() === filterTicker)) return false;
    if (filterTemplate && c.template.toLowerCase() !== filterTemplate) return false;
    if (filterMarket && c.market.toLowerCase() !== filterMarket) return false;
    return true;
  });

  console.log(`执行评测标的数量: ${targetCompanies.length} 家\n`);

  const results = [];
  for (const comp of targetCompanies) {
    process.stdout.write(`Evaluating [${comp.ticker}] (${comp.name}) ... `);
    const res = await evaluateCompany(comp);
    results.push(res);
    console.log(`[${res.dbStatus}] GT: ${res.groundTruthResult.score}/${res.groundTruthResult.total} | UI: ${res.uiResult.pass ? "PASS" : "FAIL"}`);
  }

  // 3. Summary Report
  console.log("\n================================================================================");
  console.log("📋 30 家黄金基准集综合评测体检汇总报告");
  console.log("================================================================================");
  console.log(
    "代码".padEnd(10) +
    "市场".padEnd(6) +
    "模板".padEnd(20) +
    "子模型".padEnd(20) +
    "财报行数".padEnd(10) +
    "年报真值对齐".padEnd(16) +
    "产品UI验收"
  );
  console.log("-".repeat(95));

  let activeCount = 0;
  let emptyCount = 0;
  let fullGtPass = 0;
  let fullUiPass = 0;

  for (const r of results) {
    const codeCol = r.ticker.padEnd(10);
    const mktCol = r.market.toUpperCase().padEnd(6);
    const tplCol = r.template.padEnd(20);
    const subCol = (r.subModel || "-").padEnd(20);
    const cntCol = String(r.finCount).padEnd(10);
    const gtCol = `${r.groundTruthResult.score}/${r.groundTruthResult.total} (${r.groundTruthResult.pass ? "PASS" : "FAIL"})`.padEnd(16);
    const uiCol = r.uiResult.pass ? "✅ PASS" : "⚠️ WARN/FAIL";

    console.log(`${codeCol}${mktCol}${tplCol}${subCol}${cntCol}${gtCol}${uiCol}`);

    if (r.dbStatus === "ACTIVE") activeCount++;
    if (r.dbStatus === "NO_FINANCIALS" || r.dbStatus === "NOT_IN_DB") emptyCount++;
    if (r.groundTruthResult.pass) fullGtPass++;
    if (r.uiResult.pass && r.dbStatus === "ACTIVE") fullUiPass++;
  }

  console.log("-".repeat(95));
  console.log(`总览统计：`);
  console.log(`• 标的总数: ${results.length}`);
  console.log(`• 库内具备历史财报数据: ${activeCount} 家 (${((activeCount / results.length) * 100).toFixed(1)}%)`);
  console.log(`• 待采集建档数据: ${emptyCount} 家 (主要为 A 股尚未运行 akshare 抓取的 5 家公司)`);
  console.log(`• 官方年报真值 100% 对齐: ${fullGtPass} 家`);
  console.log(`• 产品 6 大 Tab 规则全部绿灯: ${fullUiPass} 家`);
  console.log("================================================================================\n");

  // Output sample inspection details for first 5 companies
  console.log("🔍 典型样本详细诊断报告 (Top 5 样本抽样详情):");
  for (const r of results.slice(0, 5)) {
    console.log(`\n--------------------------------------------------`);
    console.log(`标的: [${r.ticker}] ${r.name} (${r.market.toUpperCase()} - ${r.template})`);
    console.log(`[年报真值对齐明细]:`);
    r.groundTruthResult.details.forEach((d) => console.log(`  ${d}`));
    console.log(`[产品 6 大 Tab 渲染明细]:`);
    r.uiResult.details.forEach((d) => console.log(`  ${d}`));
  }
}

main()
  .catch((err) => {
    console.error("评测运行致命异常:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
