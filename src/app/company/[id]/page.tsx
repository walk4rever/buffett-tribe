import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CompanyBusinessCanvas, type BusinessCanvasData } from "@/components/CompanyBusinessCanvas";
import { CompanySectionTabs } from "@/components/CompanySectionTabs";
import { CompanyAgentDialog } from "@/components/CompanyAgentDialog";
import { SiteNav } from "@/components/SiteNav";
import { MasterHoldingCards } from "@/components/MasterHoldingCards";
import db from "@/lib/prisma";
import { getTribeMembers } from "@/lib/tribe";
import {
  formatMoney,
  getCompanyAnalysis,
  getCompanyByIdentifier,
  getCompanyFinancials,
  getFinancialsCurrency,
  getCompanySecurities,
  formatCompanyUrl,
  getRecentHolders,
  getCompanyReferenceFilings,
  type CompanyReferenceFiling,
} from "@/lib/company-data";
import {
  ManagementAnalysisSection,
  ValuationAnalysisSection,
  parseManagementPayload,
  parseValuationPayload,
} from "@/components/CompanyGeneratedSections";

import { StockPriceChartLazy } from "@/components/StockPriceChartLazy";
import { buildCompanyFinancialDashboard } from "@/lib/company-financial-dashboard";
import { formatShares } from "@/lib/master-data";
import { CompanyFinancialDashboardComponent } from "@/components/CompanyFinancialDashboard";
import { getValueLineData } from "@/lib/value-line-data";
import { BRAND_EN } from "@/lib/brand";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; embed?: string; ticker?: string }>;
}

type MoatDimension = {
  key: string;
  zhLabel: string;
  enLabel: string;
  score: number;
  verdict: string;
  evidence: string;
};

type MoatMock = {
  summary: {
    type: string;
    strength: string;
    durability: string;
    allocation: string;
    thesis: string;
  };
  dimensions: MoatDimension[];
  notes: Array<{ label: string; enLabel: string; value: string }>;
};

type RadarPoint = {
  x: number;
  y: number;
  labelX: number;
  labelY: number;
  anchor: "start" | "middle" | "end";
};

function normalizeTicker(value: string | null | undefined) {
  const ticker = value?.trim().toUpperCase() ?? "";
  return ticker || null;
}

function uniqueTickers(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map(normalizeTicker).filter((ticker): ticker is string => Boolean(ticker))));
}

function buildRadarPoints(count: number, radius: number, center: number) {
  return Array.from({ length: count }, (_, index) => {
    const angle = (-Math.PI / 2) + (index * Math.PI * 2) / count;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const anchor = Math.abs(cos) < 0.2 ? "middle" : cos > 0 ? "start" : "end";
    return {
      x: center + radius * cos,
      y: center + radius * sin,
      labelX: center + (radius + 24) * cos,
      labelY: center + (radius + 24) * sin,
      anchor,
    } satisfies RadarPoint;
  });
}

function buildRadarPolygon(points: RadarPoint[], values: number[], maxValue: number, center: number) {
  return points
    .map((point, index) => {
      const ratio = Math.max(0, Math.min(values[index], maxValue)) / maxValue;
      const x = center + (point.x - center) * ratio;
      const y = center + (point.y - center) * ratio;
      return `${x},${y}`;
    })
    .join(" ");
}

function circledIndex(index: number) {
  return String.fromCodePoint(9312 + index);
}

function formatPriceFromValueAndShares(valueUsd: bigint | null, shares: bigint | null) {
  if (valueUsd == null || shares == null || shares <= BigInt(0)) return "—";
  const p = Number(valueUsd) / Number(shares);
  return Number.isFinite(p) ? `$${p.toFixed(2)}` : "—";
}

function normalizeMeta(metadata: unknown): Record<string, string | number | boolean | null> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  return metadata as Record<string, string | number | boolean | null>;
}

type ReferenceFilingPill = {
  id: string;
  label: string;
  url: string | null;
  filedDate: string | null;
  quarterRank: number;
};

type ReferenceYearGroup = {
  yearLabel: string;
  pills: ReferenceFilingPill[];
};

function getQuarterRank(filing: CompanyReferenceFiling, form: string): number {
  const kind = filing.kind.toLowerCase();
  const formLower = form.toLowerCase();
  if (
    kind === "10k" ||
    formLower.includes("10-k") ||
    kind.includes("annual") ||
    formLower.includes("20-f") ||
    formLower.includes("40-f")
  ) {
    return 4;
  }
  if (filing.periodQuarter === 3 || kind.includes("q3")) return 3;
  if (filing.periodQuarter === 2 || kind.includes("interim")) return 2;
  if (filing.periodQuarter === 1 || kind.includes("q1")) return 1;
  return 0;
}

function formatFilingPillLabel(filing: CompanyReferenceFiling, form: string): string {
  const kind = filing.kind.toLowerCase();
  const formTrimmed = form.trim();
  const q = filing.periodQuarter;

  if (kind === "10k" || formTrimmed.includes("10-K")) {
    return formTrimmed.includes("/A") ? "10-K/A" : "10-K";
  }
  if (kind === "20f" || formTrimmed.includes("20-F")) return "20-F";
  if (kind === "40f" || formTrimmed.includes("40-F")) return "40-F";
  if (kind === "10q" || formTrimmed.includes("10-Q")) {
    const qPrefix = q ? `Q${q} · ` : "";
    return `${qPrefix}${formTrimmed.includes("/A") ? "10-Q/A" : "10-Q"}`;
  }
  if (kind === "cn-annual-report") return "年报";
  if (kind === "cn-interim-report") return "半年报";
  if (kind === "cn-quarterly-report") {
    if (q === 1) return "一季报";
    if (q === 3) return "三季报";
    return "季报";
  }
  if (kind === "hk-annual-report") return "年报";
  if (kind === "hk-interim-report") return "中期报告";
  if (kind === "hk-quarterly-report") {
    if (q === 1) return "一季度业绩";
    if (q === 3) return "三季度业绩";
    return "季度业绩";
  }
  if (kind.includes("prospectus")) return "招股说明书";
  return formTrimmed || filing.kind.toUpperCase();
}

function groupAndFormatReferenceFilings(
  filings: CompanyReferenceFiling[],
  companyCik: string | null
): ReferenceYearGroup[] {
  const groups = new Map<string, ReferenceFilingPill[]>();

  for (const filing of filings) {
    const meta = normalizeMeta(filing.metadata);
    const form = typeof meta.form === "string" && meta.form.trim() ? meta.form.trim() : filing.kind.toUpperCase();

    const accessionNumber =
      (typeof meta.accession === "string" && meta.accession) ||
      (typeof meta.accessionNumber === "string" && meta.accessionNumber) ||
      null;
    const constructedSecUrl =
      !filing.url && companyCik && accessionNumber
        ? `https://www.sec.gov/cgi-bin/viewer?action=view&cik=${companyCik}&accession_number=${accessionNumber}&xbrl_type=v`
        : null;
    const effectiveUrl = filing.url || constructedSecUrl;

    const filedDate = filing.filedAt ? filing.filedAt.toISOString().slice(0, 10) : null;
    const year = filing.periodYear ?? (filing.filedAt ? filing.filedAt.getFullYear() : null);
    const yearKey = year ? String(year) : (filing.kind.includes("prospectus") ? "招股/IPO" : "其他");

    const pill: ReferenceFilingPill = {
      id: filing.id,
      label: formatFilingPillLabel(filing, form),
      url: effectiveUrl,
      filedDate,
      quarterRank: getQuarterRank(filing, form),
    };

    if (!groups.has(yearKey)) groups.set(yearKey, []);
    groups.get(yearKey)!.push(pill);
  }

  const sortedYearKeys = [...groups.keys()].sort((a, b) => {
    const numA = Number(a);
    const numB = Number(b);
    if (!isNaN(numA) && !isNaN(numB)) return numB - numA;
    if (!isNaN(numA)) return -1;
    if (!isNaN(numB)) return 1;
    return a.localeCompare(b);
  });

  return sortedYearKeys.map((yearKey) => {
    const pills = groups.get(yearKey)!;
    pills.sort((a, b) => {
      if (a.quarterRank !== b.quarterRank) return b.quarterRank - a.quarterRank;
      const dateA = a.filedDate ?? "";
      const dateB = b.filedDate ?? "";
      return dateB.localeCompare(dateA);
    });

    return {
      yearLabel: yearKey,
      pills,
    };
  });
}

function formatSignedPct(diffPct: number | null) {
  if (diffPct == null || !Number.isFinite(diffPct)) return "—";
  const sign = diffPct > 0 ? "+" : "";
  return `${sign}${diffPct.toFixed(1)}%`;
}

function getMoatMock(companyName: string, ticker: string | null): MoatMock {
  const code = ticker?.toUpperCase() ?? null;

  if (code === "AAPL") {
    return {
      summary: {
        type: "复合型",
        strength: "强",
        durability: "高",
        allocation: "强",
        thesis: "核心护城河来自品牌、软硬件生态与转换成本的叠加，定价权和用户留存仍然稳固。",
      },
      dimensions: [
        {
          key: "regulatory",
          zhLabel: "特许准入",
          enLabel: "Franchise & Regulatory",
          score: 8.5,
          verdict: "全球消费电子核心标准制定者与应用分发监管关键节点。",
          evidence: "App Store 规则与生态分发体系具有极高准入门槛与生态控制力。",
        },
        {
          key: "network",
          zhLabel: "网络效应",
          enLabel: "Network Effects",
          score: 9.0,
          verdict: "双边网络效应稳固，开发者生态与全球活跃设备基数持续正反馈。",
          evidence: "全球超 20 亿活跃设备基数，吸引全球顶尖开发者优先适配 iOS 生态。",
        },
        {
          key: "cost",
          zhLabel: "成本优势",
          enLabel: "Cost Advantage",
          score: 8.8,
          verdict: "自研芯片与规模采购带来结构性毛利与供应链议价优势。",
          evidence: "自研 Apple Silicon 大幅优化功耗与硬件 BOM 成本，规模采购锁定产能。",
        },
        {
          key: "switching",
          zhLabel: "转换成本",
          enLabel: "Switching Costs",
          score: 9.3,
          verdict: "iCloud、多端互联与数据沉淀形成极高的用户迁移壁垒。",
          evidence: "跨设备无缝连续互通及服务绑定，使用户流失至 Android 的成本极高。",
        },
        {
          key: "intangibles",
          zhLabel: "无形资产",
          enLabel: "Brand & IP",
          score: 9.6,
          verdict: "全球最具辨识度的消费品品牌心智与海量技术专利积累。",
          evidence: "品牌忠诚度极高，长期保持消费电子行业第一利润份额。",
        },
      ],
      notes: [
        { label: "核心护城河", enLabel: "Core Moat", value: "软硬件垂直整合生态 + 极高品牌心智溢价" },
        { label: "最脆弱环节", enLabel: "Weakest Link", value: "高度依赖 iPhone 单一硬件产品线的换代周期" },
      ],
    };
  }

  return {
    summary: {
      type: "分析中",
      strength: "中",
      durability: "中",
      allocation: "中",
      thesis: `${companyName} 的长期竞争优势主要依托其行业地位、客户粘性与规模经济，深度壁垒持续追踪中。`,
    },
    dimensions: [
      { key: "regulatory", zhLabel: "特许准入", enLabel: "Franchise", score: 7.0, verdict: "行业准入及资质门槛提供基础经营保护。", evidence: "在细分市场具备合规及牌照资质。" },
      { key: "network", zhLabel: "网络效应", enLabel: "Network Effects", score: 6.5, verdict: "客户群体与业务体量形成一定协同效应。", evidence: "拥有稳固的商业运营与客户基础。" },
      { key: "cost", zhLabel: "成本优势", enLabel: "Cost Advantage", score: 7.2, verdict: "供应链管理与运营效率带来稳健盈利能力。", evidence: "历史报表展示其毛利水平具有一定抗周期性。" },
      { key: "switching", zhLabel: "转换成本", enLabel: "Switching Costs", score: 7.5, verdict: "业务深度整合或产品嵌入带来迁移门槛。", evidence: "客户留存率良好，复购行为较为明显。" },
      { key: "intangibles", zhLabel: "无形资产", enLabel: "Brand & IP", score: 7.8, verdict: "商标品牌、技术积累与管理层声誉构成竞争壁垒。", evidence: "具备行业知名度与核心知识产权储备。" },
    ],
    notes: [
      { label: "核心护城河", enLabel: "Core Moat", value: "细分行业领先地位与客户粘性" },
      { label: "最脆弱环节", enLabel: "Weakest Link", value: "宏观需求波动与新进入者竞争加剧" },
    ],
  };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id: rawId } = await params;
  const company = await getCompanyByIdentifier(rawId.trim());
  if (!company) return { title: "数字价值线 · 价值部落" };
  const meta = company.metadata as Record<string, unknown> | null;
  const zhName = typeof meta?.nameZh === "string" ? meta.nameZh : null;
  const title = `${zhName ? `${zhName} (${company.canonicalName})` : company.canonicalName} · 数字价值线 | 价值部落`;
  return {
    title,
    description: `${company.canonicalName} 的数字价值线与全维度投研分析卡片`,
  };
}

export default async function CompanyPage({ params, searchParams }: Props) {
  const { id: rawId } = await params;
  const { tab: rawTab, embed: rawEmbed, ticker: rawTicker } = await searchParams;
  const isEmbed = rawEmbed === "1";
  const trimmedId = rawId.trim();
  const company = await getCompanyByIdentifier(trimmedId);
  if (!company) notFound();

  // Canonical Company URL enforcement: /company/{market}-{code}
  const canonicalCompanyUrl = formatCompanyUrl(company);
  if (canonicalCompanyUrl && `/company/${trimmedId}` !== canonicalCompanyUrl) {
    const q = new URLSearchParams();
    if (rawTab) q.set("tab", rawTab);
    if (rawEmbed) q.set("embed", rawEmbed);
    // If user accessed via ticker (e.g. /company/GOOGL or /company/BRK-A)
    const passedTicker =
      rawTicker?.trim() ||
      (trimmedId.toUpperCase() !== company.ticker?.toUpperCase() &&
       /^[A-Za-z0-9.\-]+$/.test(trimmedId) &&
       !/^(us|cn|hk)-/i.test(trimmedId)
        ? trimmedId.toUpperCase()
        : null);
    if (passedTicker) {
      q.set("ticker", passedTicker);
    }
    const queryString = q.toString() ? `?${q.toString()}` : "";
    redirect(`${canonicalCompanyUrl}${queryString}`);
  }

  const [
    financials,
    financialsCurrency,
    holders,
    securities,
    analysis,
    referenceFilings,
    tribeMembers,
    valueLineData,
  ] = await Promise.all([
    getCompanyFinancials(company.id, 10),
    getFinancialsCurrency(company.id),
    getRecentHolders(company.id, 30),
    getCompanySecurities(company.id),
    getCompanyAnalysis(company.id),
    getCompanyReferenceFilings(company.id, 36),
    getTribeMembers(),
    getValueLineData(company.id, rawTicker),
  ]);
  const relatedInsights = await db.insightPost.findMany({
    where: { status: "published", entityIds: { has: company.id } },
    select: { slug: true, title: true, description: true, source: true, publishedAt: true },
    orderBy: [{ publishedAt: "desc" }, { updatedAt: "desc" }],
    take: 20,
  }).catch((error: unknown) => {
    console.error("[company-page] Failed to load related insights", error);
    return [];
  });
  const referenceYearGroups = groupAndFormatReferenceFilings(referenceFilings, company.cik);
  const tribeMemberById = new Map(tribeMembers.map((m) => [m.id, m] as const));

  const managementArtifact = analysis?.management != null
    ? { payload: analysis.management, generatedAt: analysis.updatedAt, source: analysis.source }
    : null;
  const valuationArtifact = analysis?.valuation != null
    ? { payload: analysis.valuation, generatedAt: analysis.updatedAt, source: analysis.source }
    : null;
  const hasManagement = managementArtifact != null && parseManagementPayload(managementArtifact.payload) != null;
  const hasValuation = valuationArtifact != null && parseValuationPayload(valuationArtifact.payload) != null;

  const availablePriceTickers = uniqueTickers([
    company.ticker,
    ...securities.map((item) => item.ticker),
  ]);

  if (availablePriceTickers.length > 0) {
    const existing = await db.stockPrice.findFirst({
      where: { ticker: { in: availablePriceTickers } },
      select: { ticker: true },
    });
    if (!existing) {
      availablePriceTickers.length = 0;
    }
  }

  const meta = (company.metadata as Record<string, unknown> | null) ?? {};
  const zhName =
    typeof meta.nameZh === "string" && meta.nameZh.trim() ? meta.nameZh.trim() : company.canonicalName;

  const rawCanvas = (analysis?.canvas ?? (analysis?.business as unknown as { canvas?: BusinessCanvasData } | null | undefined)?.canvas) as BusinessCanvasData | null | undefined;
  const businessCanvas =
    rawCanvas && Object.keys(rawCanvas).length > 0
      ? {
          canvas: rawCanvas,
          versionSeq: analysis?.version ?? 1,
          generatedAt: analysis?.updatedAt ?? new Date(),
        }
      : null;

  const rawMoat = analysis?.moat as unknown as MoatMock | null | undefined;
  const hasRealMoat = !!(rawMoat?.dimensions && rawMoat.dimensions.length > 0);
  const moat: MoatMock =
    hasRealMoat
      ? rawMoat!
      : getMoatMock(company.canonicalName, company.ticker);

  const strongestDimensions = [...moat.dimensions]
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  const weakestDimensions = [...moat.dimensions]
    .sort((a, b) => a.score - b.score)
    .slice(0, 2);
  const radarCenter = 168;
  const radarRadius = 94;
  const radarPoints = buildRadarPoints(moat.dimensions.length, radarRadius, radarCenter);
  const radarPolygon = buildRadarPolygon(
    radarPoints,
    moat.dimensions.map((dimension) => dimension.score),
    10,
    radarCenter,
  );
  const radarRings = [0.25, 0.5, 0.75, 1];
  const initialTabId = typeof rawTab === "string" ? rawTab.trim() : "";

  const dashboard = buildCompanyFinancialDashboard(
    { ...company, sectorModelType: valueLineData?.sectorModelType ?? null },
    financials,
    financialsCurrency,
  );

  // Phase 1 公司：只显示可用 tab + 深度分析按钮，不显示灰色锁住的 tab
  const onboardPhase = company.onboardPhase ?? 0;
  const showDeepAnalysisButton = onboardPhase === 1;
  const companyPriority = company.priority ?? 0;

  // A 股与港股因暂无 13F/公募外资大师持仓数据，默认隐藏该 Tab（若未来接入真实持仓则自动显示）
  const isCnHk = company.market === "cn" || company.market === "hk";
  const showHoldingsTab = !isCnHk || holders.holders.length > 0;

  const allTabs = [
    { id: "valueline",  label: "价值线",  desc: "数字价值线核心全景" },
    { id: "business",   label: "商业模式", desc: "九宫格商业模式画布",  ...(!businessCanvas  ? { disabled: true } : {}) },
    { id: "financial",  label: "财务分析", desc: "年度趋势与明细" },
    { id: "value",      label: "竞争优势", desc: "护城河雷达与资本回报", ...(!hasRealMoat    ? { disabled: true } : {}) },
    { id: "management", label: "资本配置", desc: "资本回报与股东回报纪律",  ...(!hasManagement  ? { disabled: true } : {}) },
    { id: "valuation",  label: "估值分析", desc: "历史分位与情景推演",  ...(!hasValuation   ? { disabled: true } : {}) },
    ...(showHoldingsTab ? [{ id: "holdings", label: "大师持仓", desc: "13F顶尖机构季度动向" }] : []),
  ];

  // Phase 1 时过滤掉 disabled 的 tab（商业模式、竞争优势、资本配置、估值分析）
  const visibleTabs = showDeepAnalysisButton
    ? allTabs.filter(tab => !tab.disabled)
    : allTabs;

  return (
    <div className={`company-page dvl-page ${isEmbed ? "company-page--embed" : ""}`}>
      {!isEmbed ? <SiteNav /> : null}
      <CompanyAgentDialog companyName={zhName} ticker={company.ticker} />

      <div className="company-wrap dvl-wrap">
        {/* ── Company Analysis Workspace ── */}
        <CompanySectionTabs
          tabs={visibleTabs}
          initialTabId={initialTabId || "valueline"}
          valueLineData={valueLineData}
          initialTicker={rawTicker}
          showDeepAnalysisButton={showDeepAnalysisButton}
          onboardPhase={onboardPhase}
          companyId={company.id}
          companyName={zhName}
          initialPriority={companyPriority}
        >
          {/* Tab 1 (valueline) is rendered internally by CompanySectionTabs via <ValueLineBody /> */}

          {/* Tab 2: Business Analysis — Business Model Canvas */}
          <section className="company-section" data-tab-panel="business">
            <div className="company-financial-trend-head">
              <h3>商业模式九宫格画布</h3>
              <span className="dvl-section-subtitle">解构客户细分、核心价值主张、渠道触点与成本收入模型</span>
            </div>

              {businessCanvas ? (
                <CompanyBusinessCanvas
                  data={businessCanvas.canvas}
                  meta={{
                    versionSeq: businessCanvas.versionSeq,
                    generatedAt: businessCanvas.generatedAt,
                  }}
                />
              ) : (
                <div className="company-canvas-placeholder">
                  <p>商业模式画布正在构建中。</p>
                  <span>可通过上方数字价值线卡片与下方财务分析了解该标的核心运营特征。</span>
                </div>
              )}
            </section>

            {/* Tab 2: Financial Analysis */}
            <section className="company-section" data-tab-panel="financial">
              <CompanyFinancialDashboardComponent
                dashboard={dashboard}
                financials={financials}
              />
            </section>

            {/* Tab 3: Value Analysis / Moat */}
            <section className="company-section" data-tab-panel="value">
              <div className="company-value-layout">
                <div className="company-radar-card">
                  <div className="company-radar-head">
                    <h3>十维评分</h3>
                    <p>10 Point Radar</p>
                  </div>
                  <svg viewBox="0 0 336 336" className="company-radar-svg" aria-label="竞争优势十维蜘蛛图">
                    {radarRings.map((ring) => {
                      const ringPoints = radarPoints
                        .map((point) => {
                          const x = radarCenter + (point.x - radarCenter) * ring;
                          const y = radarCenter + (point.y - radarCenter) * ring;
                          return `${x},${y}`;
                        })
                        .join(" ");
                      return <polygon key={ring} points={ringPoints} className="company-radar-ring" />;
                    })}
                    {radarPoints.map((point, index) => (
                      <line
                        key={moat.dimensions[index].key}
                        x1={radarCenter}
                        y1={radarCenter}
                        x2={point.x}
                        y2={point.y}
                        className="company-radar-axis"
                      />
                    ))}
                    <polygon points={radarPolygon} className="company-radar-area" />
                    {radarPoints.map((point, index) => {
                      const ratio = moat.dimensions[index].score / 10;
                      const x = radarCenter + (point.x - radarCenter) * ratio;
                      const y = radarCenter + (point.y - radarCenter) * ratio;
                      const scoreDx = x >= radarCenter ? 8 : -8;
                      const scoreDy = y >= radarCenter ? 4 : -6;
                      return (
                        <g key={`${moat.dimensions[index].key}-dot`}>
                          <circle cx={x} cy={y} r="3.2" className="company-radar-dot" />
                          <text
                            x={x + scoreDx}
                            y={y + scoreDy}
                            textAnchor={x >= radarCenter ? "start" : "end"}
                            className="company-radar-score"
                          >
                            {moat.dimensions[index].score}
                          </text>
                        </g>
                      );
                    })}
                    {radarPoints.map((point, index) => (
                      <g key={`${moat.dimensions[index].key}-label`}>
                        <text x={point.labelX} y={point.labelY} textAnchor={point.anchor} className="company-radar-label">
                          <tspan className="company-radar-index">{circledIndex(index)}</tspan>
                          <tspan dx="3">{moat.dimensions[index].zhLabel}</tspan>
                        </text>
                      </g>
                    ))}
                  </svg>
                </div>

                <div className="company-value-side">
                  <div className="company-moat-summary-grid">
                    <article className="company-moat-kicker">
                      <span>价值类型</span>
                      <strong>{moat.summary.type}</strong>
                      <small>Value Type</small>
                    </article>
                    <article className="company-moat-kicker">
                      <span>护城河强度</span>
                      <strong>{moat.summary.strength}</strong>
                      <small>Strength</small>
                    </article>
                    <article className="company-moat-kicker">
                      <span>持续性</span>
                      <strong>{moat.summary.durability}</strong>
                      <small>Durability</small>
                    </article>
                    <article className="company-moat-kicker">
                      <span>资本配置</span>
                      <strong>{moat.summary.allocation}</strong>
                      <small>Capital Allocation</small>
                    </article>
                  </div>
                  <p className="company-moat-thesis">{moat.summary.thesis}</p>

                  <div className="company-value-highlights">
                    <article className="company-value-note-block">
                      <h3>最强三项</h3>
                      <p>Top Strengths</p>
                      <ul>
                        {strongestDimensions.map((dimension) => (
                          <li key={dimension.key}>
                            <span>
                              <span className="company-value-index">{circledIndex(moat.dimensions.findIndex((item) => item.key === dimension.key))}</span>
                              {" "}
                              {dimension.zhLabel}
                            </span>
                            <strong>{dimension.score}</strong>
                          </li>
                        ))}
                      </ul>
                    </article>
                    <article className="company-value-note-block">
                      <h3>相对短板</h3>
                      <p>Weak Spots</p>
                      <ul>
                        {weakestDimensions.map((dimension) => (
                          <li key={dimension.key}>
                            <span>
                              <span className="company-value-index">{circledIndex(moat.dimensions.findIndex((item) => item.key === dimension.key))}</span>
                              {" "}
                              {dimension.zhLabel}
                            </span>
                            <strong>{dimension.score}</strong>
                          </li>
                        ))}
                      </ul>
                    </article>
                  </div>
                </div>
              </div>

              <div className="company-value-table">
                {moat.dimensions.map((dimension) => (
                  <article key={dimension.key} className="company-value-row">
                    <div className="company-value-row-head">
                      <div>
                        <h3>
                          <span className="company-value-index">{circledIndex(moat.dimensions.findIndex((item) => item.key === dimension.key))}</span>
                          {" "}
                          {dimension.zhLabel}
                        </h3>
                        <p>{dimension.enLabel}</p>
                      </div>
                      <div className="company-value-row-score" aria-label={`${dimension.zhLabel} ${dimension.score} / 10`}>
                        <strong>{dimension.score}</strong>
                        <span>/ 10</span>
                      </div>
                    </div>
                    <p className="company-value-row-verdict">{dimension.verdict}</p>
                    <p className="company-value-row-evidence">{dimension.evidence}</p>
                  </article>
                ))}
              </div>

              <div className="company-moat-notes">
                {moat.notes.map((note) => (
                  <article key={note.label} className="company-moat-note">
                    <h3>{note.label}</h3>
                    <p className="company-moat-note-en">{note.enLabel}</p>
                    <p className="company-moat-note-value">{note.value}</p>
                  </article>
                ))}
              </div>
            </section>

            {/* Tab 4: Capital Allocation */}
            <section className="company-section" data-tab-panel="management">
              {hasManagement && managementArtifact ? (
                <ManagementAnalysisSection artifact={managementArtifact} usFiling={Boolean(company.cik)} />
              ) : (
                <div className="company-placeholder-grid">
                  <article className="company-placeholder-card">
                    <h3>回购与分红纪律</h3>
                    <p>后续可接入历史回购注销、股息率、分红率与股本变化追踪。</p>
                  </article>
                  <article className="company-placeholder-card">
                    <h3>资本配置与再投资</h3>
                    <p>后续可补充并购、资本开支、投资回报率（ROIC/ROE）与再投资纪律的长期跟踪。</p>
                  </article>
                  <article className="company-placeholder-card">
                    <h3>股东利益一致性</h3>
                    <p>后续可接入股权激励稀释、管理层利益捆绑与长期激励机制评估。</p>
                  </article>
                </div>
              )}
            </section>

            {/* Tab 5: Valuation Analysis */}
            <section className="company-section" data-tab-panel="valuation">
              {availablePriceTickers.length > 0 ? (
                <div className="dvl-tab-price-block" style={{ marginBottom: "2rem" }}>
                  <div className="company-financial-trend-head">
                    <h3>全周期行情走势</h3>
                    <span className="dvl-section-subtitle">支持日线、周线、成交量及多档周期交互 (1M ~ Max)</span>
                  </div>
                  <StockPriceChartLazy tickers={availablePriceTickers} />
                </div>
              ) : null}

              {hasValuation && valuationArtifact ? (
                <ValuationAnalysisSection artifact={valuationArtifact} />
              ) : (
                <div className="company-placeholder-grid">
                  <article className="company-placeholder-card">
                    <h3>倍数估值</h3>
                    <p>后续可展示 PE、EV/EBIT、P/FCF、PS 等历史区间与行业对比。</p>
                  </article>
                  <article className="company-placeholder-card">
                    <h3>现金流模型</h3>
                    <p>后续可接入 DCF、增长假设、资本回报和安全边际区间。</p>
                  </article>
                  <article className="company-placeholder-card">
                    <h3>估值判断</h3>
                    <p>后续可把价格历史、财务趋势和资本配置合成一个统一的估值结论。</p>
                  </article>
                </div>
              )}
            </section>

            {/* Tab 6: Master Holdings (13F) */}
            {showHoldingsTab ? (
              <section className="company-section" data-tab-panel="holdings">
                <MasterHoldingCards
                  holders={valueLineData?.topHolders ?? []}
                  title="大师持仓"
                  hint="13F 持仓季度变化"
                />

                <div className="company-financial-trend-head">
                  <h3>最新持仓明细</h3>
                  <span className="dvl-section-subtitle">最近披露 · 清仓记录为清仓前持仓</span>
                </div>
                {holders.holders.length ? (
                  <>
                    <div className="company-holders-table-wrap">
                      <table className="company-holders-table">
                        <thead>
                          <tr>
                            <th className="holdings-th">机构<br/><span className="holdings-th-en">Holder</span></th>
                            <th className="holdings-th holdings-th--num">仓位<br/><span className="holdings-th-en">% of Portfolio</span></th>
                            <th className="holdings-th">近期动作<br/><span className="holdings-th-en">Recent Activity</span></th>
                            <th className="holdings-th holdings-th--num">动作季度<br/><span className="holdings-th-en">Activity Quarter</span></th>
                            <th className="holdings-th holdings-th--num">持股<br/><span className="holdings-th-en">Shares</span></th>
                            <th className="holdings-th holdings-th--num">申报价<br/><span className="holdings-th-en">Reported Price*</span></th>
                            <th className="holdings-th holdings-th--num">市值（亿）<br/><span className="holdings-th-en">Value</span></th>
                          </tr>
                        </thead>
                        <tbody>
                          {holders.holders.map((h, i) => {
                            const member = h.tribeId ? tribeMemberById.get(h.tribeId) ?? null : null;
                            const holderName = member?.nameZh ?? h.holderName;
                            const prevHolder = i > 0 ? holders.holders[i - 1] : null;
                            const isFirstOfGroup = !prevHolder || prevHolder.holderName !== h.holderName;
                            return (
                              <tr
                                key={`${h.id}-${h.ticker ?? "unknown"}-${h.sourceYear ?? "unknown"}-${h.sourceQuarter ?? "unknown"}-${i}`}
                                className={h.isSoldOut ? "company-holders-row--soldout" : ""}
                              >
                                <td className="holdings-td holdings-td--num company-holders-holder">
                                  {isFirstOfGroup ? (
                                    h.tribeId ? (
                                      <Link href={`/master/${h.tribeId}`} className="company-holder-link company-holder-link--name">
                                        <strong>{holderName}</strong>
                                      </Link>
                                    ) : (
                                      <strong>{holderName}</strong>
                                    )
                                  ) : (
                                    <span />
                                  )}
                                </td>
                                <td className="holdings-td holdings-td--num">
                                  {h.percent != null ? `${h.percent.toFixed(2)}%` : "—"}
                                </td>
                                <td className="holdings-td holdings-td--act">
                                  {h.activity === "SoldOut" ? (
                                    <span className="holdings-activity-soldout">Sold Out</span>
                                  ) : h.activity === "New" ? (
                                    <span className="holdings-activity-new">New</span>
                                  ) : h.activity === "Added" ? (
                                    <span className="holdings-activity-delta holdings-activity-delta--up">
                                      ↑ {formatSignedPct(h.shareDeltaPct)}
                                    </span>
                                  ) : h.activity === "Reduced" ? (
                                    <span className="holdings-activity-delta holdings-activity-delta--down">
                                      ↓ {formatSignedPct(h.shareDeltaPct)}
                                    </span>
                                  ) : (
                                    <span className="holdings-activity-delta">—</span>
                                  )}
                                </td>
                                <td className="holdings-td holdings-td--num">
                                  {h.sourceYear != null && h.sourceQuarter != null
                                    ? `${h.sourceYear} Q${h.sourceQuarter}`
                                    : "—"}
                                </td>
                                <td className="holdings-td holdings-td--num">
                                  {formatShares(h.shares)}
                                </td>
                                <td className="holdings-td holdings-td--num">
                                  {formatPriceFromValueAndShares(h.valueUsd, h.shares)}
                                </td>
                                <td className="holdings-td holdings-td--num">
                                  {formatMoney(h.valueUsd == null ? null : String(h.valueUsd))}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <p className="company-footnote">
                      申报价 = SEC 13F 申报市值 ÷ 股数，仅供成本参考；清仓行显示清仓前最后一次披露数据。
                    </p>
                  </>
                ) : (
                  <div className="company-empty">
                    {company.market === "us" || company.cik
                      ? "暂无部落大师 13F 重仓记录。"
                      : "当前 13F 披露体系主要覆盖美股标的，A 股与港股大师持仓（公募/外资）后续接入中。"}
                  </div>
                )}
              </section>
            ) : null}

        </CompanySectionTabs>

        <section
          id="company-references"
          className="company-section company-reference-section"
          tabIndex={-1}
        >
          <div className="company-bottom-section-heading">
            <h2>官方公告</h2>
            <span>招股书 · 年报 · 季报</span>
          </div>
          {referenceYearGroups.length ? (
            <div className="company-reference-timeline">
              {referenceYearGroups.map((group) => (
                <div key={group.yearLabel} className="company-reference-year-row">
                  <div className="company-reference-year-label">{group.yearLabel}</div>
                  <div className="company-reference-pills">
                    {group.pills.map((pill) => {
                      const tooltip = pill.filedDate
                        ? `披露日期: ${pill.filedDate}`
                        : "暂无披露日期";
                      if (pill.url) {
                        return (
                          <a
                            key={pill.id}
                            className="company-reference-pill"
                            href={pill.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={tooltip}
                          >
                            <span>{pill.label}</span>
                            <span className="company-reference-pill-arrow">↗</span>
                          </a>
                        );
                      }
                      return (
                        <span
                          key={pill.id}
                          className="company-reference-pill company-reference-pill--disabled"
                          title={`${tooltip} (暂无直链)`}
                        >
                          <span>{pill.label}</span>
                        </span>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : company.cik ? (
            <p className="company-empty">暂无可用的官方报告。</p>
          ) : (
            <p className="company-empty">
              {company.market === "cn"
                ? "A 股年报原文暂未接入，可前往"
                : "港股年报原文暂未接入，可前往"}{" "}
              <a
                href={company.market === "cn" ? "http://www.cninfo.com.cn/" : "https://www.hkexnews.hk/index.htm"}
                target="_blank"
                rel="noopener noreferrer"
              >
                {company.market === "cn" ? "巨潮资讯网" : "披露易 HKEXnews"}
              </a>
              {" "}搜索「{company.code}」查看原文。
            </p>
          )}
        </section>

        <section className="company-section company-related-section">
          <div className="company-bottom-section-heading">
            <h2>相关文章</h2>
          </div>
          {relatedInsights.length ? (
            <div className="company-related-insights">
              {relatedInsights.map((article) => {
                const formattedDate = article.publishedAt
                  ? new Intl.DateTimeFormat("zh-CN", {
                      year: "numeric",
                      month: "2-digit",
                      day: "2-digit",
                    }).format(article.publishedAt)
                  : null;

                return (
                  <Link
                    key={article.slug}
                    href={`/insights/${article.slug}`}
                    className="home-insight-card company-related-insight-card"
                  >
                    <div className="home-insight-card-head">
                      <span className="home-insight-source">{article.source || BRAND_EN}</span>
                      {formattedDate && (
                        <span className="home-insight-date">{formattedDate}</span>
                      )}
                    </div>
                    <h4 className="home-insight-title">{article.title}</h4>
                    {article.description && (
                      <p className="home-insight-desc">{article.description}</p>
                    )}
                  </Link>
                );
              })}
            </div>
          ) : (
            <p className="company-empty">暂无相关文章。</p>
          )}
        </section>
      </div>
    </div>
  );
}
