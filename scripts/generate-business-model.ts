/**
 * Generate and upsert business overview plus Business Model Canvas for companies.
 *
 * Usage:
 *   tsx scripts/generate-business-model.ts --company AAPL [--dry-run] [--force]
 *   tsx scripts/generate-business-model.ts --all [--dry-run] [--force]
 */

import "dotenv/config";
import { writeFile } from "node:fs/promises";
import {
  AI_MODEL,
  buildFilingEvidenceText,
  buildFinancialDashboardText,
  buildFinancialHistoryText,
  callJsonLLM,
  disconnectPrisma,
  fetchFinancials,
  fetchLatestFilingEvidence,
  findCompanies,
  getArg,
  hasFlag,
  jsonObject,
  normalizeText,
  parseJsonObject,
  prisma,
  toJsonValue,
} from "./lib/company-generation";

const PROMPT_VERSION = "business-model-v1";

type NarrativeSection = {
  title: string;
  content: string;
};

type CanvasPayload = {
  customerSegments: CanvasEntry[];
  valuePropositions: CanvasEntry[];
  channels: CanvasEntry[];
  customerRelationships: CanvasEntry[];
  revenueStreams: CanvasEntry[];
  keyResources: CanvasEntry[];
  keyActivities: CanvasEntry[];
  keyPartnerships: CanvasEntry[];
  costStructure: CanvasEntry[];
};

type CanvasEntry = {
  text: string;
  evidence: string[];
  sources: string[];
  confidence?: number;
};

const CANVAS_KEYS: Array<keyof CanvasPayload> = [
  "customerSegments",
  "valuePropositions",
  "channels",
  "customerRelationships",
  "revenueStreams",
  "keyResources",
  "keyActivities",
  "keyPartnerships",
  "costStructure",
];

const SYSTEM_PROMPT = `You are a business analyst specializing in value investing. Given company facts, financial data, and SEC filing evidence, generate a Chinese business model analysis in JSON format.

Output shape:
{
  "businessNarrative": {
    "title": "主打产品、服务与营收结构",
    "content": "200字左右的中文描述，包括核心产品/服务、收入来源、商业模式特点。"
  },
  "canvas": {
    "customerSegments": [{ "text": "...", "evidence": ["..."], "sources": ["..."], "confidence": 0.9 }],
    "valuePropositions": [...],
    "channels": [...],
    "customerRelationships": [...],
    "revenueStreams": [...],
    "keyResources": [...],
    "keyActivities": [...],
    "keyPartnerships": [...],
    "costStructure": [...]
  }
}

Rules:
- Use Chinese for all user-facing content.
- businessNarrative.content must end with a Chinese full stop.
- Each canvas field should contain 3-5 concise bullet objects.
- Each canvas bullet must include text, evidence, and sources.
- Prefer SEC filing evidence over generic industry assumptions.
- For revenueStreams, prefer exact revenue numbers and percentage shares when available.
- For costStructure, prefer exact cost amounts, cost ratios, or margin ratios when available.
- Mark uncertain inferred items with "（推测）" and optional confidence below 0.7.
- Keep each evidence snippet short, ideally under 20 Chinese characters or 12 English words.
- Output ONLY valid JSON. No markdown, no explanation.`;

function parseBusinessModel(raw: string): { businessNarrative: NarrativeSection; canvas: CanvasPayload } {
  const parsed = parseJsonObject(raw);
  const businessNarrative = jsonObject(parsed.businessNarrative);
  if (!businessNarrative) {
    throw new Error("Invalid businessNarrative");
  }

  const title = normalizeText(businessNarrative.title);
  const content = normalizeText(businessNarrative.content);
  if (!title || !content) {
    throw new Error("Invalid businessNarrative title/content");
  }

  const canvas = jsonObject(parsed.canvas);
  if (!canvas) {
    throw new Error("Invalid canvas");
  }

  for (const key of CANVAS_KEYS) {
    const items = canvas[key];
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error(`Invalid canvas field: ${key}`);
    }
    for (const item of items) {
      const entry = jsonObject(item);
      if (!entry) {
        throw new Error(`Invalid canvas entry in field: ${key}`);
      }
      if (!normalizeText(entry.text)) {
        throw new Error(`Invalid canvas entry text in field: ${key}`);
      }
      if (!Array.isArray(entry.evidence) || entry.evidence.some((evidence) => !normalizeText(evidence))) {
        throw new Error(`Invalid canvas entry evidence in field: ${key}`);
      }
      if (!Array.isArray(entry.sources) || entry.sources.some((source) => !normalizeText(source))) {
        throw new Error(`Invalid canvas entry sources in field: ${key}`);
      }
      if (
        entry.confidence != null &&
        (typeof entry.confidence !== "number" || Number.isNaN(entry.confidence) || entry.confidence < 0 || entry.confidence > 1)
      ) {
        throw new Error(`Invalid canvas entry confidence in field: ${key}`);
      }
    }
  }

  return {
    businessNarrative: { title, content },
    canvas: canvas as CanvasPayload,
  };
}

function mergeNarrative(existing: unknown, business: NarrativeSection) {
  const object = jsonObject(existing);
  const overview = jsonObject(object?.overview);

  return {
    overview: {
      title: normalizeText(overview?.title) || "公司基本信息",
      content: normalizeText(overview?.content),
    },
    business,
  };
}

function buildPrompt(params: {
  name: string;
  ticker: string | null;
  sector: string | null;
  metadata: Record<string, unknown> | null;
  financials: Awaited<ReturnType<typeof fetchFinancials>>;
  filingEvidence: Awaited<ReturnType<typeof fetchLatestFilingEvidence>>;
}) {
  const dashboard = buildFinancialDashboardText({
    sector: params.sector,
    metadata: params.metadata,
    financials: params.financials,
  });
  const meta = params.metadata ?? {};

  return `Company: ${params.name}${params.ticker ? ` (${params.ticker})` : ""}
Sector: ${params.sector ?? "N/A"}
Industry: ${typeof meta.industry === "string" ? meta.industry : "N/A"}
Exchange: ${typeof meta.exchange === "string" ? meta.exchange : "N/A"}

Latest FY: ${dashboard.latestYear ?? "N/A"}
Key Metrics:
${dashboard.cardLines}

Financial history (5 years):
${buildFinancialHistoryText(params.financials)}

${buildFilingEvidenceText(params.filingEvidence)}

Generate the business overview and Business Model Canvas for this company.`;
}

async function main() {
  const companyQuery = getArg("--company");
  const dryRun = hasFlag("--dry-run");
  const force = hasFlag("--force");
  const all = hasFlag("--all");

  if (!companyQuery && !all) {
    console.error("Usage: tsx scripts/generate-business-model.ts --company <ticker|name|cik> [--dry-run] [--force]");
    console.error("       tsx scripts/generate-business-model.ts --all [--dry-run] [--force]");
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
    let lastModelResponse = "";

    const existingCanvas = await prisma.businessCanvas.findUnique({
      where: { entityId: company.id },
      select: { id: true, updatedAt: true, versionSeq: true },
    });
    const existingAnalysis = await prisma.companyAnalysis.findUnique({
      where: { entityId: company.id },
      select: { narrative: true, moat: true, source: true, version: true },
    });
    const existingBusiness = jsonObject(jsonObject(existingAnalysis?.narrative)?.business);
    if (existingCanvas && normalizeText(existingBusiness?.content) && !force) {
      const versionLabel = `V${existingCanvas.versionSeq}`;
      console.log(`  SKIP: already has business model (${versionLabel}, updatedAt: ${existingCanvas.updatedAt.toISOString()}), use --force to overwrite`);
      continue;
    }

    const financials = await fetchFinancials(company.id, 5);
    const filingEvidence = await fetchLatestFilingEvidence(company.id);
    console.log(`  Financials: ${financials.length} years`);
    console.log(`  Filing evidence: ${filingEvidence ? filingEvidence.filingLabel : "none"}`);

    const prompt = buildPrompt({
      name: company.canonicalName,
      ticker: company.ticker,
      sector: company.sector,
      metadata: (company.metadata as Record<string, unknown> | null) ?? null,
      financials,
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
        temperature: 0.2,
        maxTokens: 6000,
      });
      lastModelResponse = content;
      const parsed = parseBusinessModel(content);
      const nextVersionSeq = existingCanvas ? existingCanvas.versionSeq + 1 : 1;
      const generatedAt = new Date();
      const source = AI_MODEL ?? "unknown";
      const narrative = mergeNarrative(existingAnalysis?.narrative, parsed.businessNarrative);

      await prisma.$transaction(async (tx) => {
        const current = await tx.businessCanvas.upsert({
          where: { entityId: company.id },
          create: {
            entityId: company.id,
            canvas: toJsonValue(parsed.canvas),
            source,
            version: nextVersionSeq,
            versionSeq: nextVersionSeq,
            promptVersion: PROMPT_VERSION,
            generatedAt,
          },
          update: {
            canvas: toJsonValue(parsed.canvas),
            source,
            version: nextVersionSeq,
            versionSeq: nextVersionSeq,
            promptVersion: PROMPT_VERSION,
            generatedAt,
          },
        });

        await tx.businessCanvasVersion.create({
          data: {
            businessCanvasId: current.id,
            entityId: company.id,
            versionSeq: nextVersionSeq,
            canvas: toJsonValue(parsed.canvas),
            source,
            promptVersion: PROMPT_VERSION,
            generatedAt,
            filingLabel: filingEvidence?.filingLabel ?? null,
            filingAccession: filingEvidence?.accession ?? null,
          },
        });

        await tx.companyAnalysis.upsert({
          where: { entityId: company.id },
          create: {
            entityId: company.id,
            narrative: toJsonValue(narrative),
            moat: toJsonValue(existingAnalysis?.moat ?? {}),
            source,
            version: 1,
          },
          update: {
            narrative: toJsonValue(narrative),
            source,
            version: { increment: 1 },
          },
        });
      });

      console.log(`  Saved business overview and business canvas V${nextVersionSeq} (${CANVAS_KEYS.length} sections)`);
    } catch (err) {
      if (err instanceof Error && err.message.includes("JSON")) {
        try {
          await writeFile(
            `/tmp/business-model-${company.ticker ?? company.id}.raw.json`,
            JSON.stringify({ prompt, response: lastModelResponse, error: err.message }, null, 2),
          );
        } catch (writeErr) {
          console.error("  (failed to write debug artifact)", writeErr instanceof Error ? writeErr.message : String(writeErr));
        }
      }
      console.error("  Failed:", err instanceof Error ? err.message : String(err));
    }

    console.log();
  }

  await disconnectPrisma();
}

main().catch(async (err) => {
  console.error("[generate-business-model] fatal", err);
  await disconnectPrisma();
  process.exit(1);
});
