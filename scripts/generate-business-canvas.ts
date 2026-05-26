/**
 * Generate and upsert Business Model Canvas (9-grid) for companies using LLM.
 *
 * Usage:
 *   tsx scripts/generate-business-canvas.ts --company AAPL [--dry-run] [--force]
 *   tsx scripts/generate-business-canvas.ts --all [--dry-run] [--force]
 */

import "dotenv/config";
import prisma from "@/lib/prisma";
import { buildCompanyFinancialDashboard } from "@/lib/company-financial-dashboard";
import { normalizeTicker } from "@/lib/ticker";
import { Prisma } from "@prisma/client";

const AI_API_KEY = process.env.AI_API_KEY;
const AI_API_BASE_URL = process.env.AI_API_BASE_URL;
const AI_MODEL = process.env.AI_MODEL;

type CanvasPayload = {
  customerSegments: string[];
  valuePropositions: string[];
  channels: string[];
  customerRelationships: string[];
  revenueStreams: string[];
  keyResources: string[];
  keyActivities: string[];
  keyPartnerships: string[];
  costStructure: string[];
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

const SYSTEM_PROMPT = `You are a business analyst specializing in value investing. Given a company's basic info and financial data, generate a Business Model Canvas (9-grid) in JSON format.

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
- Each field should be an array of 3-5 concise bullet points (strings).
- Use Chinese for the content.
- Be factual and specific. Avoid generic statements.
- Focus on what makes THIS company's business model distinctive.
- If some information is unavailable, make reasonable inferences from the industry and financials, but mark uncertain items with "（推测）".

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

function buildPrompt(params: {
  name: string;
  ticker: string | null;
  sector: string | null;
  metadata: Record<string, unknown> | null;
  financials: Array<{ year: number; items: Record<string, string> }>;
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

Generate the Business Model Canvas for this company.`;
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
      temperature: 0.5,
      max_tokens: 2000,
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

  const parsed = JSON.parse(jsonMatch[0]) as Partial<CanvasPayload>;
  for (const key of CANVAS_KEYS) {
    if (!Array.isArray(parsed[key]) || parsed[key]!.some((item) => typeof item !== "string")) {
      throw new Error(`Invalid canvas field: ${key}`);
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

    const existing = await prisma.businessCanvas.findUnique({
      where: { entityId: company.id },
      select: { id: true, updatedAt: true },
    });
    if (existing && !force) {
      console.log(`  SKIP: already has business canvas (updatedAt: ${existing.updatedAt.toISOString()}), use --force to overwrite`);
      continue;
    }

    const financials = await fetchFinancials(company.id, 5);
    console.log(`  Financials: ${financials.length} years`);

    const prompt = buildPrompt({
      name: company.canonicalName,
      ticker: company.ticker,
      sector: company.sector,
      metadata: (company.metadata as Record<string, unknown> | null) ?? null,
      financials,
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
