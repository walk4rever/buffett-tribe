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
  const objectKey = buildFilingArtifactKey({
    cik: params.cik,
    accession: params.accession,
    kind: params.kind,
    originalName: params.originalName,
  });

  const existing = await db.filingArtifact.findUnique({
    where: { objectKey },
  });
  if (existing) {
    return existing;
  }

  const sha256 = crypto.createHash("sha256").update(params.body).digest("hex");
  const publicUrl = await uploadToR2(objectKey, params.body, params.contentType);

  return db.filingArtifact.upsert({
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
  });
}
