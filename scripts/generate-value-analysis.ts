/**
 * Generate and upsert value analysis for companies.
 *
 * Usage:
 *   tsx scripts/generate-value-analysis.ts --company AAPL [--dry-run] [--force]
 *   tsx scripts/generate-value-analysis.ts --all [--dry-run] [--force]
 */

import "dotenv/config";
import {
  AI_MODEL,
  buildFilingEvidenceText,
  buildFinancialHistoryText,
  callJsonLLM,
  createGeneratedContentVersion,
  disconnectPrisma,
  fetchFinancials,
  fetchHolders,
  fetchLatestFilingEvidence,
  findCompanies,
  formatMoney,
  getArg,
  hasFlag,
  hasUsableFilingEvidence,
  jsonObject,
  normalizeText,
  parseJsonObject,
  prisma,
  toJsonValue,
} from "./lib/company-generation";

const PROMPT_VERSION = "value-analysis-v1";

type MoatPayload = {
  summary: Record<string, unknown>;
  dimensions: unknown[];
  notes: unknown[];
};

const SYSTEM_PROMPT = `You are a professional value investment analyst. Generate a Chinese value analysis in JSON format.

Output shape:
{
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

Scoring:
- 1-3: weak or no moat
- 4-6: moderate edge
- 7-8: strong competitive advantage
- 9-10: exceptional durable moat

Rules:
- This script generates only value analysis. Do not output company profile or business overview.
- Use financial data, holdings context, and SEC filing evidence. Avoid unsupported numeric claims.
- If evidence is insufficient, use lower scores and say "数据不足".
- moat.thesis, every verdict, every evidence, and every note value must end with a Chinese full stop.
- Output ONLY valid JSON. No markdown, no explanation.`;

function parseMoat(raw: string): MoatPayload {
  const parsed = parseJsonObject(raw);
  const moat = jsonObject(parsed.moat);
  if (!moat || !jsonObject(moat.summary) || !Array.isArray(moat.dimensions) || !Array.isArray(moat.notes)) {
    throw new Error("Invalid moat structure");
  }
  return moat as MoatPayload;
}

function existingOrEmptyNarrative(existing: unknown) {
  const object = jsonObject(existing);
  const overview = jsonObject(object?.overview);
  const business = jsonObject(object?.business);

  return {
    overview: {
      title: normalizeText(overview?.title) || "公司基本信息",
      content: normalizeText(overview?.content),
    },
    business: {
      title: normalizeText(business?.title) || "主打产品、服务与营收结构",
      content: normalizeText(business?.content),
    },
  };
}

function buildPrompt(params: {
  name: string;
  ticker: string | null;
  sector: string | null;
  financials: Awaited<ReturnType<typeof fetchFinancials>>;
  holders: Awaited<ReturnType<typeof fetchHolders>>;
  filingEvidence: Awaited<ReturnType<typeof fetchLatestFilingEvidence>>;
}) {
  const finLines = params.financials.map((f) => {
    const items = Object.entries(f.items)
      .map(([k, v]) => `    ${k}: ${formatMoney(v)}`)
      .join("\n");
    return `  FY ${f.year}:\n${items}`;
  }).join("\n");

  const holderLines = params.holders.length
    ? params.holders.map((h) => `  - ${h.name}${h.tribeId ? ` (${h.tribeId})` : ""}: ${h.percent?.toFixed(2) ?? "-"}% 仓位`).join("\n")
    : "  暂无持仓记录";

  return `Company: ${params.name}${params.ticker ? ` (${params.ticker})` : ""}
Sector: ${params.sector ?? "N/A"}

Financial data:
${finLines}

Major institutional holders:
${holderLines}

Financial history:
${buildFinancialHistoryText(params.financials)}

${buildFilingEvidenceText(params.filingEvidence)}

Generate only the value analysis moat payload.`;
}

async function main() {
  const companyQuery = getArg("--company");
  const dryRun = hasFlag("--dry-run");
  const force = hasFlag("--force");
  const all = hasFlag("--all");

  if (!companyQuery && !all) {
    console.error("Usage: tsx scripts/generate-value-analysis.ts --company <ticker|name|cik> [--dry-run] [--force]");
    console.error("       tsx scripts/generate-value-analysis.ts --all [--dry-run] [--force]");
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
    console.log(`--- ${label} ---`);

    const existing = await prisma.companyAnalysis.findUnique({
      where: { entityId: company.id },
      select: { narrative: true, moat: true, updatedAt: true },
    });
    const existingMoat = jsonObject(existing?.moat);
    if (existingMoat && Array.isArray(existingMoat.dimensions) && existingMoat.dimensions.length > 0 && !force) {
      console.log(`  SKIP: already has value analysis (updatedAt: ${existing?.updatedAt.toISOString()}), use --force to overwrite`);
      continue;
    }

    const financials = await fetchFinancials(company.id, 5);
    const holders = await fetchHolders(company.id, 10);
    const filingEvidence = await fetchLatestFilingEvidence(company.id);

    console.log(`  Financials: ${financials.length} years`);
    console.log(`  Holders: ${holders.length}`);
    console.log(`  Filing evidence: ${filingEvidence ? filingEvidence.filingLabel : "none"}`);

    const filingEvidenceState = filingEvidence ? `${filingEvidence.filingLabel} matched 0 sections` : "no 10-K/20-F/40-F filing found";
    if (!hasUsableFilingEvidence(filingEvidence)) {
      console.log(`  SKIP: no usable filing section evidence (${filingEvidenceState}) — refusing to generate a value analysis without SEC filing evidence`);
      continue;
    }

    const prompt = buildPrompt({
      name: company.canonicalName,
      ticker: company.ticker,
      sector: company.sector,
      financials,
      holders,
      filingEvidence,
    });

    if (dryRun) {
      console.log(`  DRY-RUN: would call AI with prompt (${prompt.length} chars)`);
      console.log(`  Prompt preview:\n${prompt.slice(0, 800)}...\n`);
      continue;
    }

    try {
      const content = await callJsonLLM({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: prompt,
        temperature: 0.4,
        maxTokens: 4000,
      });
      const moat = parseMoat(content);
      const narrative = existingOrEmptyNarrative(existing?.narrative);
      const source = AI_MODEL ?? "unknown";

      await prisma.$transaction(async (tx) => {
        await tx.companyAnalysis.upsert({
          where: { entityId: company.id },
          create: {
            entityId: company.id,
            narrative: toJsonValue(narrative),
            moat: toJsonValue(moat),
            source,
            version: 1,
          },
          update: {
            moat: toJsonValue(moat),
            source,
            version: { increment: 1 },
          },
        });

        await createGeneratedContentVersion({
          tx,
          scopeType: "entity",
          scopeId: company.id,
          artifactType: "value_analysis",
          payload: toJsonValue({ moat }),
          source,
          promptVersion: PROMPT_VERSION,
        });
      });

      console.log(`  Saved value analysis (dimensions: ${moat.dimensions.length}, notes: ${moat.notes.length})`);
    } catch (err) {
      console.error("  Failed:", err instanceof Error ? err.message : String(err));
    }

    console.log();
  }

  await disconnectPrisma();
}

main().catch(async (err) => {
  console.error("[generate-value-analysis] fatal", err);
  await disconnectPrisma();
  process.exit(1);
});
