import Link from "next/link";
import { notFound } from "next/navigation";
import { CompanyDisplayName } from "@/components/CompanyDisplayName";
import { CompanyBusinessCanvas } from "@/components/CompanyBusinessCanvas";
import { CompanySectionTabs } from "@/components/CompanySectionTabs";
import { SiteNav } from "@/components/SiteNav";
import db from "@/lib/prisma";
import { getTribeMember } from "@/lib/tribe";
import {
  formatMoney,
  getBusinessCanvas,
  getCompanyAnalysis,
  getCompanyByCik,
  getCompanyFinancials,
  getCompanySecurities,
  getRecentHolders,
} from "@/lib/company-data";

import { StockPriceChartLazy } from "@/components/StockPriceChartLazy";
import { buildCompanyFinancialDashboard } from "@/lib/company-financial-dashboard";
import { formatShares } from "@/lib/master-data";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ cik: string }>;
}

type YearItems = { year: number; periodEnd: Date; items: Record<string, string> };
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

type CompanyNarrative = {
  overview: {
    title: string;
    content: string;
  };
  business: {
    title: string;
    content: string;
  };
};

type RadarPoint = {
  x: number;
  y: number;
  labelX: number;
  labelY: number;
  anchor: "start" | "middle" | "end";
};

function num(items: Record<string, string>, key: string) {
  const raw = items[key];
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function getFiscalDate(financials: YearItems[], year: number) {
  const row = financials.find((f) => f.year === year);
  return row?.periodEnd ?? null;
}

function formatFiscalDate(date: Date | null) {
  if (!date) return "—";
  return date.toISOString().slice(0, 10);
}

function normalizeMeta(metadata: unknown): Record<string, string | number | boolean | null> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  return metadata as Record<string, string | number | boolean | null>;
}

function formatSecurityLabel(security: {
  ticker: string | null;
  shareClass: string | null;
  titleOfClass: string | null;
}) {
  const ticker = security.ticker?.trim().toUpperCase() ?? "—";
  const shareClass = security.shareClass?.trim();
  const titleOfClass = security.titleOfClass?.trim();
  const titleClassMatch = titleOfClass?.match(/\bCL(?:ASS)?\s+([A-Z])\b/i);
  const shareClassMatch = shareClass?.match(/\bCLASS?\s+([A-Z])\b/i);
  const classLetter = shareClassMatch?.[1]?.toUpperCase() ?? titleClassMatch?.[1]?.toUpperCase() ?? null;
  const label = classLetter ? `Class ${classLetter}` : null;
  return label ? `${ticker} · ${label}` : ticker;
}

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
  if (valueUsd == null || shares == null) return "—";
  const v = Number(valueUsd);
  const s = Number(shares);
  if (!Number.isFinite(v) || !Number.isFinite(s) || s <= 0) return "—";
  return `$${(v / s).toFixed(2)}`;
}

function formatSignedPct(diffPct: number | null) {
  if (diffPct == null || !Number.isFinite(diffPct)) return "—";
  const sign = diffPct > 0 ? "+" : "";
  return `${sign}${diffPct.toFixed(1)}%`;
}

function formatFilingDate(date: Date | null) {
  if (!date) return "—";
  return date.toISOString().slice(0, 10);
}

function formatFileSize(bytes: bigint | null) {
  if (bytes == null) return "—";
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return "—";
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

function buildCompanyNarrative(params: {
  companyName: string;
  ticker: string | null;
  sector: string | null;
  industry: string | null;
  exchange: string | null;
  latestYear: number | null;
  revenue: number | null;
}): CompanyNarrative {
  const { companyName, ticker, sector, industry, exchange, latestYear, revenue } = params;
  const code = ticker?.toUpperCase() ?? null;

  if (code === "AAPL") {
    return {
      overview: {
        title: "公司基本信息",
        content: `苹果是一家在 ${exchange ?? "美国"} 上市的全球消费科技公司，定位于高端消费电子与数字生态平台，业务覆盖硬件、软件与互联网服务，核心市场遍布北美、欧洲与亚洲主要消费市场。`,
      },
      business: {
        title: "业务概览",
        content: `核心收入仍由 iPhone 驱动，同时通过 Mac、iPad、Apple Watch、AirPods 与服务业务构建软硬件一体化生态。最近一个完整财年（FY ${latestYear ?? "—"}）营收约 ${formatMoney(revenue == null ? null : String(revenue))}，商业模式的关键在于设备销售、服务订阅与高频复购。`,
      },
    };
  }

  const marketText = exchange ? `在 ${exchange} 上市的` : "公开上市的";
  const sectorText = sector?.trim() || industry?.trim() || "行业";
  const industryText = industry?.trim() && industry?.trim() !== sector?.trim()
    ? `，细分方向为 ${industry.trim()}`
    : "";
  const revenueText = latestYear && revenue != null
    ? `最近一个完整财年（FY ${latestYear}）营收约 ${formatMoney(String(revenue))}。`
    : "最近完整财年的收入结构仍待补充。";

  return {
    overview: {
      title: "公司基本信息",
      content: `${companyName} 是一家${marketText}${sectorText}公司${industryText}。当前页面以 SEC 档案和结构化财报为基础，重点关注其行业位置、主营业务与长期竞争优势。`,
    },
    business: {
      title: "业务概览",
      content: `${companyName} 的主营产品与服务结构仍需继续补充；当前可先结合 10-K 财报和行业属性理解其收入来源、核心产品线与增长引擎。${revenueText}`,
    },
  };
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
          zhLabel: "监管与准入壁垒",
          enLabel: "Regulatory / Access Barrier",
          score: 3,
          verdict: "消费电子不是典型牌照行业，但全球标准、供应链认证与平台规则构成一定隐性准入门槛。",
          evidence: "新进入者很难同时复制全球品牌、操作系统生态与供应链协同。",
        },
        {
          key: "scale",
          zhLabel: "规模与经营壁垒",
          enLabel: "Scale / Operating Barrier",
          score: 8,
          verdict: "全球经营规模、现金储备和供应链组织能力构成显著经营壁垒。",
          evidence: "苹果能在新品周期内快速放量，并维持全球范围的库存与履约稳定性。",
        },
        {
          key: "product",
          zhLabel: "技术与产品壁垒",
          enLabel: "Technology / Product Edge",
          score: 9,
          verdict: "硬件、芯片、系统与工业设计协同，形成长期产品差异化。",
          evidence: "自研芯片、iOS/macOS 统一体验、旗舰产品迭代节奏稳定。",
        },
        {
          key: "cost",
          zhLabel: "成本优势",
          enLabel: "Cost Advantage",
          score: 5,
          verdict: "并非最低成本生产者，但供应链规模和议价能力明显领先。",
          evidence: "对核心元件、代工与渠道具有强采购和备货优势。",
        },
        {
          key: "distribution",
          zhLabel: "渠道与分销控制",
          enLabel: "Distribution Power",
          score: 7,
          verdict: "直营零售与全球运营商渠道并存，触达深度强。",
          evidence: "Apple Store、官网与运营商体系共同支撑新品放量。",
        },
        {
          key: "brand",
          zhLabel: "品牌与心智",
          enLabel: "Brand Power",
          score: 10,
          verdict: "高端消费电子中品牌溢价最强之一，具备持续提价能力。",
          evidence: "高 ASP、旺季新品拉动与二手保值率共同支撑品牌力。",
        },
        {
          key: "experience",
          zhLabel: "用户体验与黏性",
          enLabel: "Experience / Stickiness",
          score: 9,
          verdict: "跨设备体验顺滑，日常高频使用带来稳定复购。",
          evidence: "iPhone、Mac、Watch、AirPods 与 iCloud 的联动体验完整。",
        },
        {
          key: "network",
          zhLabel: "网络效应",
          enLabel: "Network Effect",
          score: 8,
          verdict: "开发者、配件和服务生态形成弱到中等平台效应。",
          evidence: "App Store、订阅服务与第三方生态增强平台吸附力。",
        },
        {
          key: "switching",
          zhLabel: "转换成本",
          enLabel: "Switching Cost",
          score: 9,
          verdict: "用户迁移到其他平台时，设备、数据与习惯成本都很高。",
          evidence: "照片、聊天、订阅、配件和跨设备协同都会提高迁移摩擦。",
        },
        {
          key: "allocation",
          zhLabel: "资本配置强",
          enLabel: "Capital Allocation",
          score: 8,
          verdict: "现金流极强，回购纪律与股东回报机制成熟。",
          evidence: "长期大规模回购、自由现金流充沛、资本开支与股东回报平衡较好。",
        },
      ],
      notes: [
        {
          label: "核心护城河",
          enLabel: "Core Moat",
          value: "品牌溢价 + 生态闭环 + 高转换成本。",
        },
        {
          label: "最脆弱点",
          enLabel: "Weakest Link",
          value: "创新节奏放缓后，平台控制力可能被 AI 新入口与监管稀释。",
        },
        {
          label: "5年观察指标",
          enLabel: "Watchlist",
          value: "iPhone ASP、服务收入占比、活跃设备数、App Store 监管变化。",
        },
      ],
    };
  }

  return {
    summary: {
      type: "待判断",
      strength: "中",
      durability: "中",
      allocation: "中",
      thesis: `${companyName} 的护城河判断仍需结合行业结构、客户黏性与资本配置进一步补充。`,
    },
      dimensions: [
      {
        key: "regulatory",
        zhLabel: "监管与准入壁垒",
        enLabel: "Regulatory / Access Barrier",
        score: 3,
        verdict: "已有一定行业门槛，但是否长期有效还需核实。",
        evidence: "建议补充监管、资源、重资产或渠道许可方面的证据。",
      },
      {
        key: "scale",
        zhLabel: "规模与经营壁垒",
        enLabel: "Scale / Operating Barrier",
        score: 4,
        verdict: "经营规模是否能压制竞争，需要结合固定成本结构和密度优势判断。",
        evidence: "建议补充规模效应、单位经济模型和区域密度数据。",
      },
      {
        key: "product",
        zhLabel: "技术与产品壁垒",
        enLabel: "Technology / Product Edge",
        score: 4,
        verdict: "可能具备一定产品差异化，但还不能确认可持续性。",
        evidence: "建议补充专利、研发强度、毛利率结构与新品迭代证据。",
      },
      {
        key: "cost",
        zhLabel: "成本优势",
        enLabel: "Cost Advantage",
        score: 4,
        verdict: "成本优势是否真实存在，需用行业对比验证。",
        evidence: "建议补充单位成本、费用率、周转和供应链效率。",
      },
      {
        key: "distribution",
        zhLabel: "渠道与分销控制",
        enLabel: "Distribution Power",
        score: 4,
        verdict: "渠道是否构成壁垒，取决于控制力而不是覆盖面本身。",
        evidence: "建议补充经销体系、终端控制和议价能力。",
      },
      {
        key: "brand",
        zhLabel: "品牌与心智",
        enLabel: "Brand Power",
        score: 4,
        verdict: "品牌强弱需要结合溢价能力和复购率判断。",
        evidence: "建议补充价格带、份额稳定性和用户忠诚度数据。",
      },
      {
        key: "experience",
        zhLabel: "用户体验与黏性",
        enLabel: "Experience / Stickiness",
        score: 4,
        verdict: "用户体验是否转化为高复购和高留存仍需验证。",
        evidence: "建议补充 NPS、留存率、ARPU 或复购周期。",
      },
      {
        key: "network",
        zhLabel: "网络效应",
        enLabel: "Network Effect",
        score: 2,
        verdict: "暂未确认存在显著的平台或数据反馈效应。",
        evidence: "如有生态、平台或双边网络，应单列补证。",
      },
      {
        key: "switching",
        zhLabel: "转换成本",
        enLabel: "Switching Cost",
        score: 4,
        verdict: "客户是否难以离开，是判断护城河强度的关键。",
        evidence: "建议补充合同绑定、流程嵌入、数据迁移和替换成本。",
      },
      {
        key: "allocation",
        zhLabel: "资本配置强",
        enLabel: "Capital Allocation",
        score: 4,
        verdict: "资本配置能力会显著影响长期复利质量，但不应只看分红回购。",
        evidence: "建议补充再投资回报率、回购纪律、并购成效与现金流质量。",
      },
    ],
    notes: [
      {
        label: "核心护城河",
        enLabel: "Core Moat",
        value: "待补充。建议先明确是成本型、品牌型、渠道型还是生态型。",
      },
      {
        label: "最脆弱点",
        enLabel: "Weakest Link",
        value: "如果竞争优势主要来自周期、景气或短期供需，那么持续性会偏弱。",
      },
      {
        label: "5年观察指标",
        enLabel: "Watchlist",
        value: "毛利率、市场份额、资本开支回报、客户留存、价格带稳定性。",
      },
    ],
  };
}

export default async function CompanyPage({ params }: Props) {
  const { cik: rawCik } = await params;
  const company = await getCompanyByCik(rawCik.trim());
  if (!company) notFound();

  const [financials, holders, securities, analysis, businessCanvas, referenceFilings] = await Promise.all([
    getCompanyFinancials(company.id, 5),
    getRecentHolders(company.id, 30),
    getCompanySecurities(company.id),
    getCompanyAnalysis(company.id),
    getBusinessCanvas(company.id),
    db.extSource.findMany({
      where: {
        filerEntityId: company.id,
        kind: { in: ["10k", "20f", "40f"] },
      },
      orderBy: [{ periodYear: "desc" }, { periodQuarter: "desc" }, { ts: "desc" }],
      take: 12,
      select: {
        id: true,
        kind: true,
        url: true,
        ts: true,
        filedAt: true,
        periodYear: true,
        periodQuarter: true,
        metadata: true,
        attachments: {
          select: {
            sequence: true,
            description: true,
            documentType: true,
            documentName: true,
            url: true,
          },
          orderBy: [{ sequence: "asc" }],
        },
        artifacts: {
          select: {
            kind: true,
            objectKey: true,
            contentType: true,
            sizeBytes: true,
            originalName: true,
            sourceUrl: true,
            publicUrl: true,
          },
          orderBy: [{ kind: "asc" }, { createdAt: "asc" }],
        },
      },
    }),
  ]);

  const priceTickers = uniqueTickers([
    company.ticker,
    ...securities.map((security) => security.ticker),
  ]);

  const priceTickerCounts = await Promise.all(
    priceTickers.map(async (ticker) => ({
      ticker,
      count: await db.stockPrice.count({ where: { ticker } }),
    }))
  );
  const availablePriceTickers = priceTickerCounts
    .filter(({ count }) => count > 0)
    .map(({ ticker }) => ticker);

  const listedSecurities = securities.length
    ? securities.map(formatSecurityLabel)
    : [company.ticker ?? "—"];

  const latest = financials[0];
  const dashboard = buildCompanyFinancialDashboard(company, financials);
  const rev = latest ? num(latest.items, "Revenue") : null;

  const meta = normalizeMeta(company.metadata);
  const zhName =
    (typeof meta.nameZh === "string" && meta.nameZh.trim()) ? meta.nameZh.trim() : company.canonicalName;
  const enNameShort =
    (typeof meta.nameEnShort === "string" && meta.nameEnShort.trim()) ? meta.nameEnShort.trim() : company.canonicalName;
  const latestYear = dashboard.latestYear;
  const displayYears = dashboard.displayYears;
  const profileFacts = [
    { label: "CIK", subLabel: "CIK", value: company.cik ?? "—" },
    {
      label: "行业",
      subLabel: "Sector",
      value: company.sector?.trim() || "—",
    },
    {
      label: "细分",
      subLabel: "Industry",
      value: (typeof meta.industry === "string" && meta.industry.trim()) ? meta.industry.trim() : "—",
    },
    {
      label: "交易所",
      subLabel: "Exchange",
      value: (typeof meta.exchange === "string" && meta.exchange.trim()) ? meta.exchange.trim() : "—",
    },
    {
      label: "证券代码",
      subLabel: "Securities",
      value: listedSecurities.filter((label) => label !== "—").join(" / ") || "—",
    },
  ];

  const moat: MoatMock = analysis?.moat
    ? (analysis.moat as unknown as MoatMock)
    : getMoatMock(company.canonicalName, company.ticker);
  const companyNarrative: CompanyNarrative = analysis?.narrative
    ? (analysis.narrative as unknown as CompanyNarrative)
    : buildCompanyNarrative({
        companyName: company.canonicalName,
        ticker: company.ticker,
        sector: company.sector ?? null,
        industry: typeof meta.industry === "string" ? meta.industry : null,
        exchange: typeof meta.exchange === "string" ? meta.exchange : null,
        latestYear,
        revenue: rev,
      });
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
  const referenceArtifactCount = referenceFilings.reduce((sum, filing) => sum + filing.artifacts.length, 0);

  return (
    <div className="company-page">
      <SiteNav />

      <div className="company-wrap">
        <section className="company-hero">
          <div className="company-hero-main">
            <div className="company-hero-copy">
              <p className="company-eyebrow">SEC 公司档案</p>
              <h1 className="company-name">
                <CompanyDisplayName
                  zhName={zhName}
                  enName={enNameShort}
                  className="company-display--hero"
                />
              </h1>
            </div>
            <div className="company-intro-band">
              <div className="company-narrative-block">
                <h3>{companyNarrative.overview.title}</h3>
                <p className="company-intro">{companyNarrative.overview.content}</p>
              </div>
            </div>
            <aside className="company-profile-card" aria-label="Company profile">
              <dl className="company-profile-grid">
                {profileFacts.map((fact) => (
                  <div key={fact.label} className="company-profile-row">
                    <dt>
                      <span className="company-profile-label">{fact.label}</span>
                      <span className="company-profile-sub">{fact.subLabel}</span>
                    </dt>
                    <dd>{fact.value}</dd>
                  </div>
                ))}
              </dl>
            </aside>
          </div>
        </section>

        <section className="company-section">
          <div className="company-section-head">
            <h2>大师持仓（13F）</h2>
          </div>
          {holders.holders.length ? (
            <>
              <div className="company-holders-table-wrap">
                <table className="company-holders-table">
                  <thead>
                    <tr>
                      <th className="holdings-th">机构<br/><span className="holdings-th-en">Holder</span></th>
                      <th className="holdings-th">证券<br/><span className="holdings-th-en">Ticker</span></th>
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
                      const member = h.tribeId ? getTribeMember(h.tribeId) : null;
                      const holderName = member?.nameZh ?? h.holderName;
                      // Show holder name only on first row of the group
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
                          <td className="holdings-td holdings-td--num company-holders-stock">
                            <strong>{h.ticker ?? "—"}</strong>
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
                            {formatMoney(h.valueUsd)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="company-holders-note">* Reported Price = 市值 ÷ 持股数，按申报日折算。Sold Out 行的仓位、持股、申报价和市值为清仓前最后一次披露的持仓数据。</p>
            </>
          ) : (
            <p className="company-empty">暂无该公司的持仓记录。</p>
          )}
        </section>

        <CompanySectionTabs
          tabs={[
            { id: "business", label: "业务分析" },
            { id: "financial", label: "财务分析" },
            { id: "value", label: "价值分析" },
            { id: "management", label: "管理分析", note: "构建中" },
            { id: "valuation", label: "估值分析", note: "构建中" },
            { id: "references", label: "参考资料" },
          ]}
        >
          <section className="company-section" data-tab-panel="business">
            <div className="company-financial-trend-head">
              <h3>业务概览</h3>
            </div>
            <div className="company-text-card">
              <p>{companyNarrative.business.content}</p>
            </div>
            <div className="company-financial-trend-head">
              <h3>业务画布{businessCanvas ? "" : "（构建中）"}</h3>
            </div>
            {businessCanvas ? (
              <CompanyBusinessCanvas data={businessCanvas} />
            ) : (
              <div className="company-canvas-placeholder">
                <p>商业画布数据正在构建中。</p>
                <span>可结合上方业务概览与下方财务分析了解这家公司。</span>
              </div>
            )}
          </section>

          <section className="company-section" data-tab-panel="financial">
            <div className="company-kpi-grid">
              {dashboard.cards.map((card) => (
                <article className="company-kpi-card" key={card.key}>
                  <p>{card.label}</p>
                  <strong>{card.value}</strong>
                  <span>{card.hint}</span>
                </article>
              ))}
            </div>
            <div className="company-financial-trend-head">
              <h3>5 年趋势证据</h3>
              <span>{displayYears.length ? `${displayYears[displayYears.length - 1]}–${displayYears[0]}` : ""}</span>
            </div>
            {displayYears.length ? (
              <div className="company-table-wrap">
                <table className="company-table">
                  <thead>
                    <tr>
                      <th>
                        <span className="company-table-label">指标</span>
                        <span className="company-table-sub">Metric</span>
                      </th>
                      {displayYears.map((year) => (
                        <th key={year}>
                          <span className="company-table-label">FY {year}</span>
                          <span className="company-table-sub">{formatFiscalDate(getFiscalDate(financials, year))}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.rows.map((line) => (
                      <tr key={line.key}>
                        <td>
                          <span className="company-table-label">{line.zhLabel}</span>
                          <span className="company-table-sub">{line.enLabel}</span>
                        </td>
                        {displayYears.map((year) => (
                          <td key={`${line.key}-${year}`}>{line.values[year] ?? "—"}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="company-empty">暂无 10-K 年报结构化数据。可先运行 `import:10k` 脚本。</p>
            )}
            {dashboard.longTermTrends.length ? (
              <div className="company-long-term-block" aria-label="长期趋势摘要">
                <div className="company-financial-trend-head">
                  <h3>长期复合增长</h3>
                </div>
                <div className="company-long-term-trends">
                  {dashboard.longTermTrends.map((trend) => (
                    <article key={trend.key}>
                      <span>{trend.label}</span>
                      <strong>{trend.value}</strong>
                      <small>{trend.hint}</small>
                    </article>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          <section className="company-section" data-tab-panel="value">
            <div className="company-value-layout">
              <div className="company-radar-card">
                <div className="company-radar-head">
                  <h3>十维评分</h3>
                  <p>10 Point Radar</p>
                </div>
                <svg viewBox="0 0 336 336" className="company-radar-svg" aria-label="价值分析十维蜘蛛图">
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

          <section className="company-section" data-tab-panel="management">
            <div className="company-placeholder-grid">
              <article className="company-placeholder-card">
                <h3>管理层与董事会</h3>
                <p>后续可接入 CEO、CFO、董事会结构、任职履历与关键股权激励信息。</p>
              </article>
              <article className="company-placeholder-card">
                <h3>资本配置</h3>
                <p>后续可补充回购、并购、分红、投资回报率与管理层执行纪律的长期跟踪。</p>
              </article>
              <article className="company-placeholder-card">
                <h3>组织与文化</h3>
                <p>后续可接入管理层访谈、股东信、10-K 讨论区和公司治理相关证据。</p>
              </article>
            </div>
          </section>

          <section className="company-section" data-tab-panel="valuation">
            {availablePriceTickers.length > 0 ? (
              <section className="company-price-section company-price-section--embedded">
                <div className="company-price-embed-head">
                  <h3>价格历史</h3>
                  <span>估值参考</span>
                </div>
                <StockPriceChartLazy tickers={availablePriceTickers} />
              </section>
            ) : null}
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
                <p>后续可把价格历史、财务趋势和管理分析合成一个统一的估值结论。</p>
              </article>
            </div>
          </section>

          <section className="company-section" data-tab-panel="references">
            <div className="company-financial-trend-head">
              <h3>参考资料</h3>
              <span>{referenceFilings.length ? `${referenceFilings.length} 份 filing · ${referenceArtifactCount} 个原始文件` : "暂无原始资料"}</span>
            </div>
            {referenceFilings.length ? (
              <div className="company-reference-list">
                {referenceFilings.map((filing) => {
                  const meta = normalizeMeta(filing.metadata);
                  const form = typeof meta.form === "string" && meta.form.trim() ? meta.form.trim() : filing.kind.toUpperCase();
                  const periodLabel = filing.periodYear
                    ? `${filing.periodYear}${filing.periodQuarter ? ` Q${filing.periodQuarter}` : ""}`
                    : "—";
                  const filedLabel = formatFilingDate(filing.filedAt ?? filing.ts);
                  const primaryArtifact = filing.artifacts.find((artifact) => artifact.kind === "primary_html") ?? null;
                  const indexArtifact = filing.artifacts.find((artifact) => artifact.kind === "index_html") ?? null;
                  const attachments = filing.artifacts.filter((artifact) => artifact.kind === "attachment");
                  const dataFiles = filing.artifacts.filter((artifact) => artifact.kind === "data_file");

                  return (
                    <article key={filing.id} className="company-reference-card">
                      <div className="company-reference-card-head">
                        <div>
                          <h3>
                            {periodLabel} · {form}
                          </h3>
                          <p>
                            Filed {filedLabel}
                            {filing.ts ? ` · Report date ${formatFilingDate(filing.ts)}` : ""}
                          </p>
                        </div>
                        <div className="company-reference-card-meta">
                          <span>{filing.artifacts.length} files</span>
                        </div>
                      </div>

                      <div className="company-reference-links">
                        {filing.url ? (
                          <a href={filing.url} target="_blank" rel="noreferrer">
                            SEC filing
                          </a>
                        ) : null}
                        {primaryArtifact?.publicUrl ? (
                          <a href={primaryArtifact.publicUrl} target="_blank" rel="noreferrer">
                            Primary HTML
                          </a>
                        ) : null}
                        {indexArtifact?.publicUrl ? (
                          <a href={indexArtifact.publicUrl} target="_blank" rel="noreferrer">
                            Index page
                          </a>
                        ) : null}
                      </div>

                      <div className="company-reference-artifact-grid">
                        <article className="company-reference-mini">
                          <span>原始 HTML</span>
                          <strong>{primaryArtifact ? primaryArtifact.originalName ?? "—" : "—"}</strong>
                          <small>{primaryArtifact ? formatFileSize(primaryArtifact.sizeBytes) : "—"}</small>
                        </article>
                        <article className="company-reference-mini">
                          <span>索引页</span>
                          <strong>{indexArtifact ? indexArtifact.originalName ?? "—" : "—"}</strong>
                          <small>{indexArtifact ? formatFileSize(indexArtifact.sizeBytes) : "—"}</small>
                        </article>
                        <article className="company-reference-mini">
                          <span>附件</span>
                          <strong>{attachments.length}</strong>
                          <small>{dataFiles.length ? `${dataFiles.length} 个 data files` : "无 data files"}</small>
                        </article>
                      </div>

                      {(attachments.length || dataFiles.length) ? (
                        <details className="company-reference-details">
                          <summary>查看原始文件</summary>
                          <div className="company-reference-file-groups">
                            {attachments.length ? (
                              <div className="company-reference-file-group">
                                <p>Attachments</p>
                                <ul>
                                  {attachments.map((artifact) => (
                                    <li key={artifact.objectKey}>
                                      <a href={artifact.publicUrl ?? artifact.sourceUrl ?? "#"} target="_blank" rel="noreferrer">
                                        {artifact.originalName ?? artifact.objectKey.split("/").pop() ?? "attachment"}
                                      </a>
                                      <span>{formatFileSize(artifact.sizeBytes)}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}
                            {dataFiles.length ? (
                              <div className="company-reference-file-group">
                                <p>Data Files</p>
                                <ul>
                                  {dataFiles.map((artifact) => (
                                    <li key={artifact.objectKey}>
                                      <a href={artifact.publicUrl ?? artifact.sourceUrl ?? "#"} target="_blank" rel="noreferrer">
                                        {artifact.originalName ?? artifact.objectKey.split("/").pop() ?? "data file"}
                                      </a>
                                      <span>{formatFileSize(artifact.sizeBytes)}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}
                          </div>
                        </details>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="company-empty">暂无 10-K 归档资料。可先运行 `import:10k` 脚本。</p>
            )}
          </section>
        </CompanySectionTabs>
      </div>
    </div>
  );
}
