import crypto from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { uploadToR2 } from "../../src/lib/r2";

export const SEC_HEADERS = {
  "User-Agent": "buffett-tribe research walkklaw@gmail.com",
  Accept: "application/json, text/xml, */*",
};

export type FilingIndexFile = {
  category: "attachment" | "data_file";
  sequence: string;
  description: string;
  documentName: string;
  documentType: string;
  url: string;
};

type ArchiveArtifactParams = {
  sourceId: string;
  kind: "primary_html" | "index_html" | "attachment" | "data_file" | "section_text" | "section_blocks" | "section_html";
  cik: string;
  accession: string;
  originalName: string;
  contentType: string;
  body: Buffer;
  sourceUrl?: string | null;
  metadata?: Prisma.InputJsonValue;
};

const ARCHIVE_TRACE = process.env.ARCHIVE_TRACE === "1";
const ARTIFACT_DB_RETRY_ATTEMPTS = parsePositiveInt(process.env.ARTIFACT_DB_RETRY_ATTEMPTS, 6);

function parsePositiveInt(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function formatSeconds(startedAt: number) {
  return ((Date.now() - startedAt) / 1000).toFixed(1);
}

function formatBytes(bytes: number) {
  return bytes.toLocaleString();
}

function traceArchive(message: string) {
  if (ARCHIVE_TRACE) console.log(message);
}

function isRetryableDbError(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  if (code && ["P1001", "P1002", "P2024"].includes(code)) return true;

  const message = error instanceof Error ? error.message : String(error);
  return /Can't reach database|Timed out|Connection terminated|ECONNRESET|ETIMEDOUT/i.test(message);
}

async function withArtifactDbRetry<T>(label: string, fn: () => Promise<T>) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= ARTIFACT_DB_RETRY_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryableDbError(error) || attempt >= ARTIFACT_DB_RETRY_ATTEMPTS) break;
      const delayMs = 1000 * 2 ** (attempt - 1);
      console.warn(`[DB] artifact retry ${attempt}/${ARTIFACT_DB_RETRY_ATTEMPTS} ${label} error=${error instanceof Error ? error.message : String(error)} nextDelayMs=${delayMs}`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

function normalizeKeyPart(value: string) {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function buildFilingArtifactKey(params: {
  cik: string;
  accession: string;
  kind: string;
  originalName: string;
}) {
  return [
    "buffett-tribe",
    "sec",
    "filings",
    normalizeKeyPart(params.cik),
    normalizeKeyPart(params.accession),
    normalizeKeyPart(params.kind),
    normalizeKeyPart(params.originalName),
  ].join("/");
}

export async function fetchSecText(url: string): Promise<string> {
  const res = await fetch(url, { headers: SEC_HEADERS });
  if (!res.ok) {
    throw new Error(`SEC fetch failed: ${res.status} ${url}`);
  }
  return res.text();
}

export async function fetchSecBuffer(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  const res = await fetch(url, { headers: SEC_HEADERS });
  if (!res.ok) {
    throw new Error(`SEC fetch failed: ${res.status} ${url}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    contentType: res.headers.get("content-type") ?? "application/octet-stream",
  };
}

function parseTableRows(tableHtml: string) {
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRe = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
  const rows: string[][] = [];
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRe.exec(tableHtml))) {
    const cells: string[] = [];
    let cellMatch: RegExpExecArray | null;
    const rowBody = rowMatch[1];
    cellRe.lastIndex = 0;
    while ((cellMatch = cellRe.exec(rowBody))) {
      const text = cellMatch[1]
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
      cells.push(text);
    }
    rows.push(cells);
  }

  return rows;
}

export async function fetchFilingIndexFiles(
  cik: string,
  accession: string,
): Promise<{ html: string; files: FilingIndexFile[] }> {
  const accnoPath = accession.replace(/-/g, "");
  const indexUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${accnoPath}/${accession}-index.htm`;
  const html = await fetchSecText(indexUrl);
  const files: FilingIndexFile[] = [];

  const tableRe = /<table[^>]*class="tableFile"[^>]*summary="([^"]+)"[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch: RegExpExecArray | null;

  while ((tableMatch = tableRe.exec(html))) {
    const summary = tableMatch[1];
    if (!/Document Format Files|Data Files/i.test(summary)) continue;

    const category: FilingIndexFile["category"] = /Data Files/i.test(summary) ? "data_file" : "attachment";
    const rows = parseTableRows(tableMatch[2]);
    for (const cells of rows) {
      if (cells.length < 4) continue;
      const [seq, desc, doc, docType] = cells;
      if (!seq || !/^\d+$/.test(seq)) continue;

      const documentName = doc.replace(/\s*iXBRL\s*$/i, "").trim();
      if (!documentName) continue;

      files.push({
        category,
        sequence: seq,
        description: desc || docType || documentName,
        documentName,
        documentType: docType || "",
        url: `https://www.sec.gov/Archives/edgar/data/${cik}/${accnoPath}/${documentName}`,
      });
    }
  }

  return { html, files };
}

export async function archiveFilingArtifact(
  db: PrismaClient,
  params: ArchiveArtifactParams,
) {
  const startedAt = Date.now();
  const objectKey = buildFilingArtifactKey({
    cik: params.cik,
    accession: params.accession,
    kind: params.kind,
    originalName: params.originalName,
  });
  const label = `${params.kind} ${params.originalName}`;
  traceArchive(`  Artifact ${label}: start size=${formatBytes(params.body.length)} contentType=${params.contentType}`);

  const lookupStartedAt = Date.now();
  const existing = await withArtifactDbRetry(`${label} lookup`, () =>
    db.filingArtifact.findUnique({
      where: { objectKey },
    }),
  );
  traceArchive(`  Artifact ${label}: existing lookup ${formatSeconds(lookupStartedAt)}s`);
  if (existing) {
    traceArchive(`  Artifact ${label}: cache hit total=${formatSeconds(startedAt)}s`);
    return existing;
  }

  const hashStartedAt = Date.now();
  const sha256 = crypto.createHash("sha256").update(params.body).digest("hex");
  traceArchive(`  Artifact ${label}: hash ${formatSeconds(hashStartedAt)}s sha256=${sha256.slice(0, 12)}`);

  const uploadStartedAt = Date.now();
  const publicUrl = await uploadToR2(objectKey, params.body, params.contentType);
  traceArchive(`  Artifact ${label}: upload R2 ${formatSeconds(uploadStartedAt)}s`);

  const upsertStartedAt = Date.now();
  const artifact = await withArtifactDbRetry(`${label} upsert`, () =>
    db.filingArtifact.upsert({
      where: { objectKey },
      update: {
        sourceId: params.sourceId,
        kind: params.kind,
        contentType: params.contentType,
        sizeBytes: BigInt(params.body.length),
        sha256,
        originalName: params.originalName,
        sourceUrl: params.sourceUrl ?? null,
        metadata: params.metadata ?? Prisma.JsonNull,
        publicUrl,
      },
      create: {
        sourceId: params.sourceId,
        kind: params.kind,
        objectKey,
        contentType: params.contentType,
        sizeBytes: BigInt(params.body.length),
        sha256,
        originalName: params.originalName,
        sourceUrl: params.sourceUrl ?? null,
        metadata: params.metadata ?? Prisma.JsonNull,
        publicUrl,
      },
    }),
  );
  traceArchive(`  Artifact ${label}: db upsert ${formatSeconds(upsertStartedAt)}s total=${formatSeconds(startedAt)}s`);
  return artifact;
}
