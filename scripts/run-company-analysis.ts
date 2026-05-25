import { PrismaClient } from "@prisma/client";
import { normalizeTicker } from "../src/lib/ticker";

const db = new PrismaClient();

const AI_API_KEY = process.env.AI_API_KEY;
const AI_API_BASE_URL = process.env.AI_API_BASE_URL;
const AI_MODEL = process.env.AI_MODEL;

function getArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  return args.find((_, i) => args[i - 1] === flag);
}
function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

async function findCompanies(query?: string) {
  if (!query) {
    return db.entity.findMany({
      where: { type: { in: ["company", "master"] } },
      select: { id: true, canonicalName: true, ticker: true, cik: true, sector: true, metadata: true },
      orderBy: { canonicalName: "asc" },
    });
  }

  const byTicker = await db.entity.findFirst({
    where: {
      type: { in: ["company", "master"] },
      ticker: { equals: normalizeTicker(query) ?? query, mode: "insensitive" }
    },
    select: { id: true, canonicalName: true, ticker: true, cik: true, sector: true, metadata: true },
    orderBy: [{ type: "desc" }, { updatedAt: "desc" }],
  });
  if (byTicker) return [byTicker];

  const cikQuery = query.replace(/\D/g, "");
  if (cikQuery && cikQuery.length >= 5) {
    const byCik = await db.entity.findUnique({
      where: { cik: cikQuery },
      select: { id: true, canonicalName: true, ticker: true, cik: true, sector: true, metadata: true },
    });
    if (byCik) return [byCik];
  }

  const byName = await db.entity.findMany({
    where: {
      type: { in: ["company", "master"] },
      OR: [
        { canonicalName: { contains: query, mode: "insensitive" } },
        { ticker: { equals: query, mode: "insensitive" } },
      ],
    },
    select: { id: true, canonicalName: true, ticker: true, cik: true, sector: true, metadata: true },
    orderBy: { canonicalName: "asc" },
    take: 20,
  });
  return byName;
}

async function fetchFinancials(entityId: string, limit = 5) {
  const familyIds = await db.entity.findMany({
    where: { OR: [{ id: entityId }, { ticker: { equals: (await db.entity.findUnique({ where: { id: entityId }, select: { ticker: true } }))?.ticker ?? undefined, mode: "insensitive" } }] },
    select: { id: true },
  }).then((rows) => rows.map((r) => r.id));

  const rows = await db.financial.findMany({
    where: { entityId: { in: familyIds }, periodType: "FY" },
    orderBy: [{ periodEnd: "desc" }, { lineItem: "asc" }],
    select: { periodEnd: true, lineItem: true, value: true, unit: true },
    take: 400,
  });

  const byYear = new Map<number, Record<string, string>>();
  for (const row of rows) {
    const year = row.periodEnd.getUTCFullYear();
    if (!byYear.has(year)) byYear.set(year, {});
    const bucket = byYear.get(year)!;
    if (!(row.lineItem in bucket) && row.value != null) {
      bucket[row.lineItem] = row.value.toString();
    }
  }

  return [...byYear.entries()]
    .sort((a, b) => b[0] - a[0])
    .slice(0, limit)
    .map(([year, items]) => ({ year, items }));
}

async function fetchHolders(entityId: string, limit = 10) {
  const securityScope = await db.security.findMany({
    where: { companyEntityId: entityId },
    select: { id: true, ticker: true },
  });
  const profileIds = securityScope.map((s) => s.id);

  const rows = await db.holding.findMany({
    where: {
      securityId: { in: profileIds },
    },
    orderBy: [{ holderEntityId: "asc" }, { asOfDate: "desc" }, { valueUsd: "desc" }],
    include: {
      holder: { select: { canonicalName: true, tribeId: true } },
      source: { select: { periodYear: true, periodQuarter: true } },
    },
    take: 500,
  });

  const byHolder = new Map<string, { name: string; tribeId: string | null; percent: number | null; valueUsd: bigint | null; sourceYear: number | null; sourceQuarter: number | null }>();
  for (const h of rows) {
    if (byHolder.has(h.holder.id)) continue;
    byHolder.set(h.holder.id, {
      name: h.holder.canonicalName,
      tribeId: h.holder.tribeId,
      percent: h.percentOfPortfolio,
      valueUsd: h.valueUsd,
      sourceYear: h.source.periodYear,
      sourceQuarter: h.source.periodQuarter,
    });
  }

  return [...byHolder.values()].slice(0, limit);
}

function formatMoney(v: string | null): string {
  if (!v) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  return `$${n.toLocaleString()}`;
}

function buildPrompt(params: {
  name: string;
  ticker: string | null;
  sector: string | null;
  financials: Array<{ year: number; items: Record<string, string> }>;
  holders: Array<{ name: string; tribeId: string | null; percent: number | null; valueUsd: bigint | null }>;
}): string {
  const finLines = params.financials.map((f) => {
    const items = Object.entries(f.items)
      .map(([k, v]) => `    ${k}: ${formatMoney(v)}`)
      .join("\n");
    return `  FY ${f.year}:\n${items}`;
  }).join("\n");

  const holderLines = params.holders.length
    ? params.holders.map((h) => `  - ${h.name}${h.tribeId ? ` (${h.tribeId})` : ""}: ${h.percent?.toFixed(2) ?? "—"}% 仓位`).join("\n")
    : "  暂无持仓记录";

  return `你是一位资深的价值投资分析师，擅长用中文撰写公司分析报告。

请基于以下数据，为 ${params.name}${params.ticker ? ` (${params.ticker})` : ""} 生成一份结构化的公司分析。

## 输入数据

### 行业
${params.sector ?? "未知"}

### 最近 ${params.financials.length} 年财务数据
${finLines}

### 主要机构持仓
${holderLines}

## 输出要求

请严格输出以下 JSON 格式，不要包含 markdown 代码块标记，只输出纯 JSON：

{
  "narrative": {
    "overview": {
      "title": "公司基本信息",
      "content": "200字左右的中文概述，包括公司定位、主营业务、市场地位。"
    },
    "business": {
      "title": "主打产品、服务与营收结构",
      "content": "200字左右的中文描述，包括核心产品/服务、收入来源、商业模式特点。"
    }
  },
  "moat": {
    "summary": {
      "type": "护城河类型，如：品牌型、成本型、网络效应型、复合型等",
      "strength": "强/中/弱",
      "durability": "高/中/低",
      "allocation": "强/中/弱",
      "thesis": "50字左右的核心投资逻辑总结"
    },
    "dimensions": [
      { "key": "regulatory", "zhLabel": "监管与准入壁垒", "enLabel": "Regulatory / Access Barrier", "score": 1-10, "verdict": "30字左右的中文评价", "evidence": "50字左右的支持论据" },
      { "key": "scale", "zhLabel": "规模与经营壁垒", "enLabel": "Scale / Operating Barrier", "score": 1-10, "verdict": "...", "evidence": "..." },
      { "key": "product", "zhLabel": "技术与产品壁垒", "enLabel": "Technology / Product Edge", "score": 1-10, "verdict": "...", "evidence": "..." },
      { "key": "cost", "zhLabel": "成本优势", "enLabel": "Cost Advantage", "score": 1-10, "verdict": "...", "evidence": "..." },
      { "key": "distribution", "zhLabel": "渠道与分销控制", "enLabel": "Distribution Power", "score": 1-10, "verdict": "...", "evidence": "..." },
      { "key": "brand", "zhLabel": "品牌与心智", "enLabel": "Brand Power", "score": 1-10, "verdict": "...", "evidence": "..." },
      { "key": "experience", "zhLabel": "用户体验与黏性", "enLabel": "Experience / Stickiness", "score": 1-10, "verdict": "...", "evidence": "..." },
      { "key": "network", "zhLabel": "网络效应", "enLabel": "Network Effect", "score": 1-10, "verdict": "...", "evidence": "..." },
      { "key": "switching", "zhLabel": "转换成本", "enLabel": "Switching Cost", "score": 1-10, "verdict": "...", "evidence": "..." },
      { "key": "allocation", "zhLabel": "资本配置强", "enLabel": "Capital Allocation", "score": 1-10, "verdict": "...", "evidence": "..." }
    ],
    "notes": [
      { "label": "核心护城河", "enLabel": "Core Moat", "value": "简短总结核心竞争力" },
      { "label": "最脆弱点", "enLabel": "Weakest Link", "value": "简短指出最大风险点" },
      { "label": "5年观察指标", "enLabel": "Watchlist", "value": "列出3-5个关键跟踪指标" }
    ]
  }
}

评分标准（1-10分）：
- 1-3分：几乎不构成护城河
- 4-6分：有一定优势但不显著
- 7-8分：较强的竞争优势
- 9-10分：极强的护城河

重要约束：
1. 所有 verdict 和 evidence 必须基于提供的财务数据，不要编造具体数字
2. 如果没有足够数据支撑，评分可以偏低，verdict 中说明"数据不足"
3. 输出必须是纯 JSON，不要 markdown 代码块
4. 所有 narrative 中的内容、moat.thesis、dimensions 中每个维度的 verdict 和 evidence、以及 notes 中每个维度的 value，句尾必须统一使用中文句号（。）结尾，确保标点格式的一致性`;
}

async function callAI(prompt: string): Promise<unknown> {
  if (!AI_API_KEY || !AI_API_BASE_URL || !AI_MODEL) {
    throw new Error("Missing AI_API_KEY / AI_API_BASE_URL / AI_MODEL env vars");
  }

  const res = await fetch(`${AI_API_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_API_KEY}`,
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        { role: "system", content: "You are a professional value investment analyst. Output only valid JSON." },
        { role: "user", content: prompt },
      ],
      temperature: 0.5,
      max_tokens: 4000,
      stream: false,
    }),
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`AI API error ${res.status}: ${errText}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = data.choices?.[0]?.message?.content?.trim() ?? "";

  // Strip markdown code block if present
  const jsonText = raw.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
  return JSON.parse(jsonText);
}

async function main() {
  const companyQuery = getArg("--company");
  const dryRun = hasFlag("--dry-run");
  const force = hasFlag("--force");
  const all = hasFlag("--all");

  if (!companyQuery && !all) {
    console.error("Usage: tsx scripts/run-company-analysis.ts --company <name-or-cik> [--dry-run] [--force]");
    console.error("       tsx scripts/run-company-analysis.ts --all [--dry-run] [--force]");
    process.exit(1);
  }

  const companies = await findCompanies(companyQuery);
  if (companies.length === 0) {
    console.error(`No company found for: ${companyQuery}`);
    process.exit(1);
  }

  console.log(`Found ${companies.length} company(s) to process\n`);

  for (const company of companies) {
    const label = `${company.canonicalName}${company.ticker ? ` (${company.ticker})` : ""}${company.cik ? ` [CIK: ${company.cik}]` : ""}`;
    console.log(`─── ${label} ───`);

    const existing = await db.companyAnalysis.findUnique({
      where: { entityId: company.id },
      select: { id: true, updatedAt: true },
    });
    if (existing && !force) {
      console.log(`  SKIP: already has analysis (updatedAt: ${existing.updatedAt.toISOString()}), use --force to overwrite`);
      continue;
    }

    const financials = await fetchFinancials(company.id, 5);
    const holders = await fetchHolders(company.id, 10);

    console.log(`  Financials: ${financials.length} years`);
    console.log(`  Holders: ${holders.length}`);

    const prompt = buildPrompt({
      name: company.canonicalName,
      ticker: company.ticker,
      sector: company.sector,
      financials,
      holders,
    });

    if (dryRun) {
      console.log("  DRY-RUN: would call AI with prompt (length:", prompt.length, "chars)");
      console.log("  Prompt preview:\n", prompt.slice(0, 800), "...\n");
      continue;
    }

    try {
      const result = await callAI(prompt);
      const parsed = result as {
        narrative: { overview: { title: string; content: string }; business: { title: string; content: string } };
        moat: { summary: Record<string, unknown>; dimensions: unknown[]; notes: unknown[] };
      };

      // Validate structure roughly
      if (!parsed.narrative || !parsed.moat || !Array.isArray(parsed.moat.dimensions)) {
        throw new Error("Invalid response structure");
      }

      await db.companyAnalysis.upsert({
        where: { entityId: company.id },
        create: {
          entityId: company.id,
          narrative: parsed.narrative,
          moat: parsed.moat,
          source: AI_MODEL ?? "unknown",
          version: 1,
        },
        update: {
          narrative: parsed.narrative,
          moat: parsed.moat,
          source: AI_MODEL ?? "unknown",
          version: { increment: 1 },
        },
      });

      console.log(`  ✓ Saved analysis (dimensions: ${parsed.moat.dimensions.length}, notes: ${parsed.moat.notes.length})`);
    } catch (err) {
      console.error(`  ✗ Failed:`, err instanceof Error ? err.message : String(err));
    }

    console.log();
  }

  await db.$disconnect();
}

main().catch(async (err) => {
  console.error("[run-company-analysis] fatal", err);
  await db.$disconnect();
  process.exit(1);
});
