import prisma from "@/lib/prisma";
import { buildCompanyFinancialDashboard } from "@/lib/company-financial-dashboard";
import { normalizeTicker } from "@/lib/ticker";
import { Prisma } from "@prisma/client";

export const AI_API_KEY = process.env.AI_API_KEY;
export const AI_API_BASE_URL = process.env.AI_API_BASE_URL;
export const AI_MODEL = process.env.AI_MODEL;

export type CompanyTarget = {
  id: string;
  canonicalName: string;
  ticker: string | null;
  cik: string | null;
  sector: string | null;
  metadata: Prisma.JsonValue;
};

export type FinancialYear = {
  year: number;
  items: Record<string, string>;
};

export type HolderSummary = {
  name: string;
  tribeId: string | null;
  percent: number | null;
  valueUsd: bigint | null;
};

export type FilingEvidence = {
  filingLabel: string;
  filingDate: string | null;
  reportDate: string | null;
  accession: string | null;
  form: string | null;
  sections: Array<{ section: string; content: string }>;
  attachments: Array<{ sequence: string; documentType: string; documentName: string; description: string }>;
  keyFacts: Array<{ concept: string; value: string; unit: string; endDate: string }>;
};

export function getArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  return args.find((_, i) => args[i - 1] === flag);
}

export function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

export function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function jsonObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export async function findCompanies(query?: string): Promise<CompanyTarget[]> {
  const select = { id: true, canonicalName: true, ticker: true, cik: true, sector: true, metadata: true } satisfies Prisma.EntitySelect;

  if (!query) {
    return prisma.entity.findMany({
      where: { type: { in: ["company", "master"] } },
      select,
      orderBy: { canonicalName: "asc" },
    }) as Promise<CompanyTarget[]>;
  }

  const normalized = normalizeTicker(query) ?? query;
  const byTicker = await prisma.entity.findFirst({
    where: {
      type: { in: ["company", "master"] },
      ticker: { equals: normalized, mode: "insensitive" },
    },
    select,
    orderBy: [{ type: "desc" }, { updatedAt: "desc" }],
  });
  if (byTicker) return [byTicker as CompanyTarget];

  const cikQuery = query.replace(/\D/g, "");
  if (cikQuery && cikQuery.length >= 5) {
    const byCik = await prisma.entity.findUnique({
      where: { cik: cikQuery },
      select,
    });
    if (byCik) return [byCik as CompanyTarget];
  }

  return prisma.entity.findMany({
    where: {
      type: { in: ["company", "master"] },
      OR: [
        { canonicalName: { contains: query, mode: "insensitive" } },
        { ticker: { equals: query, mode: "insensitive" } },
      ],
    },
    select,
    orderBy: { canonicalName: "asc" },
    take: 20,
  }) as Promise<CompanyTarget[]>;
}

export async function fetchFinancials(entityId: string, limit = 5): Promise<FinancialYear[]> {
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

export async function fetchHolders(entityId: string, limit = 10): Promise<HolderSummary[]> {
  const securityScope = await prisma.security.findMany({
    where: { companyEntityId: entityId },
    select: { id: true, ticker: true },
  });
  const profileIds = securityScope.map((s) => s.id);

  const rows = await prisma.holding.findMany({
    where: {
      securityId: { in: profileIds },
    },
    orderBy: [{ holderEntityId: "asc" }, { asOfDate: "desc" }, { valueUsd: "desc" }],
    include: {
      holder: { select: { id: true, canonicalName: true, tribeId: true } },
      source: { select: { periodYear: true, periodQuarter: true } },
    },
    take: 500,
  });

  const byHolder = new Map<string, HolderSummary>();
  for (const h of rows) {
    if (byHolder.has(h.holder.id)) continue;
    byHolder.set(h.holder.id, {
      name: h.holder.canonicalName,
      tribeId: h.holder.tribeId,
      percent: h.percentOfPortfolio,
      valueUsd: h.valueUsd,
    });
  }

  return [...byHolder.values()].slice(0, limit);
}

export function formatMoney(v: string | null): string {
  if (!v) return "-";
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  return `$${n.toLocaleString()}`;
}

export function formatLineItemValue(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n.toLocaleString("en-US");
}

export function truncateText(value: string, max = 1800) {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max).trimEnd()}...`;
}

export async function fetchLatestFilingEvidence(entityId: string): Promise<FilingEvidence | null> {
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
              "item_4_company_information",
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

export function buildFinancialDashboardText(params: {
  sector: string | null;
  metadata: Record<string, unknown> | null;
  financials: FinancialYear[];
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

  return {
    latestYear: dashboard.latestYear,
    cardLines: dashboard.cards.map((card) => `${card.label}: ${card.value}`).join("\n"),
  };
}

export function buildFinancialHistoryText(financials: FinancialYear[]) {
  return financials.map((f) => {
    const items = Object.entries(f.items)
      .map(([k, v]) => `  ${k}: ${formatLineItemValue(v)}`)
      .join("\n");
    return `FY ${f.year}:\n${items}`;
  }).join("\n\n");
}

export function buildFilingEvidenceText(filingEvidence: FilingEvidence | null) {
  if (!filingEvidence) return "\nLatest filing evidence: N/A";

  return `\nLatest filing evidence:
Filing: ${filingEvidence.filingLabel}
Filed at: ${filingEvidence.filingDate ?? "N/A"}
Report date: ${filingEvidence.reportDate ?? "N/A"}
Accession: ${filingEvidence.accession ?? "N/A"}
Form: ${filingEvidence.form ?? "N/A"}

Sections:
${filingEvidence.sections.map((section) => `- ${section.section}:\n${section.content}`).join("\n\n")}

Attachments:
${filingEvidence.attachments.map((attachment) => `- ${attachment.sequence} ${attachment.documentType} ${attachment.documentName} - ${attachment.description}`).join("\n")}

Key facts:
${filingEvidence.keyFacts.map((fact) => `- ${fact.concept} (${fact.unit}, ${fact.endDate}): ${fact.value}`).join("\n")}
`;
}

export async function callJsonLLM(params: {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<string> {
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
        { role: "system", content: params.systemPrompt },
        { role: "user", content: params.userPrompt },
      ],
      temperature: params.temperature ?? 0.2,
      max_tokens: params.maxTokens ?? 5000,
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

export async function createGeneratedContentVersion(params: {
  tx?: Prisma.TransactionClient;
  scopeType: string;
  scopeId: string;
  artifactType: string;
  payload: Prisma.InputJsonValue;
  source: string;
  promptVersion: string;
  generatedAt?: Date;
}) {
  const client = params.tx ?? prisma;
  const latest = await client.generatedContentVersion.aggregate({
    where: {
      scopeType: params.scopeType,
      scopeId: params.scopeId,
      artifactType: params.artifactType,
    },
    _max: { versionSeq: true },
  });
  const versionSeq = (latest._max.versionSeq ?? 0) + 1;

  return client.generatedContentVersion.create({
    data: {
      scopeType: params.scopeType,
      scopeId: params.scopeId,
      artifactType: params.artifactType,
      versionSeq,
      payload: params.payload,
      source: params.source,
      promptVersion: params.promptVersion,
      generatedAt: params.generatedAt ?? new Date(),
    },
  });
}

export function parseJsonObject(raw: string): Record<string, unknown> {
  const jsonText = raw.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
  const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("No JSON object found in model response");
  }
  const parsed = JSON.parse(jsonMatch[0]);
  const object = jsonObject(parsed);
  if (!object) {
    throw new Error("Model response JSON is not an object");
  }
  return object;
}

export async function disconnectPrisma() {
  await prisma.$disconnect();
}

/**
 * Refuse batch generation when the database is near the Supabase free-tier
 * limit, so bulk runs cannot push it over. Single-company runs are exempt.
 */
export async function assertDbCapacityForBatch(companyCount: number) {
  if (companyCount <= 3) return;
  const blockMb = Number(process.env.DB_SIZE_BLOCK_MB ?? 460);
  const rows = await prisma.$queryRawUnsafe<Array<{ bytes: bigint }>>(
    `SELECT pg_database_size(current_database()) AS bytes`,
  );
  const totalMb = Number(rows[0].bytes) / 1e6;
  if (totalMb > blockMb) {
    throw new Error(
      `Database is ${totalMb.toFixed(0)}MB (> ${blockMb}MB block threshold). ` +
        `Refusing batch generation for ${companyCount} companies. ` +
        `Run capacity governance (TODOS.md) or raise DB_SIZE_BLOCK_MB explicitly.`,
    );
  }
}

export { prisma };
