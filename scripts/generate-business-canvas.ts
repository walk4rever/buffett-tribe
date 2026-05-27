/**
 * Generate and upsert Business Model Canvas (9-grid) for companies using LLM.
 *
 * Usage:
 *   tsx scripts/generate-business-canvas.ts --company AAPL [--dry-run] [--force]
 *   tsx scripts/generate-business-canvas.ts --all [--dry-run] [--force]
 */

import "dotenv/config";
import { writeFile } from "node:fs/promises";
import prisma from "@/lib/prisma";
import { buildCompanyFinancialDashboard } from "@/lib/company-financial-dashboard";
import { normalizeTicker } from "@/lib/ticker";
import { Prisma } from "@prisma/client";

const AI_API_KEY = process.env.AI_API_KEY;
const AI_API_BASE_URL = process.env.AI_API_BASE_URL;
const AI_MODEL = process.env.AI_MODEL;

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

type FilingEvidence = {
  filingLabel: string;
  filingDate: string | null;
  reportDate: string | null;
  accession: string | null;
  form: string | null;
  sections: Array<{ section: string; content: string }>;
  attachments: Array<{ sequence: string; documentType: string; documentName: string; description: string }>;
  keyFacts: Array<{ concept: string; value: string; unit: string; endDate: string }>;
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

const SYSTEM_PROMPT = `You are a business analyst specializing in value investing. Given a company's basic info, financial data, and SEC filing evidence, generate a Business Model Canvas (9-grid) in JSON format.

The 9 grids are:
1. customerSegments - Who does the company serve?
2. valuePropositions - What problems does it solve? Why do customers choose it?
3. channels - How does it reach customers?
4. customerRelationships - How does it maintain relationships?
5. revenueStreams - How does it make money?
6. keyResources - What are its most important assets?
7. keyActivities - What must it do every day?
8. keyPartnerships - Who does it rely on?
9. costStructure - What are its biggest costs?

Rules:
- Each field should be an array of 3-5 concise bullet points.
- Each bullet must be an object with:
  - text: concise Chinese statement
  - evidence: array of 1-2 very short supporting snippets from the provided 10-K / facts
  - sources: array of short source labels, e.g. ["10-K 2025 item_1_business", "FY2025 Revenue"]
  - confidence: optional number from 0 to 1, use when an item is inferred
- Use Chinese for the content.
- Be factual and specific. Avoid generic statements.
- The text should be user-friendly and self-contained; do not put source labels or evidence snippets inside text.
- Each text bullet should read as "结论 + 支撑结论的数字 fact" when possible.
- For revenueStreams, prefer exact revenue numbers and percentage shares when they can be derived from the provided facts or filing evidence.
- For costStructure, prefer exact cost amounts, cost ratios, or margin ratios when they can be derived from the provided facts or filing evidence.
- Prefer a short conclusion first, then a compact quantitative qualifier in parentheses.
- Examples:
  - "iPhone仍是最大收入来源，约占收入50%"
  - "服务收入占比约26%"
  - "毛利率46.9%，对应成本率53.1%"
  - "研发支出345.5亿美元，占收入8.3%"
- Focus on what makes THIS company's business model distinctive.
- If some information is unavailable, make reasonable inferences from the industry and financials, but mark uncertain items with "（推测）".
- Prefer SEC filing evidence over generic industry assumptions.
- Every field should include at least one item tied to the latest filing evidence when possible.
- Keep each evidence snippet short, ideally under 20 Chinese characters or 12 English words.
- Keep each text bullet short, ideally under 30 Chinese characters.

Output ONLY valid JSON. No markdown, no explanation.`;

function getArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  return args.find((_, i) => args[i - 1] === flag);
}

function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function findCompanies(query?: string) {
  if (!query) {
    return prisma.entity.findMany({
      where: { type: { in: ["company", "master"] } },
      select: { id: true, canonicalName: true, ticker: true, cik: true, sector: true, metadata: true },
      orderBy: { canonicalName: "asc" },
    });
  }

  const normalized = normalizeTicker(query) ?? query;
  const byTicker = await prisma.entity.findFirst({
    where: {
      type: { in: ["company", "master"] },
      ticker: { equals: normalized, mode: "insensitive" },
    },
    select: { id: true, canonicalName: true, ticker: true, cik: true, sector: true, metadata: true },
    orderBy: [{ type: "desc" }, { updatedAt: "desc" }],
  });
  if (byTicker) return [byTicker];

  const cikQuery = query.replace(/\D/g, "");
  if (cikQuery && cikQuery.length >= 5) {
    const byCik = await prisma.entity.findUnique({
      where: { cik: cikQuery },
      select: { id: true, canonicalName: true, ticker: true, cik: true, sector: true, metadata: true },
    });
    if (byCik) return [byCik];
  }

  return prisma.entity.findMany({
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
}

async function fetchFinancials(entityId: string, limit = 5) {
  const base = await prisma.entity.findUnique({
    where: { id: entityId },
    select: { ticker: true },
  });
  const ticker = base?.ticker;

  const familyIds = await prisma.entity.findMany({
    where: ticker
      ? {
          OR: [
            { id: entityId },
            { ticker: { equals: ticker, mode: "insensitive" } },
          ],
        }
      : { id: entityId },
    select: { id: true },
  }).then((rows) => rows.map((row) => row.id));

  const rows = await prisma.financial.findMany({
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

function formatLineItemValue(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n.toLocaleString("en-US");
}

function truncateText(value: string, max = 1800) {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max).trimEnd()}…`;
}

async function fetchLatestFilingEvidence(entityId: string): Promise<FilingEvidence | null> {
  const filing = await prisma.extSource.findFirst({
    where: {
      filerEntityId: entityId,
      kind: { in: ["10k", "20f", "40f"] },
    },
    orderBy: [{ periodYear: "desc" }, { periodQuarter: "desc" }, { ts: "desc" }],
    select: {
      id: true,
      kind: true,
      ts: true,
      filedAt: true,
      periodYear: true,
      periodQuarter: true,
      metadata: true,
      sections: {
        select: {
          section: true,
          content: true,
        },
        where: {
          section: {
            in: [
              "item_1_business",
              "item_1a_risk_factors",
              "item_7_mda",
              "item_7a_market_risk",
              "item_8_notes",
            ],
          },
        },
        orderBy: [{ section: "asc" }],
      },
      attachments: {
        select: {
          sequence: true,
          documentType: true,
          documentName: true,
          description: true,
        },
        orderBy: [{ sequence: "asc" }],
      },
      facts: {
        select: {
          concept: true,
          value: true,
          unit: true,
          endDate: true,
        },
        orderBy: [{ endDate: "desc" }],
        take: 80,
      },
    },
  });

  if (!filing) return null;
  const meta = (filing.metadata as Record<string, unknown> | null) ?? {};
  const filingLabel = [
    filing.kind.toUpperCase(),
    filing.periodYear ?? "N/A",
    filing.periodQuarter ? `Q${filing.periodQuarter}` : null,
  ].filter(Boolean).join(" ");

  return {
    filingLabel,
    filingDate: filing.filedAt?.toISOString() ?? filing.ts?.toISOString() ?? null,
    reportDate: filing.ts?.toISOString() ?? null,
    accession: typeof meta.accession === "string" ? meta.accession : null,
    form: typeof meta.form === "string" ? meta.form : filing.kind.toUpperCase(),
    sections: filing.sections.map((section) => ({
      section: section.section,
      content: truncateText(section.content, 2400),
    })),
    attachments: filing.attachments.slice(0, 12).map((attachment) => ({
      sequence: attachment.sequence,
      documentType: attachment.documentType,
      documentName: attachment.documentName,
      description: attachment.description,
    })),
    keyFacts: filing.facts.slice(0, 24).map((fact) => ({
      concept: fact.concept,
      value: fact.value?.toString() ?? "",
      unit: fact.unit,
      endDate: fact.endDate.toISOString().slice(0, 10),
    })),
  };
}

function buildPrompt(params: {
  name: string;
  ticker: string | null;
  sector: string | null;
  metadata: Record<string, unknown> | null;
  financials: Array<{ year: number; items: Record<string, string> }>;
  filingEvidence: FilingEvidence | null;
}) {
  const dashboard = buildCompanyFinancialDashboard(
    {
      sector: params.sector,
      metadata: params.metadata,
    },
    params.financials.map((f) => ({
      year: f.year,
      periodEnd: new Date(Date.UTC(f.year, 11, 31)),
      items: f.items,
    })),
  );

  const latestCardValues = dashboard.cards.map((card) => `${card.label}: ${card.value}`).join("\n");
  const meta = params.metadata ?? {};
  const filingEvidenceText = params.filingEvidence
    ? `\nLatest filing evidence:\nFiling: ${params.filingEvidence.filingLabel}\nFiled at: ${params.filingEvidence.filingDate ?? "N/A"}\nReport date: ${params.filingEvidence.reportDate ?? "N/A"}\nAccession: ${params.filingEvidence.accession ?? "N/A"}\nForm: ${params.filingEvidence.form ?? "N/A"}\n\nSections:\n${params.filingEvidence.sections.map((section) => `- ${section.section}:\n${section.content}`).join("\n\n")}\n\nAttachments:\n${params.filingEvidence.attachments.map((attachment) => `- ${attachment.sequence} ${attachment.documentType} ${attachment.documentName} — ${attachment.description}`).join("\n")}\n\nKey facts:\n${params.filingEvidence.keyFacts.map((fact) => `- ${fact.concept} (${fact.unit}, ${fact.endDate}): ${fact.value}`).join("\n")}\n`
    : "\nLatest filing evidence: N/A";

  return `Company: ${params.name}${params.ticker ? ` (${params.ticker})` : ""}
Sector: ${params.sector ?? "N/A"}
Industry: ${typeof meta.industry === "string" ? meta.industry : "N/A"}
Exchange: ${typeof meta.exchange === "string" ? meta.exchange : "N/A"}

Latest FY: ${dashboard.latestYear ?? "N/A"}
Key Metrics:
${latestCardValues}

Financial history (5 years):
${params.financials.map((f) => {
  const items = Object.entries(f.items)
    .map(([k, v]) => `  ${k}: ${formatLineItemValue(v)}`)
    .join("\n");
  return `FY ${f.year}:\n${items}`;
}).join("\n\n")}

${filingEvidenceText}

Use the filing evidence and financial history together. Prefer SEC filing evidence over generic industry assumptions. Generate the Business Model Canvas for this company.`;
}

async function callLLM(messages: Array<{ role: string; content: string }>): Promise<string> {
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
      messages,
      temperature: 0.2,
      max_tokens: 5000,
      response_format: { type: "json_object" },
      stream: false,
    }),
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AI API error: ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? "";
}

function parseCanvas(raw: string): CanvasPayload {
  const jsonText = raw.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
  const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("No JSON object found in model response");
  }

  const parsed = JSON.parse(jsonMatch[0]) as Partial<Record<keyof CanvasPayload, unknown>>;
  for (const key of CANVAS_KEYS) {
    const items = parsed[key];
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error(`Invalid canvas field: ${key}`);
    }
    for (const item of items) {
      if (!item || typeof item !== "object") {
        throw new Error(`Invalid canvas entry in field: ${key}`);
      }
      const entry = item as Partial<CanvasEntry>;
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

  return parsed as CanvasPayload;
}

async function main() {
  const companyQuery = getArg("--company");
  const dryRun = hasFlag("--dry-run");
  const force = hasFlag("--force");
  const all = hasFlag("--all");

  if (!companyQuery && !all) {
    console.error("Usage: tsx scripts/generate-business-canvas.ts --company <ticker|name|cik> [--dry-run] [--force]");
    console.error("       tsx scripts/generate-business-canvas.ts --all [--dry-run] [--force]");
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
    let lastModelResponse = "";

    const existing = await prisma.businessCanvas.findUnique({
      where: { entityId: company.id },
      select: { id: true, updatedAt: true },
    });
    if (existing && !force) {
      console.log(`  SKIP: already has business canvas (updatedAt: ${existing.updatedAt.toISOString()}), use --force to overwrite`);
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
      const content = await callLLM([
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ]);
      lastModelResponse = content;
      const canvas = parseCanvas(content);

      await prisma.businessCanvas.upsert({
        where: { entityId: company.id },
        create: {
          entityId: company.id,
          canvas: toJsonValue(canvas),
          source: AI_MODEL ?? "unknown",
          version: 1,
        },
        update: {
          canvas: toJsonValue(canvas),
          source: AI_MODEL ?? "unknown",
          version: { increment: 1 },
        },
      });

      console.log(`  ✓ Saved business canvas (${CANVAS_KEYS.length} sections)`);
    } catch (err) {
      if (err instanceof Error && err.message.includes("JSON")) {
        try {
          await writeFile(
            `/tmp/business-canvas-${company.ticker ?? company.id}.raw.json`,
            JSON.stringify({
              prompt,
              response: lastModelResponse,
              error: err.message,
            }, null, 2),
          );
        } catch (writeErr) {
          console.error("  (failed to write debug artifact)", writeErr instanceof Error ? writeErr.message : String(writeErr));
        }
      }
      console.error(`  ✗ Failed:`, err instanceof Error ? err.message : String(err));
    }

    console.log();
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[generate-business-canvas] fatal", err);
  await prisma.$disconnect();
  process.exit(1);
});
