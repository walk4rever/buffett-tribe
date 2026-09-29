/**
 * Create ExtSource records for US annual reports (10-K/20-F/40-F) without
 * slicing or R2 upload — P1 lightweight variant.
 *
 * Usage:
 *   npm run create:us-annual-extsource -- --ticker AAPL --from 2020 --to 2025
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

type EdgarToolsFiling = {
  accession: string;
  form: string;
  filedAt: string;
  reportDate: string;
  primaryDocument: string;
  primaryUrl: string | null;
  filingUrlBase: string;
  indexUrl: string;
  isXbrl: boolean;
  isInlineXbrl: boolean;
};

type EdgarToolsPayload = {
  ticker: string;
  cik: string;
  title: string;
  filings: EdgarToolsFiling[];
};

function getArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  return args.find((_, i) => args[i - 1] === flag);
}

function normalizeTicker(value: string | undefined): string {
  const ticker = value?.trim().toUpperCase() ?? "";
  if (!ticker) throw new Error("Missing --ticker. Example: --ticker AAPL");
  return ticker;
}

function runEdgarToolsHelper(params: {
  python: string;
  args: string[];
  timeoutMs: number;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(params.python, params.args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`edgartools helper timeout after ${params.timeoutMs}ms`));
    }, params.timeoutMs);

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`edgartools helper exited with code ${code}`));
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function main() {
  const ticker = normalizeTicker(getArg("--ticker"));
  const fromArg = getArg("--from");
  const toArg = getArg("--to");
  const cikArg = getArg("--cik");
  const python = getArg("--python") ?? (process.env.EDGARTOOLS_PYTHON || path.join(process.cwd(), ".venv/bin/python"));

  if (!fromArg || !toArg) throw new Error("--from and --to are required. Example: --from 2020 --to 2025");

  const fromYear = Number.parseInt(fromArg, 10);
  const toYear = Number.parseInt(toArg, 10);
  if (!Number.isFinite(fromYear) || !Number.isFinite(toYear)) throw new Error("Invalid --from/--to year.");
  if (fromYear > toYear) throw new Error("--from cannot be greater than --to.");

  const entity = await prisma.entity.findFirst({
    where: { type: "company", ticker: { equals: ticker, mode: "insensitive" } },
    select: { id: true, cik: true },
  });

  if (!entity) {
    throw new Error(`No Entity found for ticker ${ticker} — run seed_entity or import_financials first`);
  }

  const resolvedCik = cikArg ?? entity.cik;
  if (!resolvedCik) {
    throw new Error(`No CIK available for ${ticker} — pass --cik or ensure Entity.cik is set`);
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "edgar-filings-"));
  const outputPath = path.join(tempDir, "filings.json");

  try {
    await runEdgarToolsHelper({
      python,
      args: [
        path.join(process.cwd(), "scripts/helpers/edgartools-fetch-filings.py"),
        "--ticker", ticker,
        "--cik", resolvedCik,
        "--from-year", String(fromYear),
        "--to-year", String(toYear),
        "--output", outputPath,
        "--no-html",  // Don't fetch HTML content
      ],
      timeoutMs: 60000,  // 1 min is enough for metadata-only fetch
    });

    const raw = await readFile(outputPath, "utf8");
    const payload = JSON.parse(raw) as EdgarToolsPayload;

    let created = 0;
    let updated = 0;

    for (const filing of payload.filings) {
      const periodYear = new Date(filing.reportDate).getUTCFullYear();
      const kind = filing.form === "20-F" ? "20f" : filing.form === "40-F" ? "40f" : "10k";

      // Build external SEC viewer URL
      const url = filing.primaryUrl ??
        `https://www.sec.gov/cgi-bin/viewer?action=view&cik=${resolvedCik}&accession_number=${filing.accession}&xbrl_type=v`;

      const metadata: Record<string, unknown> = {
        ticker,
        form: filing.form,
        filedAt: filing.filedAt,
        reportDate: filing.reportDate,
        edgartools: {
          isXbrl: filing.isXbrl,
          isInlineXbrl: filing.isInlineXbrl,
        },
      };

      const existing = await prisma.extSource.findUnique({
        where: { ExtSource_filer_accession_unique: { filerEntityId: entity.id, accessionNumber: filing.accession } },
        select: { id: true },
      });

      if (existing) {
        await prisma.extSource.update({
          where: { id: existing.id },
          data: { url, metadata: metadata as Prisma.InputJsonValue },
        });
        updated++;
      } else {
        await prisma.extSource.create({
          data: {
            kind,
            filerEntityId: entity.id,
            accessionNumber: filing.accession,
            periodYear,
            url,
            metadata: metadata as Prisma.InputJsonValue,
          },
        });
        created++;
      }
    }

    console.log(`✓ ${ticker}: Created ${created} ExtSource records, updated ${updated}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
    await prisma.$disconnect();
  }
}

main().catch(async (err) => {
  console.error("[create-us-annual-extsource] fatal", err instanceof Error ? err.message : String(err));
  await prisma.$disconnect();
  process.exit(1);
});
