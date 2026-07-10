import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

type FilingBlock = {
  id?: string;
  type?: string;
  headers?: unknown[];
  rows?: unknown[][];
  cells?: unknown[][];
  text?: string;
  html?: string;
};

type FilingCheck = {
  ticker: string;
  companyName: string;
  cik: string | null;
  sourceId: string;
  kind: string;
  periodYear: number | null;
  accessionNumber: string | null;
  primaryHtml: {
    publicUrl: string | null;
    sourceUrl: string | null;
    bytes: number;
    img: number;
    tables: number;
    complexTables: number;
    cellsWithColspan: number;
    cellsWithRowspan: number;
    elementsWithStyle: number;
    ixFacts: number;
    maxCellsInAnyRow: number;
  };
  structured: {
    sections: number;
    blockCount: number;
    tableBlocks: number;
    imageBlocks: number;
    blocksWithHtml: number;
    tableCellsWithColspan: number;
    tableCellsWithRowspan: number;
    maxCellsInAnyRow: number;
  };
  warnings: string[];
};

function getArg(flag: string) {
  const args = process.argv.slice(2);
  return args.find((_, index) => args[index - 1] === flag);
}

function hasFlag(flag: string) {
  return process.argv.slice(2).includes(flag);
}

function parseCsv(value: string | undefined, fallback: string[]) {
  return (value ?? fallback.join(","))
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

function toBlockArray(value: unknown): FilingBlock[] {
  return Array.isArray(value) ? (value as FilingBlock[]) : [];
}

function countTableCellSpans(blocks: FilingBlock[]) {
  let colspan = 0;
  let rowspan = 0;
  let maxCellsInAnyRow = 0;

  for (const block of blocks) {
    if (block.type !== "table") continue;

    if (typeof block.html === "string" && block.html.trim()) {
      const $ = cheerio.load(block.html);
      $("td,th").each((_, el) => {
        const colSpan = Number($(el).attr("colspan") ?? 1);
        const rowSpan = Number($(el).attr("rowspan") ?? 1);
        if (Number.isFinite(colSpan) && colSpan > 1) colspan += 1;
        if (Number.isFinite(rowSpan) && rowSpan > 1) rowspan += 1;
      });
      $("tr").each((_, el) => {
        maxCellsInAnyRow = Math.max(maxCellsInAnyRow, $(el).children("td,th").length);
      });
      continue;
    }

    const structuredRows = block.cells ?? block.rows ?? [];
    maxCellsInAnyRow = structuredRows.reduce((max, row) => (Array.isArray(row) ? Math.max(max, row.length) : max), maxCellsInAnyRow);
    if (!Array.isArray(block.cells)) continue;
    for (const row of block.cells) {
      if (!Array.isArray(row)) continue;
      for (const cell of row) {
        if (!cell || typeof cell !== "object") continue;
        const record = cell as { colspan?: unknown; colSpan?: unknown; rowspan?: unknown; rowSpan?: unknown };
        const colSpan = Number(record.colspan ?? record.colSpan ?? 1);
        const rowSpan = Number(record.rowspan ?? record.rowSpan ?? 1);
        if (Number.isFinite(colSpan) && colSpan > 1) colspan += 1;
        if (Number.isFinite(rowSpan) && rowSpan > 1) rowspan += 1;
      }
    }
  }

  return { colspan, rowspan, maxCellsInAnyRow };
}

async function fetchJsonArtifact(publicUrl: string | null | undefined, timeoutMs: number) {
  if (!publicUrl) return null;
  const text = await fetchText(publicUrl, timeoutMs);
  return JSON.parse(text) as unknown;
}

async function getSectionBlocks(section: { blocksJson: unknown; blocksArtifact: { publicUrl: string | null } | null }, timeoutMs: number) {
  try {
    const artifactBlocks = await fetchJsonArtifact(section.blocksArtifact?.publicUrl, timeoutMs);
    const blocks = toBlockArray(artifactBlocks);
    if (blocks.length) return blocks;
  } catch {
    // Fall back to inline blocks; stale/missing artifacts should not hide the rest of the report.
  }
  return toBlockArray(section.blocksJson);
}

async function countStructuredBlocks(
  sections: Array<{ blocksJson: unknown; blockCount: number; blocksArtifact: { publicUrl: string | null } | null }>,
  timeoutMs: number,
) {
  const nestedBlocks = await Promise.all(sections.map((section) => getSectionBlocks(section, timeoutMs)));
  const allBlocks = nestedBlocks.flat();
  const spans = countTableCellSpans(allBlocks);

  return {
    sections: sections.length,
    blockCount: allBlocks.length || sections.reduce((sum, section) => sum + section.blockCount, 0),
    tableBlocks: allBlocks.filter((block) => block.type === "table").length,
    imageBlocks: allBlocks.filter((block) => block.type === "image" || block.type === "figure").length,
    blocksWithHtml: allBlocks.filter((block) => typeof block.html === "string" && block.html.length > 0).length,
    tableCellsWithColspan: spans.colspan,
    tableCellsWithRowspan: spans.rowspan,
    maxCellsInAnyRow: spans.maxCellsInAnyRow,
  };
}

function countOriginalHtml(html: string) {
  const $ = cheerio.load(html);
  let cellsWithColspan = 0;
  let cellsWithRowspan = 0;
  let maxCellsInAnyRow = 0;

  $("td,th").each((_, el) => {
    const colspan = Number($(el).attr("colspan") ?? 1);
    const rowspan = Number($(el).attr("rowspan") ?? 1);
    if (Number.isFinite(colspan) && colspan > 1) cellsWithColspan += 1;
    if (Number.isFinite(rowspan) && rowspan > 1) cellsWithRowspan += 1;
  });

  $("tr").each((_, el) => {
    maxCellsInAnyRow = Math.max(maxCellsInAnyRow, $(el).children("td,th").length);
  });

  return {
    bytes: Buffer.byteLength(html),
    img: $("img").length,
    tables: $("table").length,
    complexTables: $("table").filter((_, el) => $(el).find("[colspan],[rowspan]").length > 0).length,
    cellsWithColspan,
    cellsWithRowspan,
    elementsWithStyle: $("[style]").length,
    ixFacts: $("ix\\:nonfraction,ix\\:nonnumeric").length,
    maxCellsInAnyRow,
  };
}

function buildWarnings(check: Omit<FilingCheck, "warnings">) {
  const warnings: string[] = [];
  if (check.primaryHtml.img > 0 && check.structured.imageBlocks === 0) {
    warnings.push("original HTML has images, structured reader has no image blocks");
  }
  if ((check.primaryHtml.cellsWithColspan > 0 || check.primaryHtml.cellsWithRowspan > 0) && check.structured.tableCellsWithColspan + check.structured.tableCellsWithRowspan === 0) {
    warnings.push("original HTML uses table spans, structured table model has no spans");
  }
  if (check.primaryHtml.tables > check.structured.tableBlocks * 1.25) {
    warnings.push("structured extraction has materially fewer tables than original HTML");
  }
  if (check.primaryHtml.maxCellsInAnyRow > check.structured.maxCellsInAnyRow * 1.5) {
    warnings.push("structured tables have narrower rows than original HTML");
  }
  if (check.primaryHtml.elementsWithStyle > 0 && check.structured.blocksWithHtml === 0) {
    warnings.push("original HTML relies on inline styling, stored blocks do not preserve HTML");
  }
  return warnings;
}

async function fetchText(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "buffett-tribe fidelity check walkklaw@gmail.com",
        Accept: "text/html,application/xhtml+xml,*/*",
      },
    });
    if (!res.ok) throw new Error(`fetch failed ${res.status} ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPrimaryHtml(publicUrl: string | null, sourceUrl: string | null, timeoutMs: number) {
  const errors: string[] = [];
  for (const url of [sourceUrl, publicUrl].filter(Boolean) as string[]) {
    try {
      return await fetchText(url, timeoutMs);
    } catch (error) {
      errors.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`primary HTML fetch failed: ${errors.join(" | ")}`);
}

async function checkTicker(ticker: string, timeoutMs: number): Promise<FilingCheck> {
  const company = await db.entity.findFirst({
    where: {
      type: "company",
      ticker: { equals: ticker, mode: "insensitive" },
    },
    select: {
      id: true,
      canonicalName: true,
      ticker: true,
      cik: true,
    },
  });
  if (!company) throw new Error(`company not found: ${ticker}`);

  const filing = await db.extSource.findFirst({
    where: {
      filerEntityId: company.id,
      kind: { in: ["10k", "20f", "40f"] },
    },
    orderBy: [{ periodYear: "desc" }, { periodQuarter: "desc" }, { ts: "desc" }],
    select: {
      id: true,
      kind: true,
      periodYear: true,
      accessionNumber: true,
      sections: {
        select: {
          blocksJson: true,
          blockCount: true,
          blocksArtifact: { select: { publicUrl: true } },
        },
      },
      artifacts: {
        where: { kind: "primary_html" },
        select: {
          publicUrl: true,
          sourceUrl: true,
        },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
  });
  if (!filing) throw new Error(`annual filing not found: ${ticker}`);

  const primaryHtmlArtifact = filing.artifacts[0];
  if (!primaryHtmlArtifact?.publicUrl && !primaryHtmlArtifact?.sourceUrl) {
    throw new Error(`primary_html artifact not found: ${ticker} ${filing.periodYear ?? ""}`);
  }

  const html = await fetchPrimaryHtml(primaryHtmlArtifact.publicUrl, primaryHtmlArtifact.sourceUrl, timeoutMs);
  const originalStats = countOriginalHtml(html);
  const structuredStats = await countStructuredBlocks(filing.sections, timeoutMs);
  const checkWithoutWarnings = {
    ticker: company.ticker ?? ticker,
    companyName: company.canonicalName,
    cik: company.cik,
    sourceId: filing.id,
    kind: filing.kind,
    periodYear: filing.periodYear,
    accessionNumber: filing.accessionNumber,
    primaryHtml: {
      publicUrl: primaryHtmlArtifact.publicUrl,
      sourceUrl: primaryHtmlArtifact.sourceUrl,
      ...originalStats,
    },
    structured: structuredStats,
  };

  return {
    ...checkWithoutWarnings,
    warnings: buildWarnings(checkWithoutWarnings),
  };
}

async function main() {
  const tickers = parseCsv(getArg("--tickers"), ["AAPL", "ZM", "SNOW", "VTS", "TSM", "ASML"]);
  const out = getArg("--out");
  const timeoutMs = Number(getArg("--timeout-ms") ?? "20000");
  const strict = hasFlag("--strict");
  const checks: FilingCheck[] = [];
  const failures: Array<{ ticker: string; error: string }> = [];

  for (const ticker of tickers) {
    console.log(`[fidelity] checking ${ticker}`);
    try {
      checks.push(await checkTicker(ticker, timeoutMs));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ ticker, error: message });
      console.warn(`[fidelity] ${ticker} failed: ${message}`);
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    tickers,
    checks,
    failures,
    warningCount: checks.reduce((sum, check) => sum + check.warnings.length, 0),
  };

  const json = JSON.stringify(report, null, 2);
  if (out) {
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(out, `${json}\n`, "utf8");
    console.log(`[fidelity] wrote ${out}`);
  } else {
    console.log(json);
  }

  await db.$disconnect();
  if (strict && (report.warningCount > 0 || report.failures.length > 0)) process.exit(1);
}

main().catch(async (error) => {
  console.error("[compare-annual-report-fidelity] fatal", error);
  await db.$disconnect();
  process.exit(1);
});
